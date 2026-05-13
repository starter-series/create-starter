import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditSecurity, formatAuditSecurityReport } from "../src/audit-security.ts";

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "audit-sec-test-"));
}

function writeWorkflow(dir: string, name: string, content: string): void {
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", name), content);
}

describe("auditSecurity — detects present checks", () => {
  it("recognizes gitleaks, codeql, npm audit, license check in workflows", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      writeWorkflow(
        dir,
        "ci.yml",
        `
name: ci
jobs:
  audit:
    steps:
      - uses: gitleaks/gitleaks-action@v2.3.9
      - run: npm ci --ignore-scripts
      - run: npm audit --audit-level=high
      - uses: github/codeql-action/init@v3
      - run: npx license-checker --production
`,
      );
      mkdirSync(join(dir, ".github"), { recursive: true });
      writeFileSync(
        join(dir, ".github", "dependabot.yml"),
        `version: 2\nupdates:\n  - package-ecosystem: npm\n    groups:\n      all-deps:\n        patterns: ["*"]\n`,
      );

      const r = await auditSecurity(dir);
      const byName = Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
      assert.equal(byName.gitleaks, "present");
      assert.equal(byName.codeql, "present");
      assert.equal(byName["dep-audit"], "present");
      assert.equal(byName["license-check"], "present");
      assert.equal(byName["ignore-scripts"], "present");
      assert.equal(byName.dependabot, "present");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects partial gitleaks pin (floating major tag)", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      writeWorkflow(dir, "ci.yml", "uses: gitleaks/gitleaks-action@v2\n");
      const r = await auditSecurity(dir);
      const g = r.checks.find((c) => c.name === "gitleaks")!;
      assert.equal(g.status, "partial");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditSecurity — flags missing checks", () => {
  it("flags all primary checks missing in an empty repo", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      const r = await auditSecurity(dir);
      assert.equal(r.ecosystem, "node");
      const missing = r.checks.filter((c) => c.status === "missing").map((c) => c.name);
      assert.ok(missing.includes("gitleaks"));
      assert.ok(missing.includes("codeql"));
      assert.ok(missing.includes("dep-audit"));
      assert.ok(missing.includes("dependabot"));
      assert.equal(r.overall.verdict, "soft");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags ignore-scripts partial when only some installs guard", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      writeWorkflow(
        dir,
        "ci.yml",
        `
jobs:
  a:
    steps:
      - run: npm ci --ignore-scripts
  b:
    steps:
      - run: npm install
`,
      );
      const r = await auditSecurity(dir);
      const c = r.checks.find((c) => c.name === "ignore-scripts")!;
      assert.equal(c.status, "partial");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags claude-code-security-review as missing when absent", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      writeWorkflow(dir, "ci.yml", "name: ci\n");
      const r = await auditSecurity(dir);
      const c = r.checks.find((c) => c.name === "claude-code-security-review")!;
      assert.equal(c.status, "missing");
      assert.match(c.recommendation ?? "", /claude-code-security-review/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditSecurity — ecosystem detection", () => {
  it("detects python ecosystem and recommends pip-audit", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "pyproject.toml"),
        `[project]\nname = "x"\nversion = "0.1.0"\n`,
      );
      const r = await auditSecurity(dir);
      assert.equal(r.ecosystem, "python");
      const dep = r.checks.find((c) => c.name === "dep-audit")!;
      assert.equal(dep.status, "missing");
      assert.match(dep.recommendation ?? "", /pip-audit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks ignore-scripts not-applicable for python-only repos", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "pyproject.toml"),
        `[project]\nname = "x"\nversion = "0.1.0"\n`,
      );
      const r = await auditSecurity(dir);
      const c = r.checks.find((c) => c.name === "ignore-scripts")!;
      assert.equal(c.status, "not-applicable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditSecurity — formatting", () => {
  it("formats with status labels and recommendations", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      const r = await auditSecurity(dir);
      const text = formatAuditSecurityReport(r);
      assert.match(text, /Overall: SOFT/);
      assert.match(text, /\[MISSING\] gitleaks/);
      assert.match(text, /→ /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
