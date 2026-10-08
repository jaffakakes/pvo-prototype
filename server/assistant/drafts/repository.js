import { repairEvidence } from "../../../packages/pvo-assistant/maintenance/index.js";
import { repairReport } from "../maintenance/repair.js";
import { TASK_LIMITS } from "../../../packages/pvo-assistant/tasks/index.js";
import { parseServiceDraft } from "../../../packages/pvo-assistant/services/index.js";

/** Task-owned working copy and exact pending save; the hosted draft remains authoritative. */
export class TaskDrafts {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS task_drafts(task_id TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
  }
  get(taskId) {
    const row = this.sql
      .exec("SELECT body FROM task_drafts WHERE task_id=?", taskId)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  write(taskId, value) {
    parseServiceDraft(value.draft);
    this.sql.exec(
      "INSERT INTO task_drafts(task_id,body) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET body=excluded.body",
      taskId,
      JSON.stringify(value),
    );
  }
  initialize(taskId, draft) {
    if (!this.get(taskId))
      this.write(taskId, {
        draft,
        read: null,
        pending: null,
        reason: null,
        testingRevision: null,
        stopPending: false,
      });
  }
  context(taskId) {
    const saved = this.get(taskId);
    if (!saved) throw new Error("The owned draft working copy is missing.");
    const { files, ...metadata } = saved.draft.content;
    let remainingInlineBytes = 128 * 1024;
    return {
      identity: saved.draft.identity,
      revision: saved.draft.revision,
      metadata,
      files: files.map((file) => {
        const bytes = new TextEncoder().encode(file.content).length;
        const include = bytes <= 16 * 1024 && bytes <= remainingInlineBytes;
        if (include) remainingInlineBytes -= bytes;
        return {
          path: file.path,
          bytes,
          codePoints: Array.from(file.content).length,
          ...(include ? { content: file.content } : {}),
        };
      }),
      read: saved.read,
      executionReason: saved.reason,
      maintenance: saved.maintenance
        ? {
            ...saved.maintenance,
            snapshot: {
              ...saved.maintenance.snapshot,
              published: saved.maintenance.snapshot.published
                ? {
                    releaseId: saved.maintenance.snapshot.published.releaseId,
                    entrypoint:
                      saved.maintenance.snapshot.published.source.entrypoint,
                    files:
                      saved.maintenance.snapshot.published.source.files.map(
                        ({ path, content }) => ({
                          path,
                          codePoints: Array.from(content).length,
                        }),
                      ),
                  }
                : null,
            },
            agreement: undefined,
            tests: undefined,
            original: undefined,
            evidence: repairEvidence(saved.maintenance),
            report: repairReport(saved),
          }
        : null,
    };
  }
  stopping(taskId, now) {
    const value = this.get(taskId);
    if (value) {
      value.stopPending ||= {
        nextAt: now,
        expiresAt: now + TASK_LIMITS.defaultLeaseMs,
        attempts: 0,
      };
      this.write(taskId, value);
    }
  }
  pendingStops() {
    return this.sql
      .exec("SELECT task_id,body FROM task_drafts")
      .toArray()
      .filter((row) => JSON.parse(row.body).stopPending)
      .map((row) => ({ taskId: row.task_id, ...JSON.parse(row.body) }));
  }
  prune() {
    // Unconfirmed Stop fences keep the task working copy until reconciled.
    for (const row of this.sql
      .exec(
        "SELECT task_id,body FROM task_drafts WHERE task_id NOT IN (SELECT id FROM tasks WHERE record IS NOT NULL)",
      )
      .toArray())
      if (!JSON.parse(row.body).stopPending)
        this.sql.exec("DELETE FROM task_drafts WHERE task_id=?", row.task_id);
  }
}
