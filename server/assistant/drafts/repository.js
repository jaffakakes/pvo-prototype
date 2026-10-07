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
    return {
      identity: saved.draft.identity,
      revision: saved.draft.revision,
      metadata,
      files: files.map((file) => ({
        path: file.path,
        bytes: new TextEncoder().encode(file.content).length,
        codePoints: Array.from(file.content).length,
      })),
      read: saved.read,
      executionReason: saved.reason,
    };
  }
  stopping(taskId, now) {
    const value = this.get(taskId);
    if (value) {
      value.stopPending ||= {
        nextAt: now,
        expiresAt: now + TASK_LIMITS.leaseMs,
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
