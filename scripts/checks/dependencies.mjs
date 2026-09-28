import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoots = ["editor/src", "player", "server", "packages"];
const excluded = new Set(["node_modules", "target", "pkg", "tests"]);

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function violation(owner, dependency) {
  if (owner.startsWith("editor/src/domain/")) {
    if (/^(?:react|react-dom|zustand)(?:\/|$)/.test(dependency))
      return "Domain rules cannot depend on React or Zustand.";
    if (
      dependency.startsWith("editor/src/") &&
      !dependency.startsWith("editor/src/domain/")
    )
      return "Domain rules cannot import outer editor layers, including their types.";
  }
  if (
    owner.startsWith("editor/src/state/") &&
    /^editor\/src\/(?:features|app|ui)\//.test(dependency)
  )
    return "State cannot depend on presentation features.";
  if (owner.startsWith("editor/") && dependency.startsWith("player/"))
    return "Editor cannot import player internals.";
  if (owner.startsWith("player/") && dependency.startsWith("editor/"))
    return "Player cannot import editor internals.";
  if (
    owner.startsWith("packages/") &&
    /^(?:editor|player|server|docs)\//.test(dependency)
  )
    return "Shared packages cannot import their applications.";
  return null;
}

const failures = [];
let checked = 0;
for (const directory of sourceRoots) {
  for (const file of await sourceFiles(resolve(root, directory))) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const owner = relative(root, file).split(sep).join("/");
    function inspect(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specifier = node.moduleSpecifier;
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        specifier = node.argument.literal;
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      )
        specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const name = specifier.text;
        const dependency = name.startsWith(".")
          ? relative(root, resolve(file, "..", name))
              .split(sep)
              .join("/")
          : name;
        const message = violation(owner, dependency);
        if (message) {
          const line =
            source.getLineAndCharacterOfPosition(specifier.getStart(source))
              .line + 1;
          failures.push(`${owner}:${line}: ${message} (${name})`);
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
    checked += 1;
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Dependency boundaries: ${checked} source modules passed.`);
}
