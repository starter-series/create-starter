import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditRelease, formatAuditReport } from "../src/audit.ts";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "audit-test-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  return dir;
}

function commit(dir: string, file: string, content: string, msg: string): void {
  writeFileSync(join(dir, file), content);
  execFileSync("git", ["add", file], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", msg], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" } });
}

function tag(dir: string, name: string): void {
  execFileSync("git", ["tag", name], { cwd: dir });
}

describe("auditRelease — starter detection", () => {
  it("detects mcp-server from @modelcontextprotocol/sdk dep", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "x",
          version: "1.0.0",
          dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
        }),
      );
      const r = await auditRelease(dir);
      assert.equal(r.matchedStarter.id, "mcp-server");
      assert.equal(r.matchedStarter.confidence, "high");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects discord-bot from discord.js dep", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "0.1.0", dependencies: { "discord.js": "^14" } }),
      );
      const r = await auditRelease(dir);
      assert.equal(r.matchedStarter.id, "discord-bot");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects mcp-server-python from pyproject", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "pyproject.toml"),
        `[project]\nname = "x"\nversion = "0.1.0"\ndependencies = ["fastmcp>=2.0"]\n`,
      );
      const r = await auditRelease(dir);
      assert.equal(r.matchedStarter.id, "mcp-server-python");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects browser-extension from manifest_version=3", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({ manifest_version: 3, name: "x", version: "1.0.0" }),
      );
      const r = await auditRelease(dir);
      assert.equal(r.matchedStarter.id, "browser-extension");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns id=null when no signal matches", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "README.md"), "# nothing");
      const r = await auditRelease(dir);
      assert.equal(r.matchedStarter.id, null);
      assert.equal(r.matchedStarter.confidence, "none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditRelease — CHANGELOG drift vs merged PRs", () => {
  it("flags PRs merged after last tag that are missing from Unreleased", async () => {
    const dir = makeRepo();
    try {
      // initial release v1.0.0
      commit(dir, "package.json", JSON.stringify({ name: "x", version: "1.0.0" }), "initial");
      tag(dir, "v1.0.0");
      // two PRs merged after the tag
      commit(dir, "a.txt", "a", "feat: add A (#101)");
      commit(dir, "b.txt", "b", "fix: B fix (#102)");
      // CHANGELOG mentions only #101
      writeFileSync(
        join(dir, "CHANGELOG.md"),
        `# Changelog\n\n## [Unreleased]\n\n- Add A (#101)\n\n## [1.0.0]\n\n- initial\n`,
      );

      const r = await auditRelease(dir);
      assert.equal(r.changelog.unreleasedSection, true);
      assert.deepEqual(r.changelog.unreleasedPrs, [101]);
      assert.equal(r.changelog.mergedPrsSinceLastTag.length, 2);
      assert.equal(r.changelog.missingFromChangelog.length, 1);
      assert.equal(r.changelog.missingFromChangelog[0].number, 102);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks ship-ready when version == tag but PRs were merged", async () => {
    const dir = makeRepo();
    try {
      commit(dir, "package.json", JSON.stringify({ name: "x", version: "1.0.0" }), "initial");
      tag(dir, "v1.0.0");
      commit(dir, "a.txt", "a", "feat: thing (#5)");

      const r = await auditRelease(dir);
      assert.equal(r.version.current, "1.0.0");
      assert.equal(r.version.lastTag, "v1.0.0");
      assert.equal(r.version.drift, "current==tag");
      assert.equal(r.shipReady.verdict, "no");
      assert.ok(r.shipReady.blockers.some((b) => /bump required/.test(b)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditRelease — publish workflow detection", () => {
  it("detects release-please workflow", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0" }),
      );
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(dir, ".github", "workflows", "release.yml"),
        `name: release\nuses: googleapis/release-please-action@v4\n`,
      );
      const r = await auditRelease(dir);
      assert.equal(r.publishWorkflow.likelyKind, "release-please");
      assert.deepEqual(r.publishWorkflow.files, ["release.yml"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects publish-on-tag workflow", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0" }),
      );
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(dir, ".github", "workflows", "publish.yml"),
        `name: publish\non:\n  push:\n    tags:\n      - 'v*'\njobs: {}\n`,
      );
      const r = await auditRelease(dir);
      assert.equal(r.publishWorkflow.likelyKind, "publish-on-tag");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags missing publish workflow for matched starter", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "x",
          version: "0.1.0",
          dependencies: { "discord.js": "^14" },
        }),
      );
      const r = await auditRelease(dir);
      assert.equal(r.publishWorkflow.likelyKind, "missing");
      assert.ok(r.shipReady.blockers.some((b) => /publish workflow/i.test(b)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects a cd.yml publish workflow (filename has no release/publish/deploy keyword)", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0" }),
      );
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(dir, ".github", "workflows", "cd.yml"),
        `name: CD\non:\n  workflow_dispatch: {}\njobs:\n  publish:\n    steps:\n      - run: npm publish --provenance --access public\n`,
      );
      const r = await auditRelease(dir);
      assert.notEqual(r.publishWorkflow.likelyKind, "missing");
      assert.equal(r.publishWorkflow.likelyKind, "publish-manual");
      assert.deepEqual(r.publishWorkflow.files, ["cd.yml"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects a publish workflow by content alone (no filename keyword)", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0" }),
      );
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
      // Filename matches none of release|publish|deploy|cd; detection must come
      // from the action-gh-release step in the body.
      writeFileSync(
        join(dir, ".github", "workflows", "ship.yml"),
        `name: Ship\non:\n  release:\n    types: [published]\njobs:\n  go:\n    steps:\n      - uses: softprops/action-gh-release@v2\n`,
      );
      const r = await auditRelease(dir);
      assert.notEqual(r.publishWorkflow.likelyKind, "missing");
      assert.deepEqual(r.publishWorkflow.files, ["ship.yml"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not detect a workflow that only mentions a publish action in a comment", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0" }),
      );
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
      // A changelog-mirror workflow that *explains* the release flow in a
      // comment must not be misclassified as a publisher (regression: a bare
      // `action-gh-release` mention in a comment used to match).
      writeFileSync(
        join(dir, ".github", "workflows", "update-changelog.yml"),
        `name: Update CHANGELOG\n# Released repos use softprops/action-gh-release with generate_release_notes.\non:\n  release:\n    types: [published]\njobs:\n  go:\n    steps:\n      - run: git push\n`,
      );
      const r = await auditRelease(dir);
      assert.equal(r.publishWorkflow.likelyKind, "missing");
      assert.deepEqual(r.publishWorkflow.files, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditRelease — format", () => {
  it("formats a clean report when ready", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "x",
          version: "1.0.0",
          dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
        }),
      );
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(dir, ".github", "workflows", "release.yml"),
        `name: release\nuses: googleapis/release-please-action@v4\n`,
      );
      writeFileSync(
        join(dir, "CHANGELOG.md"),
        `## [Unreleased]\n\n## [1.0.0]\n`,
      );
      commit(dir, "x.txt", "x", "initial");
      tag(dir, "v1.0.0");

      const r = await auditRelease(dir);
      const text = formatAuditReport(r);
      assert.match(text, /Ship-ready:/);
      assert.match(text, /Matched starter:/);
      assert.match(text, /Publish workflow:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
