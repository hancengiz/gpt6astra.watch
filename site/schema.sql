-- astra-watch D1 schema
-- Apply with:
--   npx wrangler d1 execute astra-watch --file schema.sql --remote
--   npx wrangler d1 execute astra-watch --file schema.sql --local   (dev)

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  country    TEXT    NOT NULL,                              -- ISO 3166-1 alpha-2 (+ XK)
  source     TEXT    NOT NULL DEFAULT 'web' CHECK (source IN ('web','watcher')),
  ip_hash    TEXT    NOT NULL,                              -- HMAC-SHA256(salt, ip)
  undo_hash  TEXT,                                          -- HMAC of browser-only undo token
  created_at INTEGER NOT NULL                               -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_reports_country     ON reports(country);
CREATE INDEX IF NOT EXISTS idx_reports_ip_country  ON reports(ip_hash, country, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_ip_time     ON reports(ip_hash, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watcher_access_report
  ON reports(ip_hash) WHERE source = 'watcher';
CREATE INDEX IF NOT EXISTS idx_reports_undo_hash ON reports(undo_hash);

CREATE TABLE IF NOT EXISTS report_claims (
  ip_hash    TEXT    NOT NULL,
  country    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, country)
);

-- Manual "not yet" responses remain separate from the positive reports
-- ledger, so they can never light a country or enter the availability feed.
-- A converted row is retained to preserve its original waiting timestamp.
CREATE TABLE IF NOT EXISTS waiting_votes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  country           TEXT    NOT NULL,
  ip_hash           TEXT    NOT NULL,
  ownership_hash    TEXT    NOT NULL, -- HMAC of the browser-only vote token
  created_at        INTEGER NOT NULL,
  last_confirmed_at INTEGER NOT NULL,
  converted_at      INTEGER,
  UNIQUE(ip_hash, country),
  UNIQUE(country, ownership_hash)
);

CREATE INDEX IF NOT EXISTS idx_waiting_votes_active
  ON waiting_votes(country, converted_at, last_confirmed_at);
CREATE INDEX IF NOT EXISTS idx_waiting_votes_ownership
  ON waiting_votes(country, ownership_hash);

CREATE TABLE IF NOT EXISTS watchers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  country            TEXT    NOT NULL,
  watcher_hash       TEXT    NOT NULL, -- HMAC-SHA256(salt, random installation id)
  ip_hash            TEXT    NOT NULL, -- abuse control only; raw IP is never stored
  mode               TEXT    NOT NULL CHECK (mode IN ('account','region')),
  started_at         INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL,
  completed_at       INTEGER,
  access_detected_at INTEGER,
  last_waiting_at    INTEGER,  -- last successful account check that found Astra absent
  response_hash      TEXT,     -- manual-vote hash namespace; dedupes same-network responses
  completion_reason  TEXT CHECK (
    completion_reason IS NULL OR completion_reason IN ('account_access','country_live')
  ),
  created_at         INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchers_identity ON watchers(watcher_hash);
CREATE INDEX IF NOT EXISTS idx_watchers_active ON watchers(completed_at, last_seen_at, country);
CREATE INDEX IF NOT EXISTS idx_watchers_completed ON watchers(completed_at, started_at);
CREATE INDEX IF NOT EXISTS idx_watchers_ip_time ON watchers(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_watchers_waiting
  ON watchers(mode, completed_at, last_waiting_at, country);

CREATE TABLE IF NOT EXISTS skill_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  country            TEXT    NOT NULL,
  ip_hash            TEXT    NOT NULL, -- same salted hash namespace as watcher IP analytics
  first_requested_at INTEGER NOT NULL,
  last_requested_at  INTEGER NOT NULL,
  request_count      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(country, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_skill_requests_country ON skill_requests(country);
CREATE INDEX IF NOT EXISTS idx_skill_requests_last ON skill_requests(last_requested_at);

-- Private D1-only analytics. No HTTP route exposes this view.
CREATE VIEW IF NOT EXISTS internal_funnel AS
WITH watcher_funnel AS (
  SELECT
    country,
    ip_hash,
    COUNT(DISTINCT watcher_hash) AS watcher_installations,
    COUNT(DISTINCT CASE WHEN completed_at IS NOT NULL THEN watcher_hash END)
      AS completed_watchers,
    COUNT(DISTINCT CASE WHEN access_detected_at IS NOT NULL THEN watcher_hash END)
      AS account_accesses,
    COUNT(DISTINCT CASE WHEN completion_reason = 'country_live' THEN watcher_hash END)
      AS country_live_completions
  FROM watchers
  WHERE watcher_hash IS NOT NULL
  GROUP BY country, ip_hash
)
SELECT
  s.country,
  SUM(s.request_count) AS skill_requests,
  COUNT(*) AS unique_skill_requesters,
  COALESCE(SUM(w.watcher_installations), 0) AS watcher_installations,
  COALESCE(SUM(w.completed_watchers), 0) AS completed_watchers,
  COALESCE(SUM(w.account_accesses), 0) AS account_accesses,
  COALESCE(SUM(w.country_live_completions), 0) AS country_live_completions
FROM skill_requests AS s
LEFT JOIN watcher_funnel AS w
  ON w.ip_hash = s.ip_hash AND w.country = s.country
GROUP BY s.country;
