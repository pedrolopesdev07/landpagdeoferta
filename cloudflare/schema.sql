CREATE TABLE IF NOT EXISTS landing_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS landing_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS landing_sessions_expiry ON landing_sessions(expires_at);
CREATE TABLE IF NOT EXISTS landing_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS landing_rate_expiry ON landing_rate_limits(expires_at);
CREATE TABLE IF NOT EXISTS landing_uploads (
  filename TEXT PRIMARY KEY,
  body BLOB NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS landing_catalog (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sequence INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  offers TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS landing_sync_nonces (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS landing_nonce_expiry ON landing_sync_nonces(expires_at);
CREATE TABLE IF NOT EXISTS landing_sync_receipts (
  operation_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS landing_receipt_expiry ON landing_sync_receipts(created_at);
