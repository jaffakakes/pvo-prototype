import {
  admitServiceUsage,
  requireServiceReceiptCapacity,
  serviceCallError,
  SERVICE_RECORD_LIMITS,
  SERVICE_FAILURE_CODES,
} from "../../packages/pvo-assistant/hosting/index.js";

/** Atomic state and action receipts. Callers serialize execution and commit through a storage transaction. */
export class ServiceActionStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS service_data (namespace TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS service_actions (namespace TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS service_usage (namespace TEXT PRIMARY KEY,day INTEGER NOT NULL,calls INTEGER NOT NULL,executions INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS service_failures (namespace TEXT NOT NULL,body TEXT NOT NULL)`);
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
  initializeLive(state) {
    this.sql.exec(
      "INSERT INTO service_data(namespace,body,version) VALUES('live',?,0) ON CONFLICT(namespace) DO NOTHING",
      JSON.stringify(state),
    );
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
  records(namespace, initial, now) {
    const snapshot = this.data(namespace, initial);
    const stored =
      this.sql
        .exec("SELECT 1 FROM service_data WHERE namespace=?", namespace)
        .toArray().length > 0;
    const day = Math.floor(now / 86400000);
    const usage = this.sql
      .exec(
        "SELECT day,calls,executions FROM service_usage WHERE namespace=? AND day=?",
        namespace,
        day,
      )
      .toArray()[0] ?? { day, calls: 0, executions: 0 };
    const results = this.sql
      .exec(
        "SELECT body FROM service_actions WHERE namespace=? ORDER BY rowid DESC LIMIT ?",
        namespace,
        SERVICE_RECORD_LIMITS.results,
      )
      .toArray()
      .map((row) => {
        const { actionId, operation, releaseId, createdAt, result } =
          JSON.parse(row.body);
        return {
          actionId,
          operation,
          releaseId,
          createdAt,
          resultJson: JSON.stringify(result),
        };
      });
    const failures = this.sql
      .exec(
        "SELECT body FROM service_failures WHERE namespace=? ORDER BY rowid DESC LIMIT ?",
        namespace,
        SERVICE_RECORD_LIMITS.failures,
      )
      .toArray()
      .map((row) => JSON.parse(row.body));
    return {
      stored,
      version: snapshot.version,
      recordsJson: JSON.stringify(snapshot.state),
      usage,
      receipts: this.usage(namespace),
      results,
      failures,
    };
  }
  failure(namespace, action, releaseId, code, at) {
    const failure = {
      actionId: action.actionId,
      operation: action.operation,
      releaseId,
      at,
      code: SERVICE_FAILURE_CODES.includes(code) ? code : "execution_failed",
    };
    this.sql.exec(
      "INSERT INTO service_failures(namespace,body) VALUES(?,?)",
      namespace,
      JSON.stringify(failure),
    );
    this.sql.exec(
      "DELETE FROM service_failures WHERE namespace=? AND rowid NOT IN (SELECT rowid FROM service_failures WHERE namespace=? ORDER BY rowid DESC LIMIT ?)",
      namespace,
      namespace,
      SERVICE_RECORD_LIMITS.failures,
    );
  }
  resetTest(resourceId, initial) {
    const namespace = `test:${resourceId}`;
    const snapshot = this.data(namespace, initial);
    // Keep usage and action receipts: old retries still replay their original result.
    this.sql.exec(
      "INSERT INTO service_data(namespace,body,version) VALUES(?,?,?) ON CONFLICT(namespace) DO UPDATE SET body=excluded.body,version=excluded.version",
      namespace,
      JSON.stringify(initial),
      snapshot.version + 1,
    );
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
    for (const table of [
      "service_data",
      "service_actions",
      "service_usage",
      "service_failures",
    ])
      this.sql.exec(`DELETE FROM ${table}`);
  }
  clearTest(resourceId) {
    const namespace = `test:${resourceId}`;
    for (const table of [
      "service_data",
      "service_actions",
      "service_usage",
      "service_failures",
    ])
      this.sql.exec(`DELETE FROM ${table} WHERE namespace=?`, namespace);
  }
}
