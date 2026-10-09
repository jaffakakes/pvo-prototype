import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";
import { canonicalJson } from "../../packages/pvo-assistant/services/json.js";

/** Approved immutable bindings and one recoverable connected invocation per data namespace. */
export class ServiceAccountStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS service_account_approvals (releaseId TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS service_account_attempts (namespace TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS service_account_epoch (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
      INSERT OR IGNORE INTO service_account_epoch(id,value) VALUES(1,0)`);
  }
  approval(releaseId) {
    const row = this.sql
      .exec(
        "SELECT body FROM service_account_approvals WHERE releaseId=?",
        releaseId,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  approve(releaseId, bindings, at) {
    this.sql.exec(
      "INSERT INTO service_account_approvals(releaseId,body) VALUES(?,?) ON CONFLICT(releaseId) DO UPDATE SET body=excluded.body",
      releaseId,
      JSON.stringify({ bindings: canonicalJson(bindings), at }),
    );
  }
  epoch() {
    return this.sql
      .exec("SELECT value FROM service_account_epoch WHERE id=1")
      .one().value;
  }
  revoke(releaseId) {
    this.sql.exec("UPDATE service_account_epoch SET value=value+1 WHERE id=1");
    this.sql.exec(
      "DELETE FROM service_account_approvals WHERE releaseId=?",
      releaseId,
    );
  }
  requireApproval(releaseId, bindings) {
    if (
      bindings?.length &&
      this.approval(releaseId)?.bindings !== canonicalJson(bindings)
    )
      throw serviceCallError(
        "forbidden",
        "Review and approve this version's account access before publishing or running it.",
      );
  }
  pending(namespace) {
    const row = this.sql
      .exec(
        "SELECT body FROM service_account_attempts WHERE namespace=?",
        namespace,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  begin(namespace, value) {
    const current = this.pending(namespace);
    if (current) {
      if (current.action.actionId !== value.action.actionId)
        throw serviceCallError(
          "needs_checking",
          "A previous outside action needs checking. Check that saved action before starting another.",
        );
      if (current.digest !== value.digest)
        throw serviceCallError(
          "action_conflict",
          "This saved action already has different input.",
        );
      if (
        current.releaseId !== value.releaseId ||
        current.version !== value.version
      )
        throw serviceCallError(
          "needs_checking",
          "The Container changed while an outside action was pending. Its existing request must be checked.",
        );
      return current;
    }
    const attempt = {
      ...value,
      trace: [],
      writeStarted: false,
      status: "running",
    };
    this.save(namespace, attempt);
    return attempt;
  }
  save(namespace, value) {
    const body = JSON.stringify(value);
    if (new TextEncoder().encode(body).length > 160 * 1024)
      throw serviceCallError(
        "invalid_result",
        "The saved outside action exceeds its record limit.",
      );
    this.sql.exec(
      "INSERT INTO service_account_attempts(namespace,body) VALUES(?,?) ON CONFLICT(namespace) DO UPDATE SET body=excluded.body",
      namespace,
      body,
    );
  }
  fail(namespace, actionId) {
    const current = this.pending(namespace);
    if (current?.action.actionId !== actionId) return;
    if (current.writeStarted)
      this.save(namespace, { ...current, status: "needs_checking" });
    else this.finish(namespace);
  }
  finish(namespace) {
    this.sql.exec(
      "DELETE FROM service_account_attempts WHERE namespace=?",
      namespace,
    );
  }
  clear() {
    this.sql.exec("UPDATE service_account_epoch SET value=value+1 WHERE id=1");
    this.sql.exec("DELETE FROM service_account_attempts");
    this.sql.exec("DELETE FROM service_account_approvals");
  }
}
