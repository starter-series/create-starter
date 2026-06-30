#!/usr/bin/env node
/**
 * Builds a Claude Desktop Extension bundle (.mcpb) for create-starter.
 *
 * Strategy:
 *   1. npm run build (tsc) -> dist/
 *   2. Stage dist/, skill/ (and skills/ if present), manifest.json,
 *      package.json, package-lock.json, READMEs, LICENSE, and any extra
 *      plugin/config files (.claude-plugin/, .mcp.json) into a tmp dir.
 *   3. Install production node_modules into the staging dir via
 *      `npm ci --omit=dev --ignore-scripts` (pinned lockfile =>
 *      reproducible).
 *   4. Run `mcpb pack <staging> <out>` -> create-starter-<version>.mcpb
 *   5. Clean up staging dir.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const log = (m) => process.stdout.write(`[bundle:mcpb] ${m}\n`);

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: REPO_ROOT, ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
}

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "manifest.json"), "utf8"));
if (pkg.version !== manifest.version) {
  throw new Error(`Version mismatch: pkg=${pkg.version} manifest=${manifest.version}`);
}

const outputPath = join(REPO_ROOT, `create-starter-${pkg.version}.mcpb`);

log("Building dist/ via tsc");
run("npm", ["run", "build"]);
if (!existsSync(join(REPO_ROOT, "dist", "index.js"))) {
  throw new Error("dist/index.js missing after build");
}

const stagingRoot = mkdtempSync(join(tmpdir(), "create-starter-mcpb-"));
const staging = join(stagingRoot, "pkg");
log(`Staging at ${staging}`);

const required = ["dist", "manifest.json", "package.json", "package-lock.json", "README.md", "LICENSE"];
const optional = ["skill", "skills", "docs/ko/README.md", ".claude-plugin", ".mcp.json"];

try {
  for (const e of required) {
    const src = join(REPO_ROOT, e);
    if (!existsSync(src)) throw new Error(`Required file missing: ${e}`);
    cpSync(src, join(staging, e), { recursive: true });
  }
  for (const e of optional) {
    const src = join(REPO_ROOT, e);
    if (existsSync(src)) cpSync(src, join(staging, e), { recursive: true });
  }

  log("Installing production node_modules");
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: staging });
  rmSync(join(staging, "package-lock.json"), { force: true });

  if (existsSync(outputPath)) rmSync(outputPath);

  log("Running mcpb pack");
  const mcpbBin = join(REPO_ROOT, "node_modules", ".bin", "mcpb");
  if (!existsSync(mcpbBin)) throw new Error(`mcpb not found at ${mcpbBin}`);
  run(mcpbBin, ["pack", staging, outputPath]);

  const sizeMb = (readFileSync(outputPath).byteLength / 1048576).toFixed(2);
  log(`Bundle: ${outputPath} (${sizeMb} MB)`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
  log("Cleaned staging dir");
}
