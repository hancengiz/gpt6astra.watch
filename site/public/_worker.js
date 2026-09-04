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

const DEDUPE_WINDOW_MS = 6 * 3600 * 1000;   // one report per ip per country per 6h
const DAILY_IP_CAP = 12;                    // max reports per ip per 24h (troll brake)
const WATCHER_DEDUPE_MS = 24 * 3600 * 1000; // watcher registrations per ip per 24h

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

async function rollup(db) {
  const [reports, watchers] = await db.batch([
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
      `SELECT country, COUNT(DISTINCT ip_hash) AS waiting
       FROM watchers GROUP BY country`
    ),
  ]);

  const countries = {};
  let totals = { lit: 0, reported: 0, rumored: 0, reports: 0, watchers: 0 };

  for (const row of reports.results || []) {
    const status = statusFor(row.web_ips, row.watcher_ips);
    countries[row.country] = {
      status,
      web: row.web_ips,
      watcher: row.watcher_ips,
      reports: row.total,
      watchers: 0,
      first_at: row.first_at,
      last_at: row.last_at,
    };
    totals.reports += row.total;
    if (status === "live") totals.lit++;
    else if (status === "reported") totals.reported++;
    else if (status === "rumored") totals.rumored++;
  }
  for (const row of watchers.results || []) {
    if (!countries[row.country]) {
      countries[row.country] = {
        status: "none", web: 0, watcher: 0, reports: 0,
        watchers: row.waiting, first_at: null, last_at: null,
      };
    } else {
      countries[row.country].watchers = row.waiting;
    }
    totals.watchers += row.waiting;
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
        "POST /api/report   {country, source?}": "report Astra availability (source: web|watcher)",
        "GET  /api/summary": "full per-country rollup",
        "GET  /api/status?country=XX": "single country — what watchers poll",
        "GET  /api/feed?after=ID": "recent report events",
        "POST /api/watchers {country}": "register a watcher (waiting counter)",
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
    const source = body.source === "watcher" ? "watcher" : "web";
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
      `INSERT INTO reports (country, source, ip_hash, created_at) VALUES (?1, ?2, ?3, ?4)`
    ).bind(country, source, ipHash, now).run();

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
    const c = countries[country] || { status: "none", reports: 0, watchers: 0 };
    return json({
      country,
      status: c.status === "live" ? "live" : "pending",
      detail: c.status,
      reports: c.reports ?? 0,
      web_reporters: c.web ?? 0,
      watcher_reporters: c.watcher ?? 0,
      watchers_waiting: c.watchers ?? 0,
      first_seen: c.first_at ? new Date(c.first_at).toISOString() : null,
      last_seen: c.last_at ? new Date(c.last_at).toISOString() : null,
      totals: { countries_lit: totals.lit, watchers_waiting: totals.watchers },
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
    if (!COUNTRIES.has(country)) return bad("unknown country code");

    if (!secret) return bad("service not configured", 503);
    const ipHash = await hashIp(clientIp(request), secret);
    const now = Date.now();
    const dupe = await db.prepare(
      `SELECT 1 FROM watchers WHERE ip_hash = ?1 AND created_at > ?2`
    ).bind(ipHash, now - WATCHER_DEDUPE_MS).first();

    let waiting, total;
    if (!dupe) {
      await db.prepare(
        `INSERT INTO watchers (country, ip_hash, created_at) VALUES (?1, ?2, ?3)`
      ).bind(country, ipHash, now).run();
    }
    const res = await db.batch([
      db.prepare(`SELECT COUNT(DISTINCT ip_hash) AS n FROM watchers WHERE country = ?1`).bind(country),
      db.prepare(`SELECT COUNT(DISTINCT ip_hash) AS n FROM watchers`),
    ]);
    waiting = res[0].results[0]?.n ?? 0;
    total = res[1].results[0]?.n ?? 0;
    return json({ ok: true, deduped: Boolean(dupe), country, watchers_waiting: waiting, watchers_total: total });
  }

  return bad("not found", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
