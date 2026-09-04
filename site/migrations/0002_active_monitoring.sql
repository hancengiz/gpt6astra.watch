-- Upgrade the original one-shot watcher registrations to anonymous active
-- monitoring sessions. Existing legacy rows remain historical but are not
-- counted as active because they have no watcher_hash/last_seen_at.

ALTER TABLE watchers ADD COLUMN watcher_hash TEXT;
ALTER TABLE watchers ADD COLUMN mode TEXT;
ALTER TABLE watchers ADD COLUMN started_at INTEGER;
ALTER TABLE watchers ADD COLUMN last_seen_at INTEGER;
ALTER TABLE watchers ADD COLUMN completed_at INTEGER;
ALTER TABLE watchers ADD COLUMN access_detected_at INTEGER;
ALTER TABLE watchers ADD COLUMN completion_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchers_identity
  ON watchers(watcher_hash) WHERE watcher_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_watchers_active
  ON watchers(completed_at, last_seen_at, country);
CREATE INDEX IF NOT EXISTS idx_watchers_completed
  ON watchers(completed_at, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watcher_access_report
  ON reports(ip_hash) WHERE source = 'watcher';

CREATE TABLE IF NOT EXISTS skill_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  country            TEXT    NOT NULL,
  ip_hash            TEXT    NOT NULL,
  first_requested_at INTEGER NOT NULL,
  last_requested_at  INTEGER NOT NULL,
  request_count      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(country, ip_hash)
);
CREATE INDEX IF NOT EXISTS idx_skill_requests_country ON skill_requests(country);
CREATE INDEX IF NOT EXISTS idx_skill_requests_last ON skill_requests(last_requested_at);

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
