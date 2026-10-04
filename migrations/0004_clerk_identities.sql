CREATE TABLE managed_identities (
  provider TEXT NOT NULL CHECK(provider IN ('clerk')),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (provider, issuer, subject),
  UNIQUE (provider, issuer, user_id)
);
CREATE INDEX managed_identities_user ON managed_identities(user_id);
