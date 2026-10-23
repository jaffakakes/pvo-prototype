import { ADAPTER_LIMITS } from "../../packages/pvo-assistant/connections/index.js";
import { HttpError } from "../http.js";

/** Provider receipts survive lost replies and service lifecycle changes. Never store credentials. */
export class AccountRequestStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS account_requests (id TEXT PRIMARY KEY, serviceId TEXT NOT NULL, body TEXT NOT NULL, bytes INTEGER NOT NULL)",
    );
  }
  get(id) {
    const row = this.sql
      .exec("SELECT body FROM account_requests WHERE id=?", id)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  save(value) {
    const body = JSON.stringify(value),
      bytes =
        new TextEncoder().encode(body).length +
        (value.status === "completed" ? 0 : ADAPTER_LIMITS.resultBytes + 1024);
    const prior = this.sql
      .exec("SELECT bytes FROM account_requests WHERE id=?", value.id)
      .toArray()[0];
    const used = this.sql
      .exec(
        "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM account_requests",
      )
      .one();
    const previousBytes = prior?.bytes ?? 0;
    if (
      (!prior && used.count >= 2048) ||
      used.bytes - previousBytes + bytes > 16 * 1024 * 1024
    )
      throw new HttpError(
        429,
        "Outside-action records are full. Resolve pending actions before continuing.",
      );
    this.sql.exec(
      "INSERT INTO account_requests(id,serviceId,body,bytes) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,bytes=excluded.bytes",
      value.id,
      value.serviceId,
      body,
      bytes,
    );
  }
  forgetCompleted(serviceId) {
    for (const row of this.sql
      .exec("SELECT id,body FROM account_requests WHERE serviceId=?", serviceId)
      .toArray()) {
      if (JSON.parse(row.body).status === "completed")
        this.sql.exec("DELETE FROM account_requests WHERE id=?", row.id);
    }
  }
}
