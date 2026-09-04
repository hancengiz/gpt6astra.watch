-- Add successful account-level "still waiting" confirmations without
-- rewriting or removing any existing watcher, report, or manual waiting row.
ALTER TABLE watchers ADD COLUMN last_waiting_at INTEGER;
ALTER TABLE watchers ADD COLUMN response_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_watchers_waiting
  ON watchers(mode, completed_at, last_waiting_at, country);
