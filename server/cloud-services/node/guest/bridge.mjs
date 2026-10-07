// Runs inside the disposable guest. Every byte it returns remains untrusted by Restyle.
// The provider's exec endpoint does not deliver stdin on the tested Machines path.
// Arguments contain bounded base64 chunks, never executable source fragments.
import { request as httpRequest } from "node:http";
const encoded = process.argv.slice(2).join("");
if (encoded.length > 1600 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
  process.exit(2);
const input = Buffer.from(encoded, "base64");
if (input.length > 1200 * 1024 || input.toString("base64") !== encoded)
  process.exit(2);
const request = JSON.parse(input.toString("utf8"));
if (!["/ready", "/execute"].includes(request.path)) process.exit(2);
const signal = AbortSignal.timeout(2000);
let finished = false;
const finish = (status, body = "") => {
  if (finished) return;
  finished = true;
  process.stdout.write(JSON.stringify({ status, body }));
};
const operation = httpRequest(
  {
    hostname: "127.0.0.1",
    port: 8080,
    path: request.path,
    method: request.path === "/ready" ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  },
  (response) => {
    const pieces = [];
    let bytes = 0;
    response.on("data", (piece) => {
      bytes += piece.length;
      if (bytes > 65536) {
        finish(413);
        response.destroy();
        return;
      }
      pieces.push(piece);
    });
    response.once("error", () => finish(signal.aborted ? 504 : 503));
    response.once("end", () =>
      finish(response.statusCode, Buffer.concat(pieces).toString("utf8")),
    );
  },
);
operation.once("error", () => finish(signal.aborted ? 504 : 503));
operation.end(request.path === "/execute" ? request.body : undefined);
