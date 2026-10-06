import {
  admitServiceUsage,
  requireServiceReceiptCapacity,
  serviceCallError,
} from "../../packages/pvo-assistant/hosting/index.js";

/** Atomic state and action receipts. Callers serialize execution and commit through a storage transaction. */
export class ServiceActionStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS service_data (namespace TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS service_actions (namespace TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS service_usage (namespace TEXT PRIMARY KEY,day INTEGER NOT NULL,calls INTEGER NOT NULL,executions INTEGER NOT NULL)`);
  }
  data(namespace, initial) {
    const row = this.sql
      .exec(
        "SELECT body,version FROM service_data WHERE namespace=?",
        namespace,
      )
      .toArray()[0];
    return row
      ? { state: JSON.parse(row.body), version: row.version }
      : { state: structuredClone(initial), version: 0 };
  }
  receipt(namespace, id) {
    const row = this.sql
      .exec(
        "SELECT body FROM service_actions WHERE namespace=? AND id=?",
        namespace,
        id,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  admit(namespace, now, execution = false) {
    const previous = this.sql
      .exec(
        "SELECT day,calls,executions FROM service_usage WHERE namespace=?",
        namespace,
      )
      .toArray()[0];
    if (execution) requireServiceReceiptCapacity(this.usage(namespace));
    const row = admitServiceUsage(previous, now, execution);
    this.sql.exec(
      "INSERT INTO service_usage(namespace,day,calls,executions) VALUES(?,?,?,?) ON CONFLICT(namespace) DO UPDATE SET day=excluded.day,calls=excluded.calls,executions=excluded.executions",
      namespace,
      row.day,
      row.calls,
      row.executions,
    );
  }
  usage(namespace) {
    return this.sql
      .exec(
        "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM service_actions WHERE namespace=?",
        namespace,
      )
      .one();
  }
  commit(namespace, version, state, receipt) {
    const current = this.data(namespace, null);
    if (current.version !== version)
      throw serviceCallError(
        "state_changed",
        "This service changed. Retry the same action.",
      );
    const body = JSON.stringify(receipt),
      bytes = new TextEncoder().encode(body).length,
      usage = this.usage(namespace);
    requireServiceReceiptCapacity(usage, bytes);
    this.sql.exec(
      "INSERT INTO service_data(namespace,body,version) VALUES(?,?,?) ON CONFLICT(namespace) DO UPDATE SET body=excluded.body,version=excluded.version",
      namespace,
      JSON.stringify(state),
      version + 1,
    );
    this.sql.exec(
      "INSERT INTO service_actions(namespace,id,body,bytes) VALUES(?,?,?,?)",
      namespace,
      receipt.actionId,
      body,
      bytes,
    );
  }
  clearAll() {
    for (const table of ["service_data", "service_actions", "service_usage"])
      this.sql.exec(`DELETE FROM ${table}`);
  }
  clearTest(resourceId) {
    const namespace = `test:${resourceId}`;
    for (const table of ["service_data", "service_actions", "service_usage"])
      this.sql.exec(`DELETE FROM ${table} WHERE namespace=?`, namespace);
  }
}
