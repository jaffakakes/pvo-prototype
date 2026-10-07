import {
  SERVICE_CONNECTION_LIMITS,
  serviceCallError,
} from "../../packages/pvo-assistant/hosting/index.js";
import { canonicalJson } from "../../packages/pvo-assistant/services/json.js";

const key = (report) => `${report.kind}:${report.referenceId}`;
const contents = (report) => canonicalJson({ ...report, expectedRevision: 0 });

/** Private dependency index beside releases; never owns code, data, activation or viewer counts. */
export class ServiceConnectionStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS service_connections (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
  }
  records() {
    return this.sql
      .exec("SELECT body FROM service_connections ORDER BY id")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  read(id) {
    const row = this.sql
      .exec("SELECT body FROM service_connections WHERE id=?", id)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  write(record) {
    const body = JSON.stringify(record);
    const previous = this.read(key(record.report));
    const bytes = this.sql
      .exec(
        "SELECT COALESCE(SUM(LENGTH(CAST(body AS BLOB))),0) AS bytes FROM service_connections",
      )
      .toArray()[0].bytes;
    const size = (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (
      bytes - (previous ? size(previous) : 0) + size(record) >
      SERVICE_CONNECTION_LIMITS.storedBytes
    )
      throw serviceCallError(
        "budget_exceeded",
        "The Container connection index is full.",
      );
    this.sql.exec(
      "INSERT INTO service_connections(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      key(record.report),
      body,
    );
    return record;
  }
  report(report, now) {
    const prior = this.read(key(report));
    if (prior && contents(prior.report) === contents(report)) return prior;
    if (prior?.report.kind === "export")
      throw serviceCallError(
        "action_conflict",
        "This export already has different recorded connections.",
      );
    if ((prior?.revision ?? 0) !== report.expectedRevision)
      throw serviceCallError(
        "state_changed",
        "The project connection report changed. Refresh before retrying.",
      );
    const records = this.records();
    if (
      !prior &&
      (records.length >= SERVICE_CONNECTION_LIMITS.records ||
        (report.kind === "export" &&
          records.filter((record) => record.report.kind === "export").length >=
            SERVICE_CONNECTION_LIMITS.exports))
    )
      throw serviceCallError(
        "budget_exceeded",
        "This Container has reached its recorded export limit.",
      );
    return this.write({
      report,
      revision: (prior?.revision ?? 0) + 1,
      recordedAt: now,
      publications: [],
    });
  }
  publication(exportId, publication, now) {
    const record = this.read(`export:${exportId}`);
    if (!record)
      throw serviceCallError(
        "unavailable",
        "Record this export’s connections before its published link.",
      );
    if (record.publications.some((item) => item.id === publication.id))
      return record;
    if (record.publications.length >= SERVICE_CONNECTION_LIMITS.publications)
      throw serviceCallError(
        "budget_exceeded",
        "This export has reached its recorded link limit.",
      );
    return this.write({
      ...record,
      publications: [
        ...record.publications,
        { id: publication.id, title: publication.title, recordedAt: now },
      ],
    });
  }
  clear() {
    this.sql.exec("DELETE FROM service_connections");
  }
}
