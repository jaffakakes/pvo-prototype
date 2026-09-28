function quotedEnd(source: string, start: number): number {
  for (let at = start + 1; at < source.length; at += 1) {
    if (source[at] === "\\") at += 1;
    else if (source[at] === '"') return at + 1;
  }
  return source.length;
}

function argumentEnd(source: string, start: number): number {
  for (let at = start; at < source.length; at += 1) {
    if (source[at] === '"') at = quotedEnd(source, at) - 1;
    else if (source[at] === ")") return at;
  }
  return -1;
}

function clearedRoute(value: unknown, deleted: ReadonlySet<string>): unknown {
  if (!value || typeof value !== "object") return value;
  const route = value as Record<string, unknown>;
  return route.kind === "scene" && typeof route.sceneId === "string" && deleted.has(route.sceneId)
    ? { kind: "continue" } : value;
}

function replaceArgument(name: string, value: unknown, deleted: ReadonlySet<string>): string | null {
  if (name === "go_to_scene")
    return typeof value === "string" && deleted.has(value) ? "continue()" : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  const onSuccess = clearedRoute(request.onSuccess, deleted);
  const onError = clearedRoute(request.onError, deleted);
  if (onSuccess === request.onSuccess && onError === request.onError) return null;
  return `request(${JSON.stringify({ ...request, onSuccess, onError })})`;
}

/** Visit only complete calls, skipping quoted body text and comments in drafts. */
function rewriteLanguageCalls(source: string, replace: (name: string, value: unknown) => string | null): string {
  let result = "";
  let copied = 0;
  for (let at = 0; at < source.length;) {
    if (source[at] === '"') {
      at = quotedEnd(source, at);
      continue;
    }
    if (source.startsWith("//", at)) {
      const end = source.indexOf("\n", at);
      at = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", at)) {
      const end = source.indexOf("*/", at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(at))?.[0];
    if (!word) {
      at += 1;
      continue;
    }
    const start = at;
    at += word.length;
    if (word !== "go_to_scene" && word !== "request") continue;
    while (/\s/.test(source[at] ?? "")) at += 1;
    if (source[at] !== "(") continue;
    const end = argumentEnd(source, at + 1);
    if (end < 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(source.slice(at + 1, end));
    } catch {
      // An unfinished Logic draft remains editable; never replace unrelated source.
      at = end + 1;
      continue;
    }
    const replacement = replace(word, value);
    if (replacement !== null) {
      result += source.slice(copied, start) + replacement;
      copied = end + 1;
    }
    at = end + 1;
  }
  return result + source.slice(copied);
}

export function clearDeletedLanguageRoutes(source: string, deleted: ReadonlySet<string>): string {
  return rewriteLanguageCalls(source, (name, value) => replaceArgument(name, value, deleted));
}

export function remapComponentTemplates(source: string, ids: ReadonlyMap<string, string>): string {
  return source.replace(/\{state\.(form|responses)\.([A-Za-z0-9_-]+)(?=[.}])/g,
    (match, kind: string, id: string) => ids.has(id) ? `{state.${kind}.${ids.get(id)}` : match);
}

export function remapLanguageComponentTemplates(source: string, ids: ReadonlyMap<string, string>): string {
  return rewriteLanguageCalls(source, (name, value) => {
    if (name !== "request" || !value || typeof value !== "object" || Array.isArray(value)) return null;
    const request = value as Record<string, unknown>;
    const url = typeof request.url === "string" ? remapComponentTemplates(request.url, ids) : request.url;
    const body = typeof request.body === "string" ? remapComponentTemplates(request.body, ids) : request.body;
    if (url === request.url && body === request.body) return null;
    return `request(${JSON.stringify({ ...request, url, body })})`;
  });
}
