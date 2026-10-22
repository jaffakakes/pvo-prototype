import { parseIdentityChannel } from "../../packages/pvo-assistant/identity/index.js";
import { HttpError } from "../http.js";

/** Two account-owned channel records; private bootstrap material is always an encrypted envelope. */
export class IdentityStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS agent_identity_channels (provider TEXT PRIMARY KEY, body TEXT NOT NULL, private TEXT)",
    );
  }
  get(provider) {
    const row = this.sql
      .exec("SELECT * FROM agent_identity_channels WHERE provider=?", provider)
      .toArray()[0];
    return row
      ? {
          channel: parseIdentityChannel(JSON.parse(row.body)),
          private: row.private,
        }
      : null;
  }
  save(channel, encrypted, expectedRevision) {
    parseIdentityChannel(channel);
    if (
      (this.get(channel.provider)?.channel.revision ?? 0) !==
        expectedRevision ||
      channel.revision !== expectedRevision + 1
    )
      throw new HttpError(
        409,
        "This identity changed. Refresh its saved status.",
      );
    this.sql.exec(
      "INSERT INTO agent_identity_channels(provider,body,private) VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET body=excluded.body,private=excluded.private",
      channel.provider,
      JSON.stringify(channel),
      encrypted,
    );
  }
}
