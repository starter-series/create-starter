import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

interface PackFile {
  path: string;
  mode: number;
}

interface PackResult {
  files: PackFile[];
}

function readPackageJson(): {
  bin: Record<string, string>;
  mcpName: string;
  files: string[];
} {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
}

function npmPackDryRun(): PackResult {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
  });
  const parsed = JSON.parse(out) as PackResult[];
  assert.equal(parsed.length, 1, "npm pack should report exactly one package");
  return parsed[0];
}

describe("npm package surface", () => {
  it("ships the built CLI/MCP binary plus plugin and skill metadata", () => {
    const pkg = readPackageJson();
    const pack = npmPackDryRun();
    const files = new Map(pack.files.map((f) => [f.path, f]));

    assert.equal(pkg.bin["create-starter"], "dist/index.js");
    assert.ok(
      files.has(pkg.bin["create-starter"]),
      "package tarball must include the create-starter bin target",
    );
    assert.ok(
      files.has("dist/cli.js"),
      "package tarball must include CLI implementation used by dist/index.js",
    );
    assert.ok(
      files.has(".mcp.json"),
      "package tarball must include Claude Code MCP wiring",
    );
    assert.ok(
      files.has(".claude-plugin/plugin.json"),
      "package tarball must include Claude Code plugin metadata",
    );
    assert.ok(
      files.has(".claude-plugin/commands/proof-report.md"),
      "package tarball must include the proof-report slash command",
    );
    assert.ok(
      files.has("skills/create/SKILL.md"),
      "package tarball must include the create skill",
    );
    assert.ok(
      files.has("docs/launch-proof-report.md"),
      "package tarball must include the Launch Proof Report docs",
    );
    assert.ok(
      files.has("server.json"),
      "package tarball must include MCP Registry metadata",
    );

    const binFile = files.get(pkg.bin["create-starter"])!;
    assert.equal(binFile.mode, 0o755, "bin target should be executable in the tarball");
  });
});
