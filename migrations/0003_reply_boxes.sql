CREATE TABLE reply_boxes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX reply_boxes_owner ON reply_boxes(owner_id, created_at);
CREATE INDEX reply_boxes_expiry ON reply_boxes(expires_at);

CREATE TABLE replies (
  id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL REFERENCES reply_boxes(id),
  answers_json TEXT NOT NULL,
  source_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX replies_box_created ON replies(box_id, created_at);
CREATE INDEX replies_box_source_created ON replies(box_id, source_hash, created_at);
