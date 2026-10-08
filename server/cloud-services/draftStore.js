import {
  parseServiceDraft,
  SERVICE_DRAFT_LIMITS,
} from "../../packages/pvo-assistant/services/index.js";
import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";

/** The service host owns the enclosing transaction and authorizes every read/write. */
export class ServiceDraftStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS service_draft (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS service_draft_receipts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, digest TEXT NOT NULL)`);
  }
  read() {
    const row = this.sql
      .exec("SELECT body FROM service_draft WHERE id=1")
      .toArray()[0];
    return row ? parseServiceDraft(JSON.parse(row.body)) : null;
  }
  write(value) {
    const draft = parseServiceDraft(value);
    this.sql.exec(
      "INSERT INTO service_draft(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      JSON.stringify(draft),
    );
    return draft;
  }
  initialize(identity, content, now) {
    return (
      this.read() ??
      this.write({ identity, content, revision: 0, updatedAt: now })
    );
  }
  save(command, digest, now) {
    const draft = this.read();
    if (!draft)
      throw serviceCallError(
        "unavailable",
        "This Container draft is unavailable.",
      );
    const prior = this.sql
      .exec(
        "SELECT revision,digest FROM service_draft_receipts WHERE id=?",
        command.actionId,
      )
      .toArray()[0];
    if (prior) {
      if (prior.digest !== digest)
        throw serviceCallError(
          "action_conflict",
          "This save ID already has different content.",
        );
      return {
        draft,
        receipt: { actionId: command.actionId, revision: prior.revision },
      };
    }
    if (draft.revision !== command.expectedRevision)
      throw serviceCallError(
        "state_changed",
        "The draft changed. Your edits have not replaced the newer draft.",
      );
    const next = this.write({
      ...draft,
      content: command.content,
      revision: draft.revision + 1,
      updatedAt: now,
    });
    this.sql.exec(
      "INSERT INTO service_draft_receipts(id,revision,digest) VALUES(?,?,?)",
      command.actionId,
      next.revision,
      digest,
    );
    this.sql.exec(
      "DELETE FROM service_draft_receipts WHERE id NOT IN (SELECT id FROM service_draft_receipts ORDER BY revision DESC LIMIT ?)",
      SERVICE_DRAFT_LIMITS.receipts,
    );
    return {
      draft: next,
      receipt: { actionId: command.actionId, revision: next.revision },
    };
  }
  clear() {
    this.sql.exec(
      "DELETE FROM service_draft; DELETE FROM service_draft_receipts",
    );
  }
}
