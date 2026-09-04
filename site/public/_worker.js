// gpt6astra.watch — Pages advanced-mode worker.
// Serves /api/* from D1; everything else falls through to static assets.

const COUNTRIES = new Set(
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
   "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
   "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
   "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
   "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
   "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
   "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK").split(" ")
);

const DEDUPE_WINDOW_MS = 6 * 3600 * 1000; // one web report per ip/country per 6h
const DAILY_IP_CAP = 12;                  // max web reports per ip per 24h
const ACTIVE_WINDOW_MS = 25 * 60 * 1000; // two missed 10-minute heartbeats + grace
const DAILY_WATCHER_CAP = 50;             // anonymous installation ids per ip/day

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": init.cache || "no-store",
      ...(init.headers || {}),
    },
  });

const bad = (message, status = 400) => json({ error: message }, { status });

async function hashIp(ip, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") ||
         request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
         "0.0.0.0";
}

function statusFor(webIps, watcherIps) {
  // Trust model: anonymous watcher claims are stronger than web clicks but
  // not proof; 2 distinct watchers confirm, 3 distinct web reporters confirm.
  if (webIps >= 3 || watcherIps >= 2) return "live";
  if (webIps + watcherIps >= 2) return "reported";
  if (webIps + watcherIps === 1) return "rumored";
  return "none";
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    return body;
  } catch {
    return null;
  }
}

async function rollup(db, now = Date.now()) {
  const [reports, activeWatchers, history] = await db.batch([
    db.prepare(
      `SELECT country,
              COUNT(DISTINCT CASE WHEN source='web'     THEN ip_hash END) AS web_ips,
              COUNT(DISTINCT CASE WHEN source='watcher' THEN ip_hash END) AS watcher_ips,
              COUNT(*)                                               AS total,
              MIN(created_at)                                        AS first_at,
              MAX(created_at)                                        AS last_at
       FROM reports GROUP BY country`
    ),
    db.prepare(
      `SELECT country, COUNT(DISTINCT watcher_hash) AS monitoring
       FROM watchers
       WHERE watcher_hash IS NOT NULL
         AND completed_at IS NULL
         AND last_seen_at > ?1
       GROUP BY country`
    ).bind(now - ACTIVE_WINDOW_MS),
    db.prepare(
      `SELECT COUNT(*) AS completed,
              SUM(CASE WHEN access_detected_at IS NOT NULL THEN 1 ELSE 0 END) AS access_detected,
              AVG(CASE WHEN completed_at >= started_at THEN completed_at - started_at END) AS average_wait_ms
       FROM watchers
       WHERE watcher_hash IS NOT NULL AND completed_at IS NOT NULL`
    ),
  ]);

  const countries = {};
  const historyRow = history.results?.[0] || {};
  const totals = {
    lit: 0,
    reported: 0,
    rumored: 0,
    reports: 0,
    monitoring: 0,
    completed: historyRow.completed ?? 0,
    access_detected: historyRow.access_detected ?? 0,
    average_wait_ms: historyRow.average_wait_ms == null
      ? null
      : Math.round(historyRow.average_wait_ms),
  };

  for (const row of reports.results || []) {
    const status = statusFor(row.web_ips, row.watcher_ips);
    countries[row.country] = {
      status,
      web: row.web_ips,
      watcher: row.watcher_ips,
      reports: row.total,
      monitoring: 0,
      first_at: row.first_at,
      last_at: row.last_at,
    };
    totals.reports += row.total;
    if (status === "live") totals.lit++;
    else if (status === "reported") totals.reported++;
    else if (status === "rumored") totals.rumored++;
  }
  for (const row of activeWatchers.results || []) {
    if (!countries[row.country]) {
      countries[row.country] = {
        status: "none", web: 0, watcher: 0, reports: 0,
        monitoring: row.monitoring, first_at: null, last_at: null,
      };
    } else {
      countries[row.country].monitoring = row.monitoring;
    }
    totals.monitoring += row.monitoring;
  }
  return { countries, totals };
}

// ---------------------------------------------------------------- routes

