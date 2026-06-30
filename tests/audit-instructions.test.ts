import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditInstructions,
  formatAuditInstructionsReport,
} from "../src/audit-instructions.ts";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "create-starter-instructions-"));
}

describe("auditInstructions", () => {
  it("finds duplicate, surface-overlap, and risk signals in agent instruction files", async () => {
    const repo = tempRepo();
    mkdirSync(join(repo, ".claude", "worktrees", "scratch"), { recursive: true });
    const shared = "- Preserve existing module boundaries and keep edits narrowly scoped to requested behavior.";
    writeFileSync(
      join(repo, "AGENTS.md"),
      [
        "# Agent Rules",
        shared,
        shared,
        "- Actually run tests before claiming success.",
      ].join("\n"),
    );
    writeFileSync(
      join(repo, "CLAUDE.md"),
      [shared, "- Ask before destructive operations."].join("\n"),
    );
    writeFileSync(
      join(repo, ".claude", "worktrees", "scratch", "AGENTS.md"),
      "- Temporary worktrees should not enter the audit.\n",
    );

    const report = await auditInstructions(repo);

    assert.deepEqual(report.files, ["AGENTS.md", "CLAUDE.md"]);
    assert.equal(report.overall.verdict, "attention");
    assert.equal(report.duplicates.length, 1);
    assert.equal(report.duplicates[0].recommendation, "remove_duplicate");
    assert.equal(report.surfaceOverlaps.length, 1);
    assert.deepEqual(report.surfaceOverlaps[0].paths, ["AGENTS.md", "CLAUDE.md"]);
    assert.equal(report.riskSummaries.length, 2);
    assert.deepEqual(
      report.riskSummaries.map((summary) => summary.risk).sort(),
      ["approval_required", "test_required"],
    );
    const formatted = formatAuditInstructionsReport(report);
    assert.match(formatted, /SURF_01 review_duplicate duplicate_texts=1 occurrences=3 paths=AGENTS\.md, CLAUDE\.md/u);
    assert.match(formatted, /AGENTS\.md:2, AGENTS\.md:3, CLAUDE\.md:1/u);
    assert.match(formatted, /Advisory risk summaries:/u);
  });

  it("treats keyword risk summaries as advisory when there are no duplicate review findings", async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, "AGENTS.md"), "- Actually run tests before claiming success.\n");

    const report = await auditInstructions(repo);

    assert.equal(report.duplicates.length, 0);
    assert.equal(report.surfaceOverlaps.length, 0);
    assert.equal(report.riskSummaries.length, 1);
    assert.equal(report.overall.verdict, "advisory");
  });

  it("returns a clean warning when no instruction files are present", async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, "README.md"), "# Plain repo\n");

    const report = await auditInstructions(repo);

    assert.deepEqual(report.files, []);
    assert.deepEqual(report.duplicates, []);
    assert.deepEqual(report.surfaceOverlaps, []);
    assert.deepEqual(report.riskSummaries, []);
    assert.equal(report.overall.verdict, "clean");
    assert.deepEqual(report.overall.warnings, ["No agent instruction files found."]);
  });
});
