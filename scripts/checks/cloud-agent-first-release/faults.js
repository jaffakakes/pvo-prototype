/** Explicit acceptance faults only; product code never imports this module. */
export function injectSourceFault(decision) {
  if (decision.kind !== "tools") return null;
  const write = decision.calls.find((call) => call.kind === "workspace_write");
  const file = write?.files.find((file) => file.path.startsWith("src/"));
  if (!file) return null;
  const changed = structuredClone(decision);
  const target = changed.calls
    .find((call) => call.kind === "workspace_write")
    .files.find((value) => value.path === file.path);
  target.content +=
    '\n// Deliberate acceptance fault; the model must repair from actual test feedback.\nthrow new Error("Acceptance injected module startup failure");\n';
  return { decision: changed, path: file.path };
}

export function acceptanceFaults(storage) {
  storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS acceptance_faults (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
  );
  return {
    has: (id) =>
      storage.sql
        .exec("SELECT 1 FROM acceptance_faults WHERE id=?", id)
        .toArray().length > 0,
    save(id, value) {
      storage.sql.exec(
        "INSERT INTO acceptance_faults (id,body) VALUES (?,?)",
        id,
        JSON.stringify({ ...value, observedAt: new Date().toISOString() }),
      );
    },
    report: () =>
      storage.sql
        .exec("SELECT id,body FROM acceptance_faults ORDER BY rowid")
        .toArray()
        .map((row) => ({ id: row.id, ...JSON.parse(row.body) })),
  };
}
