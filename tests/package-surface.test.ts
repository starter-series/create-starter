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
  name: string;
  bin: Record<string, string>;
  mcpName: string;
  files: string[];
} {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
}

const expectedMcpTools = [
  "list_templates",
  "create_project",
  "audit_release",
  "audit_cd",
  "audit_security",
  "audit_instructions",
  "generate_launch_proof_report",
  "seed_security_guidance",
  "add_component",
];

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

    assert.equal(pkg.bin["starter-series"], "dist/index.js");
    assert.equal(pkg.bin["create-starter"], "dist/index.js");
    assert.ok(
      files.has(pkg.bin["starter-series"]),
      "package tarball must include the starter-series bin target",
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
      files.has("docs/ko/README.md"),
      "package tarball must include localized README content outside the root README surface",
    );
    assert.ok(
      files.has("server.json"),
      "package tarball must include MCP Registry metadata",
    );

    const binFile = files.get(pkg.bin["starter-series"])!;
    assert.equal(binFile.mode, 0o755, "bin target should be executable in the tarball");
  });

  it("keeps registry, bundle, and runtime tool metadata aligned", () => {
    const pkg = readPackageJson();
    const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf-8")) as {
      tools: Array<{ name: string }>;
    };
    const server = JSON.parse(readFileSync(join(repoRoot, "server.json"), "utf-8")) as {
      packages: Array<{ identifier: string }>;
    };

    assert.deepEqual(
      manifest.tools.map((tool) => tool.name),
      expectedMcpTools,
      "Claude Desktop manifest tools must match the runtime MCP surface",
    );
    assert.equal(
      server.packages[0]?.identifier,
      pkg.name,
      "MCP Registry npm package identifier must match package.json name",
    );
  });
});
