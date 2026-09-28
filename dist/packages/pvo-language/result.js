export class PvoLanguageError extends Error {
  constructor(part, diagnostic) {
    super(`${part} line ${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`);
    this.name = "PvoLanguageError";
    this.part = part;
    this.diagnostic = diagnostic;
  }
}

/** Browser and Worker adapters expose identical Rust diagnostics and output. */
export function readCompilationResult(json) {
  const result = JSON.parse(json);
  if (!result.ok) throw new PvoLanguageError(result.error.part, result.error.diagnostic);
  return result.compiled;
}
