/** Only forwards real same-origin assistant requests. It never fabricates model responses. */
export async function installRealTransport(context, apiUrl, records) {
  const origin = new URL(apiUrl).origin;
  const active = new Set();
  context.on("close", () => { for (const controller of active) controller.abort(); });
  await context.route("**/api/assistant/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const controller = new AbortController();
    active.add(controller);
    const started = performance.now();
    const record = { path, method: request.method(), startedAt: new Date().toISOString() };
    records.push(record);
    const timer = setTimeout(() => controller.abort(), path.endsWith("/track") ? 230000 : 120000);
    try {
      const incomingHeaders = await request.allHeaders();
      const headers = { Origin: origin, Accept: "application/json" };
      for (const name of ["content-type", "x-audio-duration", "x-assistant-word-timing", "x-assistant-animation", "x-assistant-object-tracking"]) {
        if (incomingHeaders[name]) headers[name] = incomingHeaders[name];
      }
      const response = await fetch(origin + path, {
        method: request.method(), headers, redirect: "error", signal: controller.signal,
        ...(request.method() === "POST" ? { body: request.postDataBuffer() } : {}),
      });
      record.status = response.status;
      const body = await response.text();
      record.responseBytes = Buffer.byteLength(body);
      await route.fulfill({ status: response.status, contentType: "application/json", body });
    } catch (error) {
      record.error = { name: error.name, message: error.message };
      await route.abort("failed").catch(() => {});
    } finally {
      record.durationMs = Math.round(performance.now() - started);
      clearTimeout(timer);
      active.delete(controller);
    }
  });
}
