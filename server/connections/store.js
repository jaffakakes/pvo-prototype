import { HttpError } from "../http.js";

/** Protected setup details and encrypted credentials; never selected by the model's catalog. */
export class ConnectionStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS account_connection_secrets (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, details TEXT NOT NULL, credential TEXT)",
    );
  }
  get(id) {
    const row = this.sql
      .exec("SELECT * FROM account_connection_secrets WHERE id=?", id)
      .toArray()[0];
    return row ? { ...row, details: JSON.parse(row.details) } : null;
  }
  save(id, revision, details, credential) {
    if (
      !this.get(id) &&
      this.sql
        .exec("SELECT COUNT(*) AS count FROM account_connection_secrets")
        .one().count >= 32
    )
      throw new HttpError(
        429,
        "This account has reached its connection limit.",
      );
    this.sql.exec(
      "INSERT INTO account_connection_secrets(id,revision,details,credential) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,details=excluded.details,credential=excluded.credential",
      id,
      revision,
      JSON.stringify(details),
      credential,
    );
  }
}
