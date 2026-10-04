CREATE TABLE render_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  source_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('uploading', 'queued', 'rendering', 'ready', 'failed', 'cancelled')),
  progress REAL NOT NULL DEFAULT 0,
  result_key TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX render_jobs_owner ON render_jobs(owner_id, status, created_at);
CREATE INDEX render_jobs_expiry ON render_jobs(status, expires_at);
CREATE TABLE render_assets (
  job_id TEXT NOT NULL REFERENCES render_jobs(id),
  id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  content_type TEXT NOT NULL,
  uploaded_at INTEGER,
  active_upload TEXT,
  active_upload_expires_at INTEGER,
  PRIMARY KEY (job_id, id)
);
CREATE INDEX render_assets_job ON render_assets(job_id);
