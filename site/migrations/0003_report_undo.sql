-- Give each manual web report an exact browser-held undo capability.
-- Existing reports remain valid but have no undo token.

ALTER TABLE reports ADD COLUMN undo_hash TEXT;

-- Existing rows are never deleted or rewritten by this migration. A separate
-- claim table enforces the new rule without requiring legacy rows to conform.
CREATE INDEX IF NOT EXISTS idx_reports_undo_hash ON reports(undo_hash);

CREATE TABLE IF NOT EXISTS report_claims (
  ip_hash    TEXT    NOT NULL,
  country    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, country)
);

INSERT OR IGNORE INTO report_claims (ip_hash, country, created_at)
SELECT ip_hash, country, MIN(created_at)
FROM reports
WHERE source = 'web'
GROUP BY ip_hash, country;
