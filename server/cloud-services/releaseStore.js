import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";
import {
  INACTIVE_SERVICE_LIMITS,
  sameServiceIdentity,
  parseServicePublication,
} from "../../packages/pvo-assistant/releases/index.js";
import { HttpError } from "../http.js";

/** Persistent inactive-release bytes and tombstone. The caller owns transactions and alarms. */
export class InactiveReleaseStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS release (id INTEGER PRIMARY KEY CHECK (id = 1), identity TEXT NOT NULL, body TEXT, probes INTEGER NOT NULL DEFAULT 0)",
    );
  }
  row() {
    return this.sql
      .exec("SELECT identity, body, probes FROM release WHERE id = 1")
      .toArray()[0];
  }
  current(identity, now) {
    const stored = this.row();
    if (!stored) return null;
    if (!sameServiceIdentity(JSON.parse(stored.identity), identity))
      throw new HttpError(
        409,
        "Service ownership or immutable contents conflict.",
      );
    if (now >= identity.expiresAt && stored.body !== null) {
      this.sql.exec("UPDATE release SET body = NULL WHERE id = 1");
      stored.body = null;
    }
    return stored;
  }
  observation(identity, row) {
    return {
      identity,
      state: !row ? "missing" : row.body === null ? "deleted" : "available",
    };
  }
  publish(identity, body, now) {
    let current = this.current(identity, now);
    if (!current) {
      if (identity.expiresAt > now + TASK_LIMITS.lifetimeMs)
        throw new HttpError(400, "Inactive service lifetime exceeded.");
      this.sql.exec(
        "INSERT INTO release (id, identity, body) VALUES (1, ?, ?)",
        JSON.stringify(identity),
        now < identity.expiresAt ? body : null,
      );
      current = this.row();
    } else if (current.body !== null && current.body !== body)
      throw new HttpError(409, "Published source cannot be replaced.");
    return current;
  }
  cancel(identity, now) {
    this.current(identity, now);
    // A missing publish still needs a tombstone: its delayed RPC cannot resurrect this release.
    this.sql.exec(
      "INSERT INTO release (id, identity, body) VALUES (1, ?, NULL) ON CONFLICT(id) DO UPDATE SET body = NULL",
      JSON.stringify(identity),
    );
  }
  consumeProbe(identity, now) {
    const row = this.current(identity, now);
    if (!row || row.body === null)
      throw new HttpError(404, "Inactive service is unavailable.");
    if (row.probes >= INACTIVE_SERVICE_LIMITS.probes)
      throw new HttpError(429, "Inactive service probe limit reached.");
    this.sql.exec("UPDATE release SET probes = probes + 1 WHERE id = 1");
    return parseServicePublication(JSON.parse(row.body));
  }
}
