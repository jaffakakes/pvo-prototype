/** SQLite persistence only. Domain lifecycle rules and Container effects live outside it. */
export class WorkspaceJournal {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS workspace_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS workspace_source (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS workspace_actions (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
  }
  state() {
    const row = this.sql
      .exec("SELECT body FROM workspace_state WHERE id=1")
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  saveState(state) {
    this.sql.exec(
      "INSERT INTO workspace_state (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      JSON.stringify(state),
    );
  }
  source() {
    const row = this.sql
      .exec("SELECT body FROM workspace_source WHERE id=1")
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  saveSource(snapshot) {
    this.sql.exec(
      "INSERT INTO workspace_source (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      JSON.stringify(snapshot),
    );
  }
  action(id) {
    const row = this.sql
      .exec("SELECT body FROM workspace_actions WHERE id=?", id)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  saveAction(action) {
    this.sql.exec(
      "INSERT INTO workspace_actions (id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      action.id,
      JSON.stringify(action),
    );
  }
  actionCount() {
    return this.sql
      .exec("SELECT COUNT(*) AS count FROM workspace_actions")
      .one().count;
  }
  expireContent() {
    this.sql.exec("DELETE FROM workspace_source");
    this.sql.exec("DELETE FROM workspace_actions");
  }
}
