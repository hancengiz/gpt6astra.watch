// gpt6astra.watch — Pages advanced-mode worker.
// Serves /api/* from D1; everything else falls through to static assets.

import { normalizedRequestCountry } from "./crimea.js";

const COUNTRIES = new Set(
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
   "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
   "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
   "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
   "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
   "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
   "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK").split(" ")
);

const DAILY_IP_CAP = 12;                  // max manual vote claims per ip per 24h
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

function countryName(country) {
  if (country === "XK") return "Kosovo";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(country) || country;
  } catch {
    return country;
  }
}

function countryCatalog() {
  return [...COUNTRIES]
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

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

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function undoCookieName(country) {
  return `astra_report_${country}`;
}

function undoCookie(request, country, token, maxAge = 365 * 24 * 3600) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${undoCookieName(country)}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=Strict`;
}

function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
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
  const [reports, activeWatchers, waitingVotes, history] = await db.batch([
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
      `WITH active_waiting AS (
         SELECT country, ip_hash AS response_hash, 'web' AS source
         FROM waiting_votes
         WHERE converted_at IS NULL
         UNION ALL
         SELECT country, response_hash, 'watcher' AS source
         FROM watchers
         WHERE mode = 'account'
           AND completed_at IS NULL
           AND last_waiting_at > ?1
           AND response_hash IS NOT NULL
       )
       SELECT country,
              COUNT(DISTINCT response_hash) AS waiting,
              COUNT(DISTINCT CASE WHEN source = 'web' THEN response_hash END) AS waiting_web,
              COUNT(DISTINCT CASE WHEN source = 'watcher' THEN response_hash END) AS waiting_watcher
       FROM active_waiting
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
    waiting: 0,
    waiting_web: 0,
    waiting_watcher: 0,
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
      waiting: 0,
      waiting_web: 0,
      waiting_watcher: 0,
      monitoring: 0,
      first_at: row.first_at,
      last_at: row.last_at,
    };
    totals.reports += row.total;
    if (status === "live") totals.lit++;
    else if (status === "reported") totals.reported++;
    else if (status === "rumored") totals.rumored++;
  }
  for (const row of waitingVotes.results || []) {
    if (!countries[row.country]) {
      countries[row.country] = {
        status: "none", web: 0, watcher: 0, reports: 0,
        waiting: row.waiting, waiting_web: row.waiting_web,
        waiting_watcher: row.waiting_watcher,
        monitoring: 0, first_at: null, last_at: null,
      };
    } else {
      countries[row.country].waiting = row.waiting;
      countries[row.country].waiting_web = row.waiting_web;
      countries[row.country].waiting_watcher = row.waiting_watcher;
    }
    totals.waiting += row.waiting;
    totals.waiting_web += row.waiting_web;
    totals.waiting_watcher += row.waiting_watcher;
  }
  for (const row of activeWatchers.results || []) {
    if (!countries[row.country]) {
      countries[row.country] = {
        status: "none", web: 0, watcher: 0, reports: 0,
        waiting: 0, waiting_web: 0, waiting_watcher: 0,
        monitoring: row.monitoring, first_at: null, last_at: null,
      };
    } else {
      countries[row.country].monitoring = row.monitoring;
    }
    totals.monitoring += row.monitoring;
  }
  return { countries, totals };
}

function validVoteToken(token) {
  return /^[a-f0-9]{48}$/.test(token || "");
}

async function readOwnedVote(db, country, ownershipHash) {
  if (!ownershipHash) {
    return { vote: null, can_manage: false, waitingRow: null, reportRows: [] };
  }
  const [waiting, reports] = await db.batch([
    db.prepare(
      `SELECT ip_hash, created_at, last_confirmed_at, converted_at
       FROM waiting_votes
       WHERE country = ?1 AND ownership_hash = ?2`
    ).bind(country, ownershipHash),
    db.prepare(
      `SELECT id, ip_hash, created_at
       FROM reports
       WHERE country = ?1 AND source = 'web' AND undo_hash = ?2`
    ).bind(country, ownershipHash),
  ]);
  const waitingRow = waiting.results?.[0] || null;
  const reportRows = reports.results || [];
  if (reportRows.length > 0) {
    return {
      vote: "available",
      can_manage: true,
      was_waiting: waitingRow != null,
      waiting_since: waitingRow?.created_at ?? null,
      converted_at: waitingRow?.converted_at ?? null,
      waitingRow,
      reportRows,
    };
  }
  if (waitingRow) {
    return {
      vote: "waiting",
      can_manage: true,
      was_waiting: true,
      waiting_since: waitingRow.created_at,
      converted_at: null,
      waitingRow,
      reportRows,
    };
  }
  return { vote: null, can_manage: false, waitingRow: null, reportRows: [] };
}

