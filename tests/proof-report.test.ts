import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  formatLaunchProofReport,
  generateLaunchProofReport,
} from "../src/proof-report.ts";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "proof-report-test-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function writeWorkflow(dir: string, name: string, content: string): void {
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", name), content);
}

function mockFetch(map: Record<string, { status?: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const hit = Object.entries(map).find(([prefix]) => url.startsWith(prefix));
    if (!hit) {
      return new Response(JSON.stringify({ error: "no mock" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const { status = 200, body } = hit[1];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("launch proof report", () => {
  it("writes a markdown report and classifies failed gates as blocked", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "proof-report-fixture",
          version: "0.2.0",
          bin: { fixture: "dist/index.js" },
          files: ["dist"],
        }),
      );
      writeWorkflow(
        dir,
        "publish.yml",
        `
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    steps:
      - run: npm publish --provenance
`,
      );
      const fetch = mockFetch({
        "https://registry.npmjs.org/": {
          body: {
            "dist-tags": { latest: "0.1.0" },
            time: { "0.1.0": "2026-04-01T00:00:00Z" },
          },
        },
      });

      const result = await generateLaunchProofReport({
        repoPath: dir,
        outputPath: "reports/launch.md",
        fetch,
        now: new Date("2026-06-27T00:00:00Z"),
      });

      assert.equal(result.report.overall.verdict, "blocked");
      assert.ok(result.report.gates.some((g) => g.name === "cd" && g.status === "fail"));
      assert.ok(existsSync(join(dir, "reports", "launch.md")));
      const written = readFileSync(join(dir, "reports", "launch.md"), "utf8");
      assert.match(written, /^# Launch Proof Report/);
      assert.match(written, /Overall: BLOCKED/);
      assert.match(written, /### audit-cd/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can format without writing when outputPath is null", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "proof-report-stdout", version: "1.0.0" }),
      );
      const result = await generateLaunchProofReport({
        repoPath: dir,
        outputPath: null,
        fetch: mockFetch({
          "https://registry.npmjs.org/": {
            status: 404,
            body: { error: "not found" },
          },
        }),
        now: new Date("2026-06-27T00:00:00Z"),
      });

      assert.equal(result.report.outputPath, null);
      assert.equal(existsSync(join(dir, "launch-proof-report.md")), false);
      assert.match(formatLaunchProofReport(result.report), /technical launch-readiness report/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects proof-report outputs that escape the target repo", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "proof-report-contained", version: "1.0.0" }),
      );
      const escaped = join(dirname(dir), "escape-proof-report.md");

      await assert.rejects(
        () =>
          generateLaunchProofReport({
            repoPath: dir,
            outputPath: "../escape-proof-report.md",
            fetch: mockFetch({
              "https://registry.npmjs.org/": {
                status: 404,
                body: { error: "not found" },
              },
            }),
            now: new Date("2026-06-27T00:00:00Z"),
          }),
        /must stay inside the target repo/,
      );
      assert.equal(existsSync(escaped), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
