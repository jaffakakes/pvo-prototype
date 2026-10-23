import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, extname, relative, sep } from "node:path";
import ts from "typescript";

const ignored = new Set([
  "node_modules",
  "dist",
  "target",
  "pkg",
  ".git",
  ".wrangler",
]);
const codeFile = (path) =>
  /\.(?:[cm]?js|tsx?)$/.test(path) && !path.endsWith(".d.ts");
async function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/** Conservative module reachability, including fixture strings, public APIs and HTML/worker assets. */
export async function analyzeEntryGraph(root, policy) {
  root = resolve(root);
  const canonical = (path) => path.split(sep).join("/");
  const named = (path) => canonical(relative(root, path));
  const below = async (directories) => [
    ...new Set(
      (
        await Promise.all(
          directories.map((directory) => filesBelow(resolve(root, directory))),
        )
      ).flat(),
    ),
  ];
  const runtime = (await below(policy.runtimeDirectories)).filter(codeFile);
  const tooling = (await below(policy.toolDirectories)).filter(codeFile);
  const html = (await below(policy.htmlDirectories)).filter(
    (path) => extname(path) === ".html",
  );
  const all = [...new Set([...runtime, ...tooling, ...html])];
  const graph = new Map();
  const executable = new Set();
  function resolveReference(file, reference) {
    if (
      typeof reference !== "string" ||
      /^(?:https?:|node:|data:|cloudflare:)/.test(reference)
    )
      return null;
    const clean = reference.split(/[?#]/, 1)[0];
    const paths = clean.startsWith("/src/")
      ? [resolve(root, "editor", clean.slice(1))]
      : clean.startsWith("/")
        ? [resolve(root, clean.slice(1))]
        : [resolve(dirname(file), clean), resolve(root, clean)];
    for (const base of paths)
      for (const candidate of [
        base,
        ...[
          ".ts",
          ".tsx",
          ".js",
          ".mjs",
          "/index.ts",
          "/index.tsx",
          "/index.js",
        ].map((extension) => base + extension),
      ])
        if (existsSync(candidate) && graph.has(candidate)) return candidate;
    return null;
  }
  // Install every module before resolving extensionless references.
  for (const file of all) graph.set(file, new Set());
  for (const file of all) {
    const source = await readFile(file, "utf8");
    const references = [];
    if (codeFile(file)) {
      const ast = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      if (
        ast.statements.some((statement) => {
          if (
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement)
          )
            return false;
          if (
            statement.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword,
            )
          )
            return false;
          if (ts.isImportDeclaration(statement))
            return !statement.importClause?.isTypeOnly;
          if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
          return true;
        })
      )
        executable.add(file);
      function visit(node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier
        ) {
          if (!node.importClause?.isTypeOnly && !node.isTypeOnly)
            references.push(node.moduleSpecifier.text);
        }
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)
        ) {
          if (/\.(?:[cm]?js|tsx?)$/.test(node.text) && !/\s/.test(node.text))
            references.push(node.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    // Bundled browser fixtures embed import statements inside template strings.
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g,
    ))
      references.push(match[1]);
    if (file.endsWith(".html"))
      for (const match of source.matchAll(/\bsrc=["']([^"']+)["']/g))
        references.push(match[1]);
    for (const reference of references) {
      const target = resolveReference(file, reference);
      if (target) graph.get(file).add(target);
    }
  }
  const application = new Set([
    ...policy.applicationEntries.map((path) => resolve(root, path)),
    ...html,
  ]);
  for (const entry of policy.manualEntries ?? []) {
    if (!entry.reason?.trim())
      throw new Error("Manual entry points need a reason: " + entry.path);
    const file = resolve(root, entry.path);
    if (!graph.has(file))
      throw new Error("Missing manual entry point: " + entry.path);
    application.add(file);
  }
  const packages = resolve(root, "packages");
  if (existsSync(packages))
    for (const entry of await readdir(packages, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = resolve(packages, entry.name);
      const manifestPath = resolve(directory, "package.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        function exported(value) {
          if (typeof value === "string") {
            const file = resolve(directory, value);
            if (graph.has(file)) application.add(file);
          } else if (value && typeof value === "object")
            Object.values(value).forEach(exported);
        }
        exported(manifest.exports ?? manifest.main);
      } else if (graph.has(resolve(directory, "index.js")))
        application.add(resolve(directory, "index.js"));
    }
  function reachable(roots) {
    const visited = new Set(),
      pending = [...roots];
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      pending.push(...(graph.get(file) ?? []));
    }
    return visited;
  }
  const app = reachable(application);
  const inclusive = reachable([...application, ...tooling]);
  return {
    runtimeModules: runtime.filter((file) => executable.has(file)).length,
    disconnected: runtime
      .filter((file) => executable.has(file) && !inclusive.has(file))
      .map(named)
      .sort(),
    toolOnly: runtime
      .filter(
        (file) => executable.has(file) && inclusive.has(file) && !app.has(file),
      )
      .map(named)
      .sort(),
  };
}
