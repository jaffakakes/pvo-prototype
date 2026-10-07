import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";
import {
  id,
  integer,
  object,
} from "../../packages/pvo-assistant/tasks/validation.js";
import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";

/** Private task grants fence delayed AI writes; manual saves still use the same draft command. */
export class DraftWriters {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS draft_writers(task_id TEXT PRIMARY KEY, generation INTEGER NOT NULL, stopped INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
    );
  }
  admit(grant, now) {
    object(grant, ["taskId", "generation", "expiresAt"], "Draft writer grant");
    id(grant.taskId, "Draft task");
    integer(grant.generation, Number.MAX_SAFE_INTEGER, "Draft generation", 1);
    integer(grant.expiresAt, now + TASK_LIMITS.leaseMs, "Draft lease", now + 1);
    this.sql.exec("DELETE FROM draft_writers WHERE expires_at<=?", now);
    const row = this.sql
      .exec("SELECT * FROM draft_writers WHERE task_id=?", grant.taskId)
      .toArray()[0];
    if (row?.stopped || (row && row.generation > grant.generation))
      throw serviceCallError(
        "state_changed",
        "This AI editing attempt has stopped or been replaced.",
      );
    this.sql.exec(
      "INSERT INTO draft_writers(task_id,generation,stopped,expires_at) VALUES(?,?,0,?) ON CONFLICT(task_id) DO UPDATE SET generation=excluded.generation, expires_at=MAX(expires_at,excluded.expires_at)",
      grant.taskId,
      grant.generation,
      grant.expiresAt,
    );
  }
  stop(taskId, now) {
    id(taskId, "Draft task");
    this.sql.exec("DELETE FROM draft_writers WHERE expires_at<=?", now);
    this.sql.exec(
      "INSERT INTO draft_writers(task_id,generation,stopped,expires_at) VALUES(?,0,1,?) ON CONFLICT(task_id) DO UPDATE SET stopped=1, expires_at=MAX(expires_at,excluded.expires_at)",
      taskId,
      now + TASK_LIMITS.leaseMs,
    );
  }
}
