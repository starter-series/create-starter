import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseGitHubRemote, safeReadText } from "./audit-helpers.js";

export type SecurityCheckName =
  | "gitleaks"
  | "codeql"
  | "dep-audit"
  | "license-check"
  | "ignore-scripts"
  | "dependabot"
  | "secret-scanning"
  | "claude-code-security-review";

export type CheckStatus = "present" | "missing" | "partial" | "not-applicable";

export interface SecurityCheckResult {
  name: SecurityCheckName;
  status: CheckStatus;
  evidence: string[];
  recommendation?: string;
}

export interface AuditSecurityReport {
  repoPath: string;
  ecosystem: "node" | "python" | "mixed" | "other";
  checks: SecurityCheckResult[];
  summary: { present: number; missing: number; partial: number };
  overall: { verdict: "hardened" | "needs-attention" | "soft"; issues: string[] };
}

function listWorkflows(repoPath: string): { file: string; content: string }[] {
  const dir = join(repoPath, ".github", "workflows");
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    return [];
  }
  const out: { file: string; content: string }[] = [];
  for (const f of entries) {
    const content = safeReadText(join(dir, f));
    if (content) out.push({ file: f, content });
  }
  return out;
}

function detectEcosystem(repoPath: string): AuditSecurityReport["ecosystem"] {
  const hasJs = existsSync(join(repoPath, "package.json"));
  const hasPy = existsSync(join(repoPath, "pyproject.toml")) ||
    existsSync(join(repoPath, "requirements.txt")) ||
    existsSync(join(repoPath, "setup.py"));
  if (hasJs && hasPy) return "mixed";
  if (hasJs) return "node";
  if (hasPy) return "python";
  return "other";
}

// ---- individual checks ----

function checkGitleaks(workflows: { file: string; content: string }[]): SecurityCheckResult {
  const hits = workflows.filter((w) =>
    /gitleaks\/gitleaks-action|\bgitleaks\b/i.test(w.content),
  );
  if (hits.length === 0) {
    return {
      name: "gitleaks",
      status: "missing",
      evidence: [],
      recommendation:
        "Add a gitleaks step to a CI workflow (use pinned SHA256 or pinned Action version). Detects committed secrets.",
    };
  }
  const pinnedAction = hits.some((w) =>
    /gitleaks-action@[0-9a-f]{40}|gitleaks-action@v\d+\.\d+\.\d+/i.test(w.content),
  );
  const pinnedManual = hits.some(
    (w) =>
      /GITLEAKS_VERSION:\s*\d+\.\d+\.\d+/.test(w.content) &&
      /GITLEAKS_SHA256:\s*[0-9a-f]{64}/.test(w.content),
  );
  const pinned = pinnedAction || pinnedManual;
  return {
    name: "gitleaks",
    status: pinned ? "present" : "partial",
    evidence: hits.map((w) => w.file),
    recommendation: pinned
      ? undefined
      : "Pin gitleaks to a SHA/exact version (Action) or include GITLEAKS_VERSION + GITLEAKS_SHA256 env (manual install)",
  };
}

function checkCodeQL(workflows: { file: string; content: string }[]): SecurityCheckResult {
  const hits = workflows.filter((w) => /github\/codeql-action|codeql-analysis/i.test(w.content));
  if (hits.length === 0) {
    return {
      name: "codeql",
      status: "missing",
      evidence: [],
      recommendation: "Add CodeQL via github/codeql-action — static analysis for JS/TS/Python",
    };
  }
  return { name: "codeql", status: "present", evidence: hits.map((w) => w.file) };
}

function checkDepAudit(
  workflows: { file: string; content: string }[],
  ecosystem: AuditSecurityReport["ecosystem"],
): SecurityCheckResult {
  if (ecosystem === "other") {
    return { name: "dep-audit", status: "not-applicable", evidence: [] };
  }
  const patterns = [
    /npm\s+audit/i,
    /pnpm\s+audit/i,
    /yarn\s+audit/i,
    /pip-audit/i,
    /safety\s+check/i,
  ];
  const hits = workflows.filter((w) => patterns.some((p) => p.test(w.content)));
  if (hits.length === 0) {
    return {
      name: "dep-audit",
      status: "missing",
      evidence: [],
      recommendation: ecosystem === "python"
        ? "Add `pip-audit` step to a CI workflow"
        : "Add `npm audit --audit-level=high` step to a CI workflow",
    };
  }
  return { name: "dep-audit", status: "present", evidence: hits.map((w) => w.file) };
}

