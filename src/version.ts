import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve package.json#version at runtime so we don't drift a hardcoded
// constant in src/* every time we bump. Works in both the dev tree
// (dist/index.js → ../package.json) and the .mcpb bundle (pkg/dist/index.js
// → pkg/../package.json, which is the staging-root package.json).
//
// Returns "0.0.0" on any failure (missing file, corrupt JSON) so the server
// can still start in degraded environments — the alternative is crashing
// inside `new McpServer({...})` before the user sees anything.
export function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
