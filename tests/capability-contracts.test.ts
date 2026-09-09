import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { auditInstructions } from "../src/audit-instructions.ts";
import { seedSecurityGuidance } from "../src/seed-security-guidance.ts";
const fixture = () => mkdtempSync(join(tmpdir(), "capability-contract-"));
const cli = (...args: string[]) => spawnSync(process.execPath, [resolve("dist/index.js"), ...args], { encoding: "utf8" });
const rule = "Keep every change scoped to the requested behavior and preserve module boundaries.";

test("boolean assignments never authorize a guidance overwrite", () => {
  for (const flag of ["--force=false", "--force=true", "-f=false"]) {
    const root = fixture(); const target = join(root, "claude-security-guidance.md");
    writeFileSync(target, "OWNER CONTENT");
    assert.equal(cli("seed-security-guidance", root, flag).status, 2, flag);
    assert.equal(readFileSync(target, "utf8"), "OWNER CONTENT");
  }
});
test("value options reject missing and empty values before any report write", () => {
  for (const args of [["--output", "--stdout"], ["-o", "--stdout"], ["--output="], ["--output", ""]]) {
    const root = fixture();
    assert.equal(cli("proof-report", root, ...args).status, 2, JSON.stringify(args));
    assert.equal(existsSync(join(root, "--stdout")), false);
    assert.equal(existsSync(join(root, "launch-proof-report.md")), false);
  }
  const root = fixture();
  assert.match(cli("add-component", root, "--starter", "--apply").stderr, /missing value/);
  assert.match(cli("add-component", root, "--component=").stderr, /missing value/);
});
test("nested-looking fences do not leak examples into instruction findings or imports", async () => {
  for (const inner of ["```", "~~~", "````not-a-close"]) {
    const root = fixture();
    writeFileSync(join(root, "AGENTS.md"), `\`\`\`\`markdown\n${inner}\n@CLAUDE.md\n\n${rule}\n\n${rule}\n\`\`\`\`\n`);
    const report = await auditInstructions(root);
    assert.equal(report.duplicates.length, 0, inner);
    assert.equal(report.topology.files[0].imports.length, 0, inner);
    assert.equal(report.review.findings.length, 0, inner);
  }
  const root = fixture();
  writeFileSync(join(root, "AGENTS.md"), `\`\`\`\nexample\n\`\`\`\n${rule}\n\n${rule}\n`);
  assert.equal((await auditInstructions(root)).duplicates.length, 1);
});
test("guidance generation never follows an existing or dangling output symlink", () => {
  for (const dangling of [false, true]) {
    const root = fixture(); const outside = join(fixture(), "outside.md");
    if (!dangling) writeFileSync(outside, "OUTSIDE CONTENT");
    symlinkSync(outside, join(root, "claude-security-guidance.md"));
    assert.throws(() => seedSecurityGuidance({ repoPath: root, force: true }));
    if (dangling) assert.equal(existsSync(outside), false);
    else assert.equal(readFileSync(outside, "utf8"), "OUTSIDE CONTENT");
  }
});
test("keyword reminders never become deterministic review findings or failing exits", async () => {
  for (const text of ["Run the test suite before submitting changes.", "Do not run the test suite before submitting changes."]) {
    const root = fixture(); writeFileSync(join(root, "AGENTS.md"), text);
    const report = await auditInstructions(root);
    assert.ok(report.riskSummaries.some(s => s.risk === "test_required"));
    assert.equal(report.review.findings.length, 0);
    assert.equal(report.overall.verdict, "advisory");
    assert.equal(cli("check", "--instructions", root).status, 0);
  }
});
