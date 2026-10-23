import {
  parseConnectionMetadata,
  parseConnectionPage,
} from "../../packages/pvo-assistant/connections/index.js";

/** Account-owned metadata in the existing owner-bound Durable Object. Never stores credentials. */
export class ConnectionCatalog {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS account_connections (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
  }
  get(id) {
    const row = this.sql
      .exec("SELECT body FROM account_connections WHERE id=?", id)
      .toArray()[0];
    return row ? parseConnectionMetadata(JSON.parse(row.body)) : null;
  }
  version() {
    return this.sql
      .exec(
        "SELECT COALESCE(SUM(json_extract(body,'$.revision')),0) AS version FROM account_connections",
      )
      .one().version;
  }
  page(after) {
    const rows = this.sql
      .exec(
        "SELECT body FROM account_connections WHERE id>? ORDER BY id LIMIT 5",
        after ?? "",
      )
      .toArray();
    const connections = rows
      .slice(0, 4)
      .map((row) => parseConnectionMetadata(JSON.parse(row.body)));
    return parseConnectionPage({
      connections,
      version: this.version(),
      next: rows.length > 4 ? connections.at(-1).id : null,
    });
  }
  /** Internal setup boundary, deliberately absent from public routes and model tools. */
  save(value, expectedRevision) {
    const connection = parseConnectionMetadata(value);
    const prior = this.get(connection.id);
    if (
      (prior?.revision ?? 0) !== expectedRevision ||
      connection.revision !== expectedRevision + 1
    )
      throw new Error("Connection metadata revision is stale.");
    this.sql.exec(
      "INSERT INTO account_connections(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      connection.id,
      JSON.stringify(connection),
    );
    return connection;
  }
}
