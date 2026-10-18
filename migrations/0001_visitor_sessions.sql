-- Additive migration: preserves the existing shared-db.users table.
CREATE TABLE IF NOT EXISTS rd_visitor_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rd_visitor_sessions_ip_time ON rd_visitor_sessions(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS rd_visitor_sessions_expiry ON rd_visitor_sessions(expires_at);
