-- Add reversible "I don't have Astra yet" votes without changing the
-- existing positive reports ledger. Existing reports, claims, and watcher
-- sessions remain untouched and continue to work with the previous Worker.

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