async function countryVoteResult(db, country, details = {}) {
  const { countries, totals } = await rollup(db);
  const current = countries[country] || {
    status: "none", web: 0, watcher: 0, reports: 0,
    waiting: 0, waiting_web: 0, waiting_watcher: 0,
    monitoring: 0, first_at: null, last_at: null,
  };
  return { country, ...current, totals, ...details };
}

async function castAvailableVote(request, db, secret, country) {
  const now = Date.now();
  const ipHash = await hashIp(clientIp(request), secret);
  const existingToken = readCookie(request, undoCookieName(country));
  const ownershipHash = validVoteToken(existingToken)
    ? await hashIp(`undo:${existingToken}`, secret)
    : null;

  const owned = await readOwnedVote(db, country, ownershipHash);
  if (owned.vote === "available") {
    return json(await countryVoteResult(db, country, {
      ok: true,
      vote: "available",
      deduped: true,
      can_manage: true,
      can_undo: true,
      was_waiting: owned.was_waiting,
      waiting_since: owned.waiting_since,
      converted_at: owned.converted_at,
      message: "Your Astra report is already counted ✦",
    }));
  }

  if (owned.waitingRow) {
    const conversion = await db.batch([
      db.prepare(
        `INSERT INTO reports (country, source, ip_hash, undo_hash, created_at)
         SELECT country, 'web', ip_hash, ownership_hash, ?3
         FROM waiting_votes
         WHERE country = ?1 AND ownership_hash = ?2
           AND NOT EXISTS (
             SELECT 1 FROM reports
             WHERE source = 'web'
               AND reports.country = waiting_votes.country
               AND reports.ip_hash = waiting_votes.ip_hash
           )`
      ).bind(country, ownershipHash, now),
      db.prepare(
        `UPDATE waiting_votes
         SET converted_at = COALESCE(converted_at, ?3), last_confirmed_at = ?3
         WHERE country = ?1 AND ownership_hash = ?2`
      ).bind(country, ownershipHash, now),
    ]);
    const after = await readOwnedVote(db, country, ownershipHash);
    if (after.vote !== "available") {
      return bad("this network already has a different Astra report", 409);
    }
    return json(await countryVoteResult(db, country, {
      ok: true,
      vote: "available",
      converted: true,
      deduped: (conversion[0].meta?.changes ?? 0) === 0,
      can_manage: true,
      can_undo: true,
      was_waiting: true,
      waiting_since: after.waiting_since,
      converted_at: after.converted_at,
      message: "Your waiting vote is now an Astra report ✦",
    }));
  }

  const [dupe, cap] = await db.batch([
    db.prepare(
      `SELECT id, undo_hash FROM reports
       WHERE ip_hash = ?1 AND country = ?2 AND source = 'web'`
    ).bind(ipHash, country),
    db.prepare(
      `SELECT COUNT(*) AS n FROM report_claims
       WHERE ip_hash = ?1 AND created_at > ?2`
    ).bind(ipHash, now - 24 * 3600 * 1000),
  ]);

  if (dupe.results.length > 0) {
    await db.prepare(
      `INSERT OR IGNORE INTO report_claims (ip_hash, country, created_at)
       VALUES (?1, ?2, ?3)`
    ).bind(ipHash, country, now).run();

    let canUndo = false;
    let issuedToken = null;
    if (ownershipHash) {
      canUndo = dupe.results.some((row) => row.undo_hash === ownershipHash);
    } else if (dupe.results.every((row) => row.undo_hash == null)) {
      issuedToken = randomToken();
      const claimedUndoHash = await hashIp(`undo:${issuedToken}`, secret);
      await db.prepare(
        `UPDATE reports SET undo_hash = ?1
         WHERE ip_hash = ?2 AND country = ?3 AND source = 'web' AND undo_hash IS NULL`
      ).bind(claimedUndoHash, ipHash, country).run();
      canUndo = true;
    }

    return json(
      await countryVoteResult(db, country, {
        ok: true,
        vote: "available",
        deduped: true,
        can_manage: canUndo,
        can_undo: canUndo,
        network_claimed: !canUndo,
        message: canUndo
          ? "You already reported Astra for this country. This browser can manage it below ✦"
          : "A response from this network is already counted. Use the original browser to change it ✦",
      }),
      issuedToken ? { headers: { "set-cookie": undoCookie(request, country, issuedToken) } } : {}
    );
  }
  if ((cap.results[0]?.n ?? 0) >= DAILY_IP_CAP) return bad("too many reports", 429);

  const claimed = await db.prepare(
    `INSERT OR IGNORE INTO report_claims (ip_hash, country, created_at)
     VALUES (?1, ?2, ?3)`
  ).bind(ipHash, country, now).run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    return json(await countryVoteResult(db, country, {
      ok: true,
      vote: null,
      deduped: true,
      can_manage: false,
      can_undo: false,
      network_claimed: true,
      message: "A response from this network is already counted. Use the original browser to change it ✦",
    }));
  }

  const undoToken = randomToken();
  const undoHash = await hashIp(`undo:${undoToken}`, secret);
  try {
    await db.prepare(
      `INSERT INTO reports (country, source, ip_hash, undo_hash, created_at)
       VALUES (?1, 'web', ?2, ?3, ?4)`
    ).bind(country, ipHash, undoHash, now).run();
  } catch (err) {
    await db.prepare(
      `DELETE FROM report_claims WHERE ip_hash = ?1 AND country = ?2`
    ).bind(ipHash, country).run();
    throw err;
  }

  return json(
    await countryVoteResult(db, country, {
      ok: true,
      vote: "available",
      can_manage: true,
      can_undo: true,
      was_waiting: false,
    }),
    { headers: { "set-cookie": undoCookie(request, country, undoToken) } }
  );
}

