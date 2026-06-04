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
const VERSION_SENTINEL = "0.0.0";

export function readVersion(): string {
  let pkgPath = "(unresolved)";
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    pkgPath = join(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    if (typeof pkg.version === "string") return pkg.version;
    // File parsed but no string `version` — still degraded; warn so it's
    // diagnosable rather than silently shipping the 0.0.0 sentinel.
    process.stderr.write(
      `[create-starter] warning: package.json at ${pkgPath} has no string "version"; using ${VERSION_SENTINEL}\n`,
    );
    return VERSION_SENTINEL;
  } catch (err) {
    // Emit a diagnostic before falling back. stderr (not stdout) so it never
    // pollutes MCP stdio or the `--version` value a caller might capture.
    process.stderr.write(
      `[create-starter] warning: could not read version from ${pkgPath} (${(err as Error).message}); using ${VERSION_SENTINEL}\n`,
    );
    return VERSION_SENTINEL;
  }
}