function checkLicense(workflows: { file: string; content: string }[]): SecurityCheckResult {
  const hits = workflows.filter((w) =>
    /license[-_]?checker|fossas?\/fossa|reuse[-_]?lint|pip-licenses/i.test(w.content),
  );
  if (hits.length === 0) {
    return {
      name: "license-check",
      status: "missing",
      evidence: [],
      recommendation: "Add a license check (license-checker for Node, pip-licenses for Python) to catch GPL/AGPL contamination",
    };
  }
  return { name: "license-check", status: "present", evidence: hits.map((w) => w.file) };
}

function checkIgnoreScripts(
  workflows: { file: string; content: string }[],
  ecosystem: AuditSecurityReport["ecosystem"],
): SecurityCheckResult {
  if (ecosystem !== "node" && ecosystem !== "mixed") {
    return { name: "ignore-scripts", status: "not-applicable", evidence: [] };
  }
  // Only match lines whose first meaningful token is npm/pnpm/yarn install. This
  // skips false positives inside echo/comment strings (e.g. `echo "Run 'npm install' locally"`).
  // A real install command appears after optional indent, an optional list dash,
  // and an optional `run:` (with optional pipe).
  const lineRe =
    /^[\s>]*-?\s*(?:run:\s*\|?\s*)?((?:npm|pnpm|yarn)\s+(?:install|ci|i)\b[^\n]*)/;
  const installLines: { file: string; line: string }[] = [];
  for (const w of workflows) {
    for (const raw of w.content.split(/\r?\n/)) {
      const m = raw.match(lineRe);
      if (m) installLines.push({ file: w.file, line: m[1] });
    }
  }
  // Whitelist patterns that already neutralize scripts without --ignore-scripts:
  //   --package-lock-only — npm never runs scripts in this mode
  //   --dry-run — install is simulated, no scripts run
  //   --no-install (yarn) — install skipped
  const safeWithoutFlag = (line: string): boolean =>
    /--package-lock-only|--dry-run|--no-install/.test(line);
  const guarded = (line: string): boolean =>
    /--ignore-scripts/.test(line) || safeWithoutFlag(line);

  if (installLines.length === 0) {
    return { name: "ignore-scripts", status: "not-applicable", evidence: [] };
  }
  const allGuarded = installLines.every((l) => guarded(l.line));
  if (allGuarded) {
    return {
      name: "ignore-scripts",
      status: "present",
      evidence: [...new Set(installLines.map((l) => l.file))],
    };
  }
  const someGuarded = installLines.some((l) => guarded(l.line));
  return {
    name: "ignore-scripts",
    status: someGuarded ? "partial" : "missing",
    evidence: installLines
      .filter((l) => !guarded(l.line))
      .map((l) => `${l.file}: ${l.line.trim()}`),
    recommendation:
      "Add --ignore-scripts to every CI `npm/pnpm/yarn install` to neutralize malicious postinstall scripts",
  };
}

function checkDependabot(repoPath: string): SecurityCheckResult {
  const cfg = join(repoPath, ".github", "dependabot.yml");
  const alt = join(repoPath, ".github", "dependabot.yaml");
  const path = existsSync(cfg) ? cfg : existsSync(alt) ? alt : null;
  if (!path) {
    return {
      name: "dependabot",
      status: "missing",
      evidence: [],
      recommendation: "Add .github/dependabot.yml with grouped updates to surface vulnerable deps automatically",
    };
  }
  const content = safeReadText(path) ?? "";
  const grouped = /groups:/.test(content);
  return {
    name: "dependabot",
    status: grouped ? "present" : "partial",
    evidence: [path.replace(repoPath + "/", "")],
    recommendation: grouped ? undefined : "Use Dependabot grouped updates to avoid lockfile-conflict storms",
  };
}

