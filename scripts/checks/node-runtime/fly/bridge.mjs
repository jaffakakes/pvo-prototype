// Runs inside the disposable guest. Every byte it returns remains untrusted by Restyle.
// The provider's exec endpoint does not deliver stdin on the tested Machines path.
// Arguments contain bounded base64 chunks, never executable source fragments.
const encoded = process.argv.slice(2).join("");
if (encoded.length > 1600 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
  process.exit(2);
const input = Buffer.from(encoded, "base64");
if (input.length > 1200 * 1024 || input.toString("base64") !== encoded)
  process.exit(2);
const request = JSON.parse(input.toString("utf8"));
if (!["/ready", "/execute"].includes(request.path)) process.exit(2);
try {
  const response = await fetch(`http://127.0.0.1:8080${request.path}`, {
    method: request.path === "/ready" ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(request.path === "/execute" ? { body: request.body } : {}),
    signal: AbortSignal.timeout(2000),
  });
  const pieces = [];
  let bytes = 0;
  for await (const piece of response.body) {
    bytes += piece.byteLength;
    if (bytes > 65536) {
      process.stdout.write(JSON.stringify({ status: 413, body: "" }));
      process.exit(0);
    }
    pieces.push(piece);
  }
  process.stdout.write(
    JSON.stringify({
      status: response.status,
      body: Buffer.concat(pieces).toString("utf8"),
    }),
  );
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      status: error.name === "TimeoutError" ? 504 : 503,
      body: "",
    }),
  );
}
