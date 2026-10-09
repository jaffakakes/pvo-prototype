import { HttpError } from "../http.js";

/** Task-local intent plus encrypted proof, apart from task/model history. */
export class VerificationStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS account_verifications (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL, private TEXT)",
    );
  }
  key(taskId, operationId) {
    return JSON.stringify([taskId, operationId]);
  }
  get(taskId, operationId) {
    const row = this.sql
      .exec(
        "SELECT * FROM account_verifications WHERE id=?",
        this.key(taskId, operationId),
      )
      .toArray()[0];
    return row ? { ...JSON.parse(row.body), private: row.private } : null;
  }
  entries() {
    return this.sql
      .exec("SELECT body FROM account_verifications")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  save(record, encrypted, expectedRevision) {
    const current = this.get(record.taskId, record.plan.operationId);
    if (
      (current?.revision ?? 0) !== expectedRevision ||
      record.revision !== expectedRevision + 1
    )
      throw new HttpError(
        409,
        "Account verification changed. Resume its saved task.",
      );
    this.sql.exec(
      "INSERT INTO account_verifications(id,task_id,body,private) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,private=excluded.private",
      this.key(record.taskId, record.plan.operationId),
      record.taskId,
      JSON.stringify(record),
      encrypted,
    );
  }
  cancel(taskId, operationId = null) {
    this.sql.exec(
      "UPDATE account_verifications SET private=NULL,body=json_set(body,'$.status','cancelled','$.revision',json_extract(body,'$.revision')+1) WHERE task_id=? AND (? IS NULL OR id=?) AND json_extract(body,'$.status') NOT IN ('consumed','cancelled','expired')",
      taskId,
      operationId,
      operationId === null ? null : this.key(taskId, operationId),
    );
  }
  expire(now) {
    this.sql.exec(
      "UPDATE account_verifications SET private=NULL,body=json_set(body,'$.status','expired','$.revision',json_extract(body,'$.revision')+1) WHERE json_extract(body,'$.plan.expiresAt')<=? AND json_extract(body,'$.status') NOT IN ('consumed','cancelled','expired')",
      now,
    );
    this.sql.exec(
      "DELETE FROM account_verifications WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.id=account_verifications.task_id AND record IS NOT NULL)",
    );
  }
}