function checkSecretScanning(
  workflows: { file: string; content: string }[],
  repoPath: string,
): SecurityCheckResult {
  // Trufflehog or a custom secret-scanning workflow file counts as present.
  const workflowHits = workflows.filter((w) => /secret-scanning|trufflehog/i.test(w.content));
  if (workflowHits.length > 0) {
    return {
      name: "secret-scanning",
      status: "present",
      evidence: workflowHits.map((w) => w.file),
    };
  }
  // Best-effort live check via gh CLI: query repo settings for native GitHub
  // secret scanning. Requires authenticated gh + remote = github.com.
  const remote = tryGitRemote(repoPath);
  if (remote) {
    try {
      const out = execFileSync(
        "gh",
        ["api", `repos/${remote}`, "--jq", ".security_and_analysis.secret_scanning.status // \"\""],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
      if (out === "enabled") {
        return {
          name: "secret-scanning",
          status: "present",
          evidence: [`gh api repos/${remote} → secret_scanning=enabled`],
        };
      }
      if (out === "disabled") {
        return {
          name: "secret-scanning",
          status: "missing",
          evidence: [`gh api repos/${remote} → secret_scanning=disabled`],
          recommendation:
            "Enable GitHub secret scanning in repo settings (Settings → Code security). Free for public repos",
        };
      }
      // Empty result: private repo without GHAS, or insufficient permission.
      // Fall through to the soft "couldn't verify" outcome below.
    } catch {
      // gh missing or unauthenticated; fall through.
    }
  }
  return {
    name: "secret-scanning",
    status: "missing",
    evidence: [],
    recommendation:
      "Couldn't verify GitHub secret scanning via gh CLI. Check Settings → Code security manually (free for public repos)",
  };
}

function tryGitRemote(repoPath: string): string | null {
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseGitHubRemote(url);
  } catch {
    return null;
  }
}

function checkClaudeCodeSecurityReview(
  workflows: { file: string; content: string }[],
): SecurityCheckResult {
  const hits = workflows.filter((w) =>
    /anthropics\/claude-code-security-review/.test(w.content),
  );
  if (hits.length > 0) {
    return {
      name: "claude-code-security-review",
      status: "present",
      evidence: hits.map((w) => w.file),
    };
  }
  return {
    name: "claude-code-security-review",
    status: "missing",
    evidence: [],
    recommendation:
      "Pre-wire anthropics/claude-code-security-review Action on PR — AI-based security review complements CodeQL",
  };
}

// ---- main audit ----

export async function auditSecurity(repoPath: string): Promise<AuditSecurityReport> {
  const abs = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }

  const ecosystem = detectEcosystem(abs);
  const workflows = listWorkflows(abs);

  const checks: SecurityCheckResult[] = [
    checkGitleaks(workflows),
    checkCodeQL(workflows),
    checkDepAudit(workflows, ecosystem),
    checkLicense(workflows),
    checkIgnoreScripts(workflows, ecosystem),
    checkDependabot(abs),
    checkSecretScanning(workflows, abs),
    checkClaudeCodeSecurityReview(workflows),
  ];

  const summary = {
    present: checks.filter((c) => c.status === "present").length,
    missing: checks.filter((c) => c.status === "missing").length,
    partial: checks.filter((c) => c.status === "partial").length,
  };

  const issues = checks
    .filter((c) => c.status === "missing" || c.status === "partial")
    .map((c) => `${c.name} (${c.status}): ${c.recommendation ?? "no detail"}`);

  let verdict: AuditSecurityReport["overall"]["verdict"];
  if (summary.missing === 0 && summary.partial === 0) verdict = "hardened";
  else if (summary.missing <= 2) verdict = "needs-attention";
  else verdict = "soft";

  return {
    repoPath: abs,
    ecosystem,
    checks,
    summary,
    overall: { verdict, issues },
  };
}

// ---- formatting ----

const STATUS_LABEL: Record<CheckStatus, string> = {
  present: "OK     ",
  partial: "PARTIAL",
  missing: "MISSING",
  "not-applicable": "N/A    ",
};

export function formatAuditSecurityReport(r: AuditSecurityReport): string {
  const out: string[] = [];
  out.push(`audit_security — ${r.repoPath}`);
  out.push("");
  out.push(`Overall: ${r.overall.verdict.toUpperCase()}  (ecosystem: ${r.ecosystem})`);
  out.push(
    `  ${r.summary.present} present  ${r.summary.partial} partial  ${r.summary.missing} missing`,
  );
  out.push("");

  out.push("Checks:");
  for (const c of r.checks) {
    out.push(`  [${STATUS_LABEL[c.status]}] ${c.name}`);
    for (const e of c.evidence.slice(0, 3)) out.push(`             · ${e}`);
    if (c.recommendation && c.status !== "present") {
      out.push(`             → ${c.recommendation}`);
    }
  }

  if (r.overall.issues.length > 0) {
    out.push("");
    out.push("Issues:");
    for (const i of r.overall.issues) out.push(`  - ${i}`);
  }

  return out.join("\n") + "\n";
}