async function castWaitingVote(request, db, secret, country) {
  const now = Date.now();
  const ipHash = await hashIp(clientIp(request), secret);
  const existingToken = readCookie(request, undoCookieName(country));
  const ownershipHash = validVoteToken(existingToken)
    ? await hashIp(`undo:${existingToken}`, secret)
    : null;
  const owned = await readOwnedVote(db, country, ownershipHash);

  if (owned.vote === "waiting") {
    await db.prepare(
      `UPDATE waiting_votes SET last_confirmed_at = ?3
       WHERE country = ?1 AND ownership_hash = ?2`
    ).bind(country, ownershipHash, now).run();
    return json(await countryVoteResult(db, country, {
      ok: true,
      vote: "waiting",
      deduped: true,
      can_manage: true,
      waiting_since: owned.waiting_since,
      message: "Your waiting vote is already counted.",
    }));
  }

  if (owned.vote === "available") {
    const statements = [];
    if (owned.waitingRow) {
      statements.push(
        db.prepare(
          `UPDATE waiting_votes
           SET converted_at = NULL, last_confirmed_at = ?3
           WHERE country = ?1 AND ownership_hash = ?2`
        ).bind(country, ownershipHash, now)
      );
    } else {
      statements.push(
        db.prepare(
          `INSERT INTO waiting_votes (
             country, ip_hash, ownership_hash, created_at, last_confirmed_at, converted_at
           )
           SELECT country, ip_hash, undo_hash, ?3, ?3, NULL
           FROM reports
           WHERE country = ?1 AND source = 'web' AND undo_hash = ?2
           LIMIT 1`
        ).bind(country, ownershipHash, now)
      );
    }
    statements.push(
      db.prepare(
        `DELETE FROM reports
         WHERE country = ?1 AND source = 'web' AND undo_hash = ?2`
      ).bind(country, ownershipHash)
    );
    await db.batch(statements);
    return json(await countryVoteResult(db, country, {
      ok: true,
      vote: "waiting",
      converted_back: true,
      can_manage: true,
      waiting_since: owned.waiting_since ?? now,
      message: "Your response is back to still waiting.",
    }));
  }

  const [networkWaiting, networkReport, cap] = await db.batch([
    db.prepare(
      `SELECT id FROM waiting_votes WHERE ip_hash = ?1 AND country = ?2`
    ).bind(ipHash, country),
    db.prepare(
      `SELECT id FROM reports
       WHERE ip_hash = ?1 AND country = ?2 AND source = 'web'`
    ).bind(ipHash, country),
    db.prepare(
      `SELECT COUNT(*) AS n FROM report_claims
       WHERE ip_hash = ?1 AND created_at > ?2`
    ).bind(ipHash, now - 24 * 3600 * 1000),
  ]);
  if (networkWaiting.results.length > 0 || networkReport.results.length > 0) {
    return json(await countryVoteResult(db, country, {
      ok: true,
      vote: null,
      deduped: true,
      can_manage: false,
      network_claimed: true,
      message: "A response from this network is already counted. Use the original browser to change it ✦",
    }));
  }
  if ((cap.results[0]?.n ?? 0) >= DAILY_IP_CAP) return bad("too many reports", 429);

  const claimed = await db.prepare(
    `INSERT OR IGNORE INTO report_claims (ip_hash, country, created_at)
     VALUES (?1, ?2, ?3)`
  ).bind(ipHash, country, now).run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    return json(await countryVoteResult(db, country, {
      ok: true,
      vote: null,
      deduped: true,
      can_manage: false,
      network_claimed: true,
      message: "A response from this network is already counted. Use the original browser to change it ✦",
    }));
  }

  const voteToken = randomToken();
  const voteHash = await hashIp(`undo:${voteToken}`, secret);
  try {
    await db.prepare(
      `INSERT INTO waiting_votes (
         country, ip_hash, ownership_hash, created_at, last_confirmed_at, converted_at
       ) VALUES (?1, ?2, ?3, ?4, ?4, NULL)`
    ).bind(country, ipHash, voteHash, now).run();
  } catch (err) {
    await db.prepare(
      `DELETE FROM report_claims WHERE ip_hash = ?1 AND country = ?2`
    ).bind(ipHash, country).run();
    throw err;
  }

  return json(
    await countryVoteResult(db, country, {
      ok: true,
      vote: "waiting",
      can_manage: true,
      waiting_since: now,
    }),
    { headers: { "set-cookie": undoCookie(request, country, voteToken) } }
  );
}

