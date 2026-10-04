/** Write a private, uncached JSON response through Node's HTTP adapter. */
export function json(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

export function failure(response, status, message) {
  json(response, status, { error: message });
}
