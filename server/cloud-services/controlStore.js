import {
  SERVICE_CONTROL_RECEIPTS,
  serviceCallError,
} from "../../packages/pvo-assistant/hosting/index.js";

/** Small lifecycle receipts; strict expected revisions fence requests older than the retained window. */
export class ServiceControlStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS service_controls (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL)",
    );
  }
  receipt(id, digest) {
    const row = this.sql
      .exec("SELECT body FROM service_controls WHERE id=?", id)
      .toArray()[0];
    if (!row) return null;
    const value = JSON.parse(row.body);
    if (value.digest !== digest)
      throw serviceCallError(
        "action_conflict",
        "This control ID was already used with different input.",
      );
    return value.receipt;
  }
  save(digest, receipt) {
    this.sql.exec(
      "INSERT INTO service_controls(id,revision,body) VALUES(?,?,?)",
      receipt.actionId,
      receipt.revision,
      JSON.stringify({ digest, receipt }),
    );
    this.sql.exec(
      "DELETE FROM service_controls WHERE id NOT IN (SELECT id FROM service_controls ORDER BY revision DESC LIMIT ?)",
      SERVICE_CONTROL_RECEIPTS,
    );
  }
}
