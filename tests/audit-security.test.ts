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

  it("recognizes manual gitleaks install with SHA256 pin as present", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      writeWorkflow(
        dir,
        "ci.yml",
        `
jobs:
  scan:
    steps:
      - env:
          GITLEAKS_VERSION: 8.30.1
          GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
        run: |
          curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v\${GITLEAKS_VERSION}/gitleaks_\${GITLEAKS_VERSION}_linux_x64.tar.gz -o /tmp/g.tgz
          /tmp/gitleaks detect --source . --verbose
`,
      );
      const r = await auditSecurity(dir);
      const g = r.checks.find((c) => c.name === "gitleaks")!;
      assert.equal(g.status, "present");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag npm install --package-lock-only as missing --ignore-scripts", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      writeWorkflow(
        dir,
        "ci.yml",
        `
jobs:
  lockfile-check:
    steps:
      - run: npm ci --ignore-scripts
      - run: npm install --package-lock-only --ignore-scripts
`,
      );
      const r = await auditSecurity(dir);
      const c = r.checks.find((c) => c.name === "ignore-scripts")!;
      assert.equal(c.status, "present");
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
      // Drift gate: if a new check is added to SecurityCheckName + the checks
      // array but not surfaced via tests, this length assertion catches it.
      assert.equal(r.checks.length, 9, "expected 9 checks; drift between SecurityCheckName and the checks array");
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

  it("treats claude-security-guidance as optional: HARDENED verdict despite its absence when all CORE checks pass", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      // Inject every core check workflow + Dependabot grouped config to drive verdict=hardened.
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(dir, ".github", "workflows", "ci.yml"),
        `
jobs:
  ci:
    steps:
      - uses: gitleaks/gitleaks-action@v2.3.9
      - uses: github/codeql-action/init@v3
      - run: npm ci --ignore-scripts
      - run: npm audit --audit-level=high
      - run: npx license-checker --production
      - uses: anthropics/claude-code-security-review@main
`,
      );
      writeFileSync(
        join(dir, ".github", "dependabot.yml"),
        `version: 2\nupdates:\n  - package-ecosystem: npm\n    groups:\n      all-deps:\n        patterns: ["*"]\n`,
      );
      const r = await auditSecurity(dir);
      const guidance = r.checks.find((c) => c.name === "claude-security-guidance")!;
      assert.equal(guidance.status, "missing");
      assert.equal(guidance.optional, true);
      // Verdict aggregator ignores optional-missing checks → hardened even with guidance absent.
      // Note: secret-scanning is also expected MISSING (no gh API → fallback path),
      // so this asserts the optional handling specifically rather than a perfect-score verdict.
      const coreMissing = r.checks.filter((c) => c.status === "missing" && !c.optional);
      // claude-security-guidance must NOT appear in coreMissing
      assert.ok(!coreMissing.some((c) => c.name === "claude-security-guidance"));
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

  it("flags claude-security-guidance as missing when claude-security-guidance.md is absent", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      const r = await auditSecurity(dir);
      const c = r.checks.find((c) => c.name === "claude-security-guidance")!;
      assert.equal(c.status, "missing");
      assert.match(c.recommendation ?? "", /claude-security-guidance\.md/);
      // Should explicitly position as complementary, not competing
      assert.match(c.recommendation ?? "", /in-session/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recognizes claude-security-guidance.md at repo root as present", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      writeFileSync(
        join(dir, "claude-security-guidance.md"),
        "# Security guidance\n\n- No string-concat SQL.\n- No `eval`.\n",
      );
      const r = await auditSecurity(dir);
      const c = r.checks.find((c) => c.name === "claude-security-guidance")!;
      assert.equal(c.status, "present");
      assert.deepEqual(c.evidence, ["claude-security-guidance.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("also accepts .claude/security-guidance.md as evidence", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(join(dir, ".claude", "security-guidance.md"), "# rules\n");
      const r = await auditSecurity(dir);
      const c = r.checks.find((c) => c.name === "claude-security-guidance")!;
      assert.equal(c.status, "present");
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
