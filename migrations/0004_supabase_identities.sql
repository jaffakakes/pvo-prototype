CREATE TABLE supabase_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, user_id)
);
CREATE INDEX supabase_identities_user ON supabase_identities(user_id);
