import {
  matchPreparedTaskResult,
  prepareTaskResult,
  serializePreparedTaskResult,
} from "../../../packages/pvo-assistant/results/index.js";
import { HttpError } from "../../http.js";

/** Bounded immutable result bytes share the owner's SQLite transaction with ready state. */
export class TaskResults {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS task_results (task_id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, body TEXT NOT NULL);`);
  }

  async encode(task, operations) {
    const body = serializePreparedTaskResult(
      prepareTaskResult(task, operations),
    );
    const bytes = new TextEncoder().encode(body);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return {
      body,
      artifact: {
        id: task.id,
        bytes: bytes.byteLength,
        sha256: Array.from(hash, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      },
    };
  }

  save(task, encoded) {
    matchPreparedTaskResult(JSON.parse(encoded.body), task);
    const existing = this.sql
      .exec(
        "SELECT sha256, bytes, body FROM task_results WHERE task_id = ?",
        task.id,
      )
      .toArray()[0];
    if (existing) {
      if (
        existing.sha256 !== encoded.artifact.sha256 ||
        existing.bytes !== encoded.artifact.bytes ||
        existing.body !== encoded.body
      )
        throw new HttpError(409, "A prepared task result cannot be replaced.");
      return;
    }
    this.sql.exec(
      "INSERT INTO task_results (task_id, sha256, bytes, body) VALUES (?, ?, ?, ?)",
      task.id,
      encoded.artifact.sha256,
      encoded.artifact.bytes,
      encoded.body,
    );
  }

  read(task) {
    if (task.state !== "ready" || !task.result)
      throw new HttpError(409, "This task has no prepared result yet.");
    const stored = this.sql
      .exec(
        "SELECT sha256, bytes, body FROM task_results WHERE task_id = ?",
        task.id,
      )
      .toArray()[0];
    const artifact = task.result.artifact;
    if (
      !stored ||
      artifact.id !== task.id ||
      artifact.sha256 !== stored.sha256 ||
      artifact.bytes !== stored.bytes
    )
      throw new HttpError(
        503,
        "The prepared result is unavailable. Retry later.",
      );
    matchPreparedTaskResult(JSON.parse(stored.body), task);
    return stored.body;
  }

  prune() {
    this.sql.exec(
      "DELETE FROM task_results WHERE task_id NOT IN (SELECT id FROM tasks WHERE record IS NOT NULL)",
    );
  }
}
