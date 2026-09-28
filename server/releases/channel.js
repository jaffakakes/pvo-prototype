import { DurableObject } from "cloudflare:workers";

// One coordination object for this deployment's beta release channel.
export class ReleaseChannel extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS release (id INTEGER PRIMARY KEY, revision TEXT NOT NULL)");
  }

  fetch() {
    const [client, socket] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(socket);
    const current = this.ctx.storage.sql.exec("SELECT revision FROM release WHERE id = 1").toArray()[0];
    if (current) socket.send(JSON.stringify({ type: "release", revision: current.revision }));
    return new Response(null, { status: 101, webSocket: client });
  }

  announce(revision) {
    const current = this.ctx.storage.sql.exec("SELECT revision FROM release WHERE id = 1").toArray()[0];
    if (current?.revision === revision) return;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO release (id, revision) VALUES (1, ?)", revision);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(JSON.stringify({ type: "release", revision }));
      } catch {
        socket.close(1011, "Reconnect for the latest release");
      }
    }
  }

  webSocketMessage(socket) {
    socket.close(1008, "This channel only sends release notifications");
  }

  webSocketClose() {
    // The configured runtime auto-replies to close frames, including peers
    // that close without a status code (1005 must not be sent on the wire).
  }

  webSocketError(socket) {
    socket.close(1011, "Reconnect for the latest release");
  }
}
