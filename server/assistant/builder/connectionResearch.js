/** AI adapter proposals need saved research from this task; research never grants account access. */
export function requireConnectionResearch(coordinator, task, agreement) {
  for (const binding of agreement.connections ?? []) {
    const connection = coordinator.connections.get(binding.connectionId);
    if (
      connection?.status !== "connected" ||
      connection.provider !== binding.adapter.provider ||
      !connection.permissions.includes(binding.adapter.permission)
    )
      throw new Error(
        "Inspect and connect the required account permission before proposing this adapter.",
      );
    const url = new URL(binding.adapter.documentation);
    url.hash = "";
    const row = coordinator.research.sql
      .exec(
        "SELECT body FROM task_research WHERE task_id=? AND json_extract(body,'$.tool.kind')='web_evidence' AND json_extract(body,'$.result.status')='completed' AND json_extract(body,'$.result.result.source.url')=? ORDER BY rowid DESC LIMIT 1",
        task.id,
        url.href,
      )
      .toArray()[0];
    const note = row && JSON.parse(row.body).result.result;
    if (
      note?.assessment.support !== "documented" ||
      note.verification !== "source_text_only"
    )
      throw new Error(
        "Read this adapter's documentation and save documented web evidence in this task before proposing its agreement.",
      );
    const page = coordinator.research.get(task.id, note.source.operationId);
    if (
      !page?.settled ||
      page.tool.kind !== "web_read" ||
      page.result?.status !== "completed" ||
      page.result.result.url !== url.href
    )
      throw new Error(
        "The adapter research must refer to a completed page read in this task.",
      );
  }
}