async function handleApi(request, env, url) {
  const path = url.pathname;
  const db = env.DB;
  const secret = env.IP_HASH_SECRET ||
    (env.CF_PAGES_BRANCH === "local" ? "dev-only-insecure-salt" : null);

  if (path === "/api/" || path === "/api") {
    return json({
      name: "gpt6astra.watch",
      endpoints: {
        "POST /api/report   {country}": "manual web report",
        "GET  /api/summary": "per-country rollout and active-monitoring rollup",
        "GET  /api/status?country=XX": "single country — what region watchers poll",
        "GET  /api/feed?after=ID": "recent availability reports",
        "POST /api/watchers {country, watcher_id, event, mode}":
          "anonymous heartbeat/access/completion signal",
      },
    });
  }


  if (path === "/api/report" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return bad("invalid JSON body");

    // Honeypot: bots that fill every field get a fake success.
    if (typeof body.nickname === "string" && body.nickname.trim() !== "") {
      return json({ ok: true, ignored: true });
    }

    const country = String(body.country || "").toUpperCase();
    if (!COUNTRIES.has(country)) return bad("unknown country code");

    if (!secret) return bad("service not configured", 503);
    const ipHash = await hashIp(clientIp(request), secret);
    const now = Date.now();

    const [dupe, cap] = await db.batch([
      db.prepare(
        `SELECT 1 FROM reports
         WHERE ip_hash = ?1 AND country = ?2 AND created_at > ?3`
      ).bind(ipHash, country, now - DEDUPE_WINDOW_MS),
      db.prepare(
        `SELECT COUNT(*) AS n FROM reports
         WHERE ip_hash = ?1 AND created_at > ?2`
      ).bind(ipHash, now - 24 * 3600 * 1000),
    ]);
    if (cap.results[0]?.n >= DAILY_IP_CAP) return bad("too many reports", 429);
    if (dupe.results.length > 0) {
      const { countries } = await rollup(db);
      const c = countries[country] || { status: "none" };
      return json({ ok: true, deduped: true, country, status: c.status });
    }

    await db.prepare(
      `INSERT INTO reports (country, source, ip_hash, created_at) VALUES (?1, 'web', ?2, ?3)`
    ).bind(country, ipHash, now).run();

    const { countries, totals } = await rollup(db);
    return json({ ok: true, country, ...countries[country], totals });
  }

  if (path === "/api/summary" && request.method === "GET") {
    const { countries, totals } = await rollup(db);
    return json({ generated_at: Date.now(), totals, countries }, { cache: "public, max-age=15" });
  }

  if (path === "/api/status" && request.method === "GET") {
    const country = (url.searchParams.get("country") || "").toUpperCase();
    if (!COUNTRIES.has(country)) return bad("unknown country code");
    const { countries, totals } = await rollup(db);
    const c = countries[country] || { status: "none", reports: 0, monitoring: 0 };
    return json({
      country,
      status: c.status === "live" ? "live" : "pending",
      detail: c.status,
      reports: c.reports ?? 0,
      web_reporters: c.web ?? 0,
      watcher_reporters: c.watcher ?? 0,
      stargazers_monitoring: c.monitoring ?? 0,
      first_seen: c.first_at ? new Date(c.first_at).toISOString() : null,
      last_seen: c.last_at ? new Date(c.last_at).toISOString() : null,
      totals: {
        countries_lit: totals.lit,
        stargazers_monitoring: totals.monitoring,
      },
    }, { cache: "public, max-age=60" });
  }

  if (path === "/api/feed" && request.method === "GET") {
    const after = Number(url.searchParams.get("after") || 0) || 0;
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 30) || 30, 100));
    const res = await db.prepare(
      after > 0
        ? `SELECT id, country, source, created_at FROM reports WHERE id > ?1 ORDER BY id DESC LIMIT ${limit}`
        : `SELECT id, country, source, created_at FROM reports ORDER BY id DESC LIMIT ${limit}`
    ).bind(...(after > 0 ? [after] : [])).all();
    return json({ events: res.results || [] }, { cache: "public, max-age=15" });
  }

  if (path === "/api/watchers" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return bad("invalid JSON body");
    if (typeof body.nickname === "string" && body.nickname.trim() !== "") {
      return json({ ok: true, ignored: true });
    }

    const country = String(body.country || "").toUpperCase();
    const watcherId = String(body.watcher_id || "");
    const event = String(body.event || "");
    const mode = body.mode === "region" ? "region" : "account";
    if (!COUNTRIES.has(country)) return bad("unknown country code");
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(watcherId)) {
      return bad("watcher_id must be a random 20–128 character token");
    }
    if (!["heartbeat", "access", "country_live"].includes(event)) {
      return bad("event must be heartbeat, access, or country_live");
    }
    if (event === "access" && mode !== "account") {
      return bad("access events require account mode");
    }
    if (event === "country_live" && mode !== "region") {
      return bad("country_live events require region mode");
    }
    if (!secret) return bad("service not configured", 503);

    const watcherHash = await hashIp(`watcher:${watcherId}`, secret);
    const ipHash = await hashIp(`ip:${clientIp(request)}`, secret);
    const now = Date.now();
    const existing = await db.prepare(
      `SELECT watcher_hash FROM watchers WHERE watcher_hash = ?1`
    ).bind(watcherHash).first();
    if (!existing) {
      const cap = await db.prepare(
        `SELECT COUNT(*) AS n FROM watchers
         WHERE ip_hash = ?1 AND created_at > ?2`
      ).bind(ipHash, now - 24 * 3600 * 1000).first();
      if ((cap?.n ?? 0) >= DAILY_WATCHER_CAP) return bad("too many watcher ids", 429);
    }

    const completedAt = event === "heartbeat" ? null : now;
    const accessAt = event === "access" ? now : null;
    const completionReason =
      event === "access" ? "account_access" :
      event === "country_live" ? "country_live" : null;

    await db.prepare(
      `INSERT INTO watchers (
         country, watcher_hash, ip_hash, mode, started_at, last_seen_at,
         completed_at, access_detected_at, completion_reason, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?5)
       ON CONFLICT DO UPDATE SET
         country = excluded.country,
         ip_hash = excluded.ip_hash,
         mode = excluded.mode,
         last_seen_at = excluded.last_seen_at,
         completed_at = COALESCE(watchers.completed_at, excluded.completed_at),
         access_detected_at = COALESCE(watchers.access_detected_at, excluded.access_detected_at),
         completion_reason = COALESCE(watchers.completion_reason, excluded.completion_reason)`
    ).bind(
      country, watcherHash, ipHash, mode, now,
      completedAt, accessAt, completionReason
    ).run();

    if (event === "access") {
      await db.prepare(
        `INSERT OR IGNORE INTO reports (country, source, ip_hash, created_at)
         VALUES (?1, 'watcher', ?2, ?3)`
      ).bind(country, watcherHash, now).run();
    }

    const session = await db.prepare(
      `SELECT started_at, last_seen_at, completed_at, access_detected_at, completion_reason
       FROM watchers WHERE watcher_hash = ?1`
    ).bind(watcherHash).first();
    const { countries, totals } = await rollup(db, now);
    return json({
      ok: true,
      country,
      event,
      mode,
      monitoring: session.completed_at == null,
      monitoring_in_country: countries[country]?.monitoring ?? 0,
      monitoring_total: totals.monitoring,
      started_at: session.started_at,
      last_seen_at: session.last_seen_at,
      completed_at: session.completed_at,
      access_detected_at: session.access_detected_at,
      completion_reason: session.completion_reason,
      wait_ms: session.completed_at == null
        ? null
        : Math.max(0, session.completed_at - session.started_at),
    });
  }

  return bad("not found", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/SKILL.md" && request.method === "GET") {
      const asset = await env.ASSETS.fetch(request);
      if (!asset.ok) return asset;

      const country = String(
        request.cf?.country || request.headers.get("cf-ipcountry") || ""
      ).toUpperCase();
      const analyticsSecret = env.IP_HASH_SECRET ||
        (env.CF_PAGES_BRANCH === "local" ? "dev-only-insecure-salt" : null);
      if (COUNTRIES.has(country) && analyticsSecret) {
        try {
          const ipHash = await hashIp(`ip:${clientIp(request)}`, analyticsSecret);
          const now = Date.now();
          await env.DB.prepare(
            `INSERT INTO skill_requests (
               country, ip_hash, first_requested_at, last_requested_at, request_count
             ) VALUES (?1, ?2, ?3, ?3, 1)
             ON CONFLICT(country, ip_hash) DO UPDATE SET
               last_requested_at = excluded.last_requested_at,
               request_count = skill_requests.request_count + 1`
          ).bind(country, ipHash, now).run();
        } catch (err) {
          console.error("skill request analytics error", err);
        }
      }
      let detected;
      if (COUNTRIES.has(country)) {
        let name = country;
        try {
          name = new Intl.DisplayNames(["en"], { type: "region" }).of(country) || country;
        } catch {
          // ISO code remains a usable fallback.
        }
        detected =
          `> **Detected location for this installation:** ${name} (${country}), based on the request country.\n` +
          `> This SKILL.md request records the country, timestamp, and a salted one-way IP hash for private funnel analytics; the raw IP and counts are not published.\n` +
          `> Before creating, downloading, or scheduling a watcher script, tell the user this detected location and ask: ` +
          `"You appear to be in ${name} (${country}). Would you like to contribute anonymously to the map while this watcher is active and when Astra reaches your account? ` +
          `This sends the country, a random installation ID, heartbeat timestamps, and the access timestamp; no account name, hostname, or raw IP. Yes or no?" ` +
          `If the location is wrong, use the user's correction. Do not install anything until the user answers.`;
      } else {
        detected =
          `> **Location detection was unavailable for this installation.** ` +
          `Before creating, downloading, or scheduling a watcher script, ask for the user's country and then ask the same explicit yes/no consent question described below. ` +
          `Do not install anything until the user answers.`;
      }

      const source = await asset.text();
      const metadataEnd = source.indexOf("\n---\n", 3);
      const personalized = metadataEnd >= 0
        ? `${source.slice(0, metadataEnd + 5)}\n${detected}\n\n${source.slice(metadataEnd + 5)}`
        : `${detected}\n\n${source}`;
      const headers = new Headers(asset.headers);
      headers.set("content-type", "text/markdown; charset=utf-8");
      headers.set("cache-control", "private, no-store");
      headers.delete("content-length");
      headers.delete("etag");
      return new Response(personalized, {
        status: asset.status,
        headers,
      });
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error("api error", err);
        return json({ error: "internal error" }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