async function deleteOwnedVote(request, db, secret, country) {
  const token = readCookie(request, undoCookieName(country));
  if (!validVoteToken(token)) return bad("vote cookie not found", 403);
  const ownershipHash = await hashIp(`undo:${token}`, secret);
  const [ownedWaiting, ownedReports] = await db.batch([
    db.prepare(
      `SELECT DISTINCT ip_hash FROM waiting_votes
       WHERE country = ?1 AND ownership_hash = ?2`
    ).bind(country, ownershipHash),
    db.prepare(
      `SELECT DISTINCT ip_hash FROM reports
       WHERE country = ?1 AND source = 'web' AND undo_hash = ?2`
    ).bind(country, ownershipHash),
  ]);
  const ipHashes = [...new Set([
    ...(ownedWaiting.results || []).map((row) => row.ip_hash),
    ...(ownedReports.results || []).map((row) => row.ip_hash),
  ])];
  const statements = [
    db.prepare(
      `DELETE FROM reports
       WHERE country = ?1 AND source = 'web' AND undo_hash = ?2`
    ).bind(country, ownershipHash),
    db.prepare(
      `DELETE FROM waiting_votes
       WHERE country = ?1 AND ownership_hash = ?2`
    ).bind(country, ownershipHash),
    ...ipHashes.map((ownedIpHash) =>
      db.prepare(
        `DELETE FROM report_claims
         WHERE ip_hash = ?1 AND country = ?2
           AND NOT EXISTS (
             SELECT 1 FROM reports
             WHERE source = 'web' AND ip_hash = ?1 AND country = ?2
           )
           AND NOT EXISTS (
             SELECT 1 FROM waiting_votes
             WHERE ip_hash = ?1 AND country = ?2
           )`
      ).bind(ownedIpHash, country)
    ),
  ];
  const removed = await db.batch(statements);
  const removedCount = (removed[0].meta?.changes ?? 0) + (removed[1].meta?.changes ?? 0);
  return json(
    await countryVoteResult(db, country, {
      ok: true,
      vote: null,
      removed: removedCount > 0,
      removed_count: removedCount,
      can_manage: false,
    }),
    { headers: { "set-cookie": undoCookie(request, country, "", 0) } }
  );
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
        "DELETE /api/report {country}": "undo this browser's manual web report",
        "GET  /api/vote?country=XX": "this browser's manual vote",
        "PUT  /api/vote {country, vote}": "cast or change waiting/available vote",
        "DELETE /api/vote {country}": "remove this browser's manual vote",
        "GET  /api/location": "current request country hint; no storage",
        "GET  /api/countries": "complete supported country catalog",
        "GET  /api/summary": "per-country rollout and active-monitoring rollup",
        "GET  /api/status?country=XX": "single country — what region watchers poll",
        "GET  /api/feed?after=ID": "recent availability reports",
        "POST /api/watchers {country, watcher_id, event, mode}":
          "anonymous heartbeat/waiting/access/completion signal",
      },
    });
  }


  if (path === "/api/location" && request.method === "GET") {
    const location = normalizedRequestCountry(request, COUNTRIES);
    const detected = location.country;
    return json({
      country: detected,
      name: detected ? countryName(detected) : null,
      detected: Boolean(detected),
      ...(location.crimeaNormalized ? { normalized: "crimea-ukraine" } : {}),
    });
  }

  if (path === "/api/countries" && request.method === "GET") {
    return json(
      { countries: countryCatalog() },
      { cache: "public, max-age=86400" }
    );
  }

  if (path === "/api/report" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return bad("invalid JSON body");
    if (typeof body.nickname === "string" && body.nickname.trim() !== "") {
      return json({ ok: true, ignored: true });
    }
    const country = String(body.country || "").toUpperCase();
    if (!COUNTRIES.has(country)) return bad("unknown country code");
    if (!secret) return bad("service not configured", 503);
    return castAvailableVote(request, db, secret, country);
  }

  if (path === "/api/vote" && request.method === "GET") {
    const country = (url.searchParams.get("country") || "").toUpperCase();
    if (!COUNTRIES.has(country)) return bad("unknown country code");
    if (!secret) return bad("service not configured", 503);
    const token = readCookie(request, undoCookieName(country));
    const ownershipHash = validVoteToken(token)
      ? await hashIp(`undo:${token}`, secret)
      : null;
    const owned = await readOwnedVote(db, country, ownershipHash);
    return json({
      country,
      vote: owned.vote,
      can_manage: owned.can_manage,
      was_waiting: owned.was_waiting ?? false,
      waiting_since: owned.waiting_since ?? null,
      converted_at: owned.converted_at ?? null,
    });
  }

  if (path === "/api/vote" && request.method === "PUT") {
    const body = await readJsonBody(request);
    if (!body) return bad("invalid JSON body");
    if (typeof body.nickname === "string" && body.nickname.trim() !== "") {
      return json({ ok: true, ignored: true });
    }
    const country = String(body.country || "").toUpperCase();
    const vote = String(body.vote || "");
    if (!COUNTRIES.has(country)) return bad("unknown country code");
    if (!["waiting", "available"].includes(vote)) {
      return bad("vote must be waiting or available");
    }
    if (!secret) return bad("service not configured", 503);
    return vote === "waiting"
      ? castWaitingVote(request, db, secret, country)
      : castAvailableVote(request, db, secret, country);
  }

  if (path === "/api/vote" && request.method === "DELETE") {
    const body = await readJsonBody(request);
    if (!body) return bad("invalid JSON body");
    const country = String(body.country || "").toUpperCase();
    if (!COUNTRIES.has(country)) return bad("unknown country code");
    if (!secret) return bad("service not configured", 503);
    return deleteOwnedVote(request, db, secret, country);
  }

  if (path === "/api/report" && request.method === "DELETE") {
    const body = await readJsonBody(request);
    if (!body) return bad("invalid JSON body");
    const country = String(body.country || "").toUpperCase();
    if (!COUNTRIES.has(country)) return bad("unknown country code");
    if (!secret) return bad("service not configured", 503);

    const undoToken = readCookie(request, undoCookieName(country));
    if (!validVoteToken(undoToken)) {
      return bad("undo cookie not found", 403);
    }
    const undoHash = await hashIp(`undo:${undoToken}`, secret);
    const owned = await db.prepare(
      `SELECT DISTINCT ip_hash FROM reports
       WHERE country = ?1 AND source = 'web' AND undo_hash = ?2`
    ).bind(country, undoHash).all();

    let removedCount = 0;
    let revertedToWaiting = false;
    if (owned.results.length > 0) {
      const results = await db.batch([
        db.prepare(
          `DELETE FROM reports
           WHERE country = ?1 AND source = 'web' AND undo_hash = ?2`
        ).bind(country, undoHash),
        db.prepare(
          `UPDATE waiting_votes
           SET converted_at = NULL, last_confirmed_at = ?3
           WHERE country = ?1 AND ownership_hash = ?2 AND converted_at IS NOT NULL`
        ).bind(country, undoHash, Date.now()),
        ...owned.results.map((row) =>
          db.prepare(
            `DELETE FROM report_claims
             WHERE ip_hash = ?1 AND country = ?2
               AND NOT EXISTS (
                 SELECT 1 FROM reports
                 WHERE source = 'web' AND ip_hash = ?1 AND country = ?2
               )
               AND NOT EXISTS (
                 SELECT 1 FROM waiting_votes
                 WHERE ip_hash = ?1 AND country = ?2
               )`
          ).bind(row.ip_hash, country)
        ),
      ]);
      removedCount = results[0].meta?.changes ?? 0;
      revertedToWaiting = (results[1].meta?.changes ?? 0) > 0;
    }

    const { countries, totals } = await rollup(db);
    const c = countries[country] || { status: "none" };
    return json(
      {
        ok: true,
        removed: removedCount > 0,
        removed_count: removedCount,
        vote: revertedToWaiting ? "waiting" : null,
        reverted_to_waiting: revertedToWaiting,
        country,
        status: c.status,
        totals,
      },
      revertedToWaiting
        ? {}
        : { headers: { "set-cookie": undoCookie(request, country, "", 0) } }
    );
  }

  if (path === "/api/summary" && request.method === "GET") {
    const { countries, totals } = await rollup(db);
    return json({ generated_at: Date.now(), totals, countries }, { cache: "public, max-age=15" });
  }

  if (path === "/api/status" && request.method === "GET") {
    const country = (url.searchParams.get("country") || "").toUpperCase();
    if (!COUNTRIES.has(country)) return bad("unknown country code");
    const { countries, totals } = await rollup(db);
    const c = countries[country] || {
      status: "none", reports: 0, waiting: 0,
      waiting_web: 0, waiting_watcher: 0, monitoring: 0,
    };
    return json({
      country,
      status: c.status === "live" ? "live" : "pending",
      detail: c.status,
      reports: c.reports ?? 0,
      web_reporters: c.web ?? 0,
      watcher_reporters: c.watcher ?? 0,
      waiting_reports: c.waiting ?? 0,
      web_waiting_reports: c.waiting_web ?? 0,
      watcher_waiting_reports: c.waiting_watcher ?? 0,
      stargazers_monitoring: c.monitoring ?? 0,
      first_seen: c.first_at ? new Date(c.first_at).toISOString() : null,
      last_seen: c.last_at ? new Date(c.last_at).toISOString() : null,
      totals: {
        countries_lit: totals.lit,
        waiting_reports: totals.waiting,
        web_waiting_reports: totals.waiting_web,
        watcher_waiting_reports: totals.waiting_watcher,
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
    if (!["heartbeat", "waiting", "access", "country_live"].includes(event)) {
      return bad("event must be heartbeat, waiting, access, or country_live");
    }
    if (event === "waiting" && mode !== "account") {
      return bad("waiting events require account mode");
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
    const responseHash = await hashIp(clientIp(request), secret);
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

    const completedAt = ["heartbeat", "waiting"].includes(event) ? null : now;
    const accessAt = event === "access" ? now : null;
    const waitingAt = event === "waiting" ? now : null;
    const completionReason =
      event === "access" ? "account_access" :
      event === "country_live" ? "country_live" : null;

    await db.prepare(
      `INSERT INTO watchers (
         country, watcher_hash, ip_hash, mode, started_at, last_seen_at,
         completed_at, access_detected_at, last_waiting_at, response_hash,
         completion_reason, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10, ?5)
       ON CONFLICT DO UPDATE SET
         country = excluded.country,
         ip_hash = excluded.ip_hash,
         response_hash = excluded.response_hash,
         mode = excluded.mode,
         last_seen_at = excluded.last_seen_at,
         last_waiting_at = CASE
           WHEN watchers.completed_at IS NULL
             THEN COALESCE(excluded.last_waiting_at, watchers.last_waiting_at)
           ELSE watchers.last_waiting_at
         END,
         completed_at = COALESCE(watchers.completed_at, excluded.completed_at),
         access_detected_at = COALESCE(watchers.access_detected_at, excluded.access_detected_at),
         completion_reason = COALESCE(watchers.completion_reason, excluded.completion_reason)`
    ).bind(
      country, watcherHash, ipHash, mode, now,
      completedAt, accessAt, waitingAt, responseHash, completionReason
    ).run();

    if (event === "access") {
      await db.prepare(
        `INSERT OR IGNORE INTO reports (country, source, ip_hash, created_at)
         VALUES (?1, 'watcher', ?2, ?3)`
      ).bind(country, watcherHash, now).run();
    }

    const session = await db.prepare(
      `SELECT started_at, last_seen_at, completed_at, access_detected_at,
              last_waiting_at, completion_reason
       FROM watchers WHERE watcher_hash = ?1`
    ).bind(watcherHash).first();
    const { countries, totals } = await rollup(db, now);
    return json({
      ok: true,
      country,
      event,
      mode,
      monitoring: session.completed_at == null,
      waiting_confirmed: session.completed_at == null &&
        session.last_waiting_at != null && session.last_waiting_at > now - ACTIVE_WINDOW_MS,
      waiting_in_country: countries[country]?.waiting ?? 0,
      watcher_waiting_in_country: countries[country]?.waiting_watcher ?? 0,
      monitoring_in_country: countries[country]?.monitoring ?? 0,
      monitoring_total: totals.monitoring,
      started_at: session.started_at,
      last_seen_at: session.last_seen_at,
      last_waiting_at: session.last_waiting_at,
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
    if (url.protocol !== "https:" && !isLocalHostname(url.hostname)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname === "/SKILL.md" && request.method === "GET") {
      const asset = await env.ASSETS.fetch(request);
      if (!asset.ok) return asset;

      const location = normalizedRequestCountry(request, COUNTRIES);
      const country = location.country;
      const analyticsSecret = env.IP_HASH_SECRET ||
        (env.CF_PAGES_BRANCH === "local" ? "dev-only-insecure-salt" : null);
      if (country && analyticsSecret) {
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
      if (country) {
        const name = countryName(country);
        detected =
          `> **Unconfirmed network-location hint:** ${name} (${country}). This is where the SKILL.md request reached Cloudflare and may be the AI agent's network, a VPN, or a relay rather than the user's country.\n` +
          `> First ask the user which country they are currently in; mention ${name} only as an unconfirmed hint. Never silently accept or infer the country.\n` +
          `> After the user confirms a country, ask the explicit yes/no sharing question in Step 1. Do not create, download, or schedule anything until both the country and consent answer are explicit.`;
      } else {
        detected =
          `> **Country not detected.** Do not infer it from a timezone, language, IP guess, AI-agent location, or account locale. ` +
          `First ask which country the user is currently in. After they answer, ask the explicit yes/no sharing question in Step 1. ` +
          `Do not create, download, or schedule anything until both answers are explicit.`;
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
