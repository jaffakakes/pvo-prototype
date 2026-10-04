CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE provider_identities (
  provider TEXT NOT NULL CHECK(provider IN ('google')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, user_id)
);
CREATE INDEX provider_identities_user ON provider_identities(user_id);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('video', 'pvo')),
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'deleting', 'deleted')),
  object_key TEXT,
  active_attempt TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX publications_owner ON publications(owner_id, status, created_at);
CREATE INDEX publications_expiry ON publications(status, expires_at);
CREATE TABLE upload_attempts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  object_key TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX attempts_publication ON upload_attempts(publication_id);
CREATE TABLE maintenance_state (name TEXT PRIMARY KEY, value TEXT NOT NULL);
