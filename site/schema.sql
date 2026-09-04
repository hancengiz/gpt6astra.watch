-- astra-watch D1 schema
-- Apply with:
--   npx wrangler d1 execute astra-watch --file schema.sql --remote
--   npx wrangler d1 execute astra-watch --file schema.sql --local   (dev)

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  country    TEXT    NOT NULL,                              -- ISO 3166-1 alpha-2 (+ XK)
  source     TEXT    NOT NULL DEFAULT 'web' CHECK (source IN ('web','watcher')),
  ip_hash    TEXT    NOT NULL,                              -- HMAC-SHA256(salt, ip)
  created_at INTEGER NOT NULL                               -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_reports_country     ON reports(country);
CREATE INDEX IF NOT EXISTS idx_reports_ip_country  ON reports(ip_hash, country, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_ip_time     ON reports(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS watchers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  country    TEXT    NOT NULL,
  ip_hash    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watchers_country ON watchers(country);
CREATE INDEX IF NOT EXISTS idx_watchers_ip_time ON watchers(ip_hash, created_at);
