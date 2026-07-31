import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseGitHubRemote, safeReadText } from "./audit-helpers.js";

export type SecurityCheckName =
  | "gitleaks"
  | "codeql"
  | "dep-audit"
  | "license-check"
  | "ignore-scripts"
  | "dependabot"
  | "secret-scanning"
  | "claude-code-security-review"
  | "claude-security-guidance";

export type CheckStatus = "present" | "missing" | "partial" | "not-applicable";

export interface SecurityCheckResult {
  name: SecurityCheckName;
  status: CheckStatus;
  evidence: string[];
  recommendation?: string;
  /**
   * Mark this check as recommended-but-not-required. When `optional` is true
   * and `status` is "missing", the verdict aggregator counts it as a soft
   * advisory rather than a CI-hygiene gap. Currently set for
   * `claude-security-guidance` (a repo-author content file, not a CI primitive).
   */
  optional?: boolean;
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

/**
 * Read `scripts` from the repo's root package.json, if any.
 *
 * Used to resolve `npm run <name>` indirection before pattern matching. A
 * workflow that runs `npm run license:check` is running whatever that script
 * points at, and a detector that only scans workflow YAML cannot see it.
 */
function readPackageScripts(repoPath: string): Record<string, string> {
  const raw = safeReadText(join(repoPath, "package.json"));
  if (!raw) return {};
  try {
    const scripts = (JSON.parse(raw) as { scripts?: unknown }).scripts;
    if (!scripts || typeof scripts !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Append the body of every referenced npm script to the workflow text so
 * substring detectors see through one level of `npm run` indirection.
 *
 * Single pass by design: it is enough for the real case (a workflow step
 * calling a script that invokes the tool) and cannot recurse infinitely on
 * self-referential or mutually-referential scripts. The original text is
 * preserved — bodies are appended, never substituted — so patterns that match
 * the literal step keep matching.
 */
function expandRunScripts(content: string, scripts: Record<string, string>): string {
  if (Object.keys(scripts).length === 0) return content;
  const referenced = new Set<string>();
  for (const m of content.matchAll(/(?:npm|pnpm|yarn)\s+run\s+([\w:.\-/]+)/gi)) {
    const name = m[1];
    if (name && scripts[name] !== undefined) referenced.add(name);
  }
  if (referenced.size === 0) return content;
  const bodies = [...referenced].map((n) => `# expanded from "${n}": ${scripts[n]}`);
  return `${content}\n${bodies.join("\n")}\n`;
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
  // Container/filesystem scanners audit the dependency set baked into a built
  // image rather than a lockfile. That is real dependency coverage — and for a
  // repo whose deliverable is an image it is the language-appropriate kind —
  // but it is weaker than a source-level audit: dev dependencies are absent
  // from the runtime image, and typical configs gate on CRITICAL only and drop
  // unfixed CVEs. Graded `partial`, never `present`.
  const imageScanners = [
    /aquasecurity\/trivy-action|\btrivy\s+(?:image|fs|rootfs|repo)\b/i,
    /anchore\/scan-action|\bgrype\b/i,
    /google\/osv-scanner|\bosv-scanner\b/i,
    /snyk\/actions|\bsnyk\s+(?:test|container)\b/i,
  ];
  const hits = workflows.filter((w) => patterns.some((p) => p.test(w.content)));
  if (hits.length > 0) {
    return { name: "dep-audit", status: "present", evidence: hits.map((w) => w.file) };
  }
  const scanHits = workflows.filter((w) => imageScanners.some((p) => p.test(w.content)));
  if (scanHits.length > 0) {
    return {
      name: "dep-audit",
      status: "partial",
      evidence: scanHits.map((w) => w.file),
      recommendation:
        "Image/filesystem scan found but no source-level dependency audit. If this repo has its own dependency manifest, add " +
        (ecosystem === "python" ? "`pip-audit`" : "`npm audit --audit-level=high`") +
        " — image scans miss dev dependencies and commonly ignore unfixed CVEs.",
    };
  }
  return {
    name: "dep-audit",
    status: "missing",
    evidence: [],
    recommendation: ecosystem === "python"
      ? "Add `pip-audit` step to a CI workflow"
      : "Add `npm audit --audit-level=high` step to a CI workflow",
  };
}

/**
 * True when the repo provably has no third-party dependency graph: no declared
 * dependencies/devDependencies, and a lockfile (if present) with no entries
 * besides the root package.
 *
 * A license gate over an empty graph cannot find anything, and installing a
 * license scanner to check zero packages would *add* the repo's only
 * third-party download. Such repos are graded not-applicable rather than
 * missing, and flip to missing as soon as a real dependency lands.
 */
function hasEmptyDependencyGraph(repoPath: string): boolean {
  const pkgRaw = safeReadText(join(repoPath, "package.json"));
  if (!pkgRaw) return false;
  try {
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const count = (key: string) => Object.keys((pkg[key] as object) ?? {}).length;
    if (count("dependencies") > 0 || count("devDependencies") > 0) return false;
    if (count("peerDependencies") > 0 || count("optionalDependencies") > 0) return false;
  } catch {
    return false;
  }
  const lockRaw = safeReadText(join(repoPath, "package-lock.json"));
  if (!lockRaw) return true;
  try {
    const packages = (JSON.parse(lockRaw) as { packages?: Record<string, unknown> }).packages ?? {};
    // The root package is keyed "" — any other key is an installed dependency.
    return Object.keys(packages).filter((k) => k !== "").length === 0;
  } catch {
    return false;
  }
}

function checkLicense(
  workflows: { file: string; content: string }[],
  repoPath: string,
): SecurityCheckResult {
  // Covers the tool names (`license-checker`, `pip-licenses`, FOSSA, REUSE) and
  // the common script-name family (`license:check`, `license-check`,
  // `check-licenses`). Separators are required, so prose like a "Check
  // licenses" step name does not by itself earn credit — the match has to come
  // from a command or from an npm script body resolved by expandRunScripts.
  const hits = workflows.filter((w) =>
    /license[-_]?checker|fossas?\/fossa|reuse[-_]?lint|pip-licenses|licenses?[-_:]check|check[-_]licenses?/i
      .test(w.content),
  );
  if (hits.length === 0) {
    if (hasEmptyDependencyGraph(repoPath)) {
      return {
        name: "license-check",
        status: "not-applicable",
        evidence: ["no third-party dependencies declared"],
      };
    }
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
        {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          // Bound the outbound GitHub API call so a slow/unreachable host or a
          // gh auth prompt can't hang the single-process MCP server. On timeout
          // execFileSync throws and the catch below falls through gracefully.
          timeout: 10_000,
          killSignal: "SIGKILL",
        },
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
      "Pre-wire anthropics/claude-code-security-review Action on PR — AI-based security review on diffs, complements CodeQL",
  };
}

/**
 * Detects Anthropic's Claude Code Security Guidance Plugin (released 2026-05-26).
 * The plugin reads org-specific rules from a repo-root `claude-security-guidance.md`
 * file and uses them as an in-session guard while Claude is writing code — a
 * different layer than this tool's static CI audit. Recommend installing both.
 */
function checkClaudeSecurityGuidance(repoPath: string): SecurityCheckResult {
  const candidates = [
    "claude-security-guidance.md",
    ".claude-security-guidance.md",
    ".claude/security-guidance.md",
  ];
  const found = candidates
    .map((p) => join(repoPath, p))
    .filter((p) => existsSync(p));
  if (found.length > 0) {
    return {
      name: "claude-security-guidance",
      status: "present",
      // path.relative gives forward slashes on POSIX, backslashes on Windows,
      // matching the platform — both are valid evidence strings.
      evidence: found.map((p) => relative(repoPath, p)),
      optional: true,
    };
  }
  return {
    name: "claude-security-guidance",
    status: "missing",
    optional: true,
    evidence: [],
    recommendation:
      "Add a `claude-security-guidance.md` at repo root with org-specific security rules. Anthropic's Claude Code Security Guidance Plugin (2026-05-26) reads this file as an in-session guard while Claude writes code. Complements (does not replace) the post-PR `claude-code-security-review` Action and this static CI audit.",
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

  // Only the tool-invocation detectors get `npm run` indirection resolved.
  // Scoped deliberately: gitleaks/codeql/ignore-scripts assert on how the
  // workflow itself is written (pinning, install flags), so expanding script
  // bodies into their input could credit or fault the wrong file.
  const scripts = readPackageScripts(abs);
  const expanded = workflows.map((w) => ({
    file: w.file,
    content: expandRunScripts(w.content, scripts),
  }));

  const checks: SecurityCheckResult[] = [
    checkGitleaks(workflows),
    checkCodeQL(workflows),
    checkDepAudit(expanded, ecosystem),
    checkLicense(expanded, abs),
    checkIgnoreScripts(workflows, ecosystem),
    checkDependabot(abs),
    checkSecretScanning(workflows, abs),
    checkClaudeCodeSecurityReview(workflows),
    checkClaudeSecurityGuidance(abs),
  ];

  const summary = {
    present: checks.filter((c) => c.status === "present").length,
    missing: checks.filter((c) => c.status === "missing").length,
    partial: checks.filter((c) => c.status === "partial").length,
  };

  const issues = checks
    .filter((c) => c.status === "missing" || c.status === "partial")
    .map((c) => `${c.name} (${c.status}): ${c.recommendation ?? "no detail"}`);

  // Verdict aggregator only counts CORE checks (CI primitives). Optional
  // checks like `claude-security-guidance` (a repo-author content file) are
  // surfaced in `issues` but don't downgrade the verdict on their own — a
  // repo that has the full CI baseline stays HARDENED even before the author
  // writes their org-specific guidance file.
  const coreMissing = checks.filter((c) => c.status === "missing" && !c.optional).length;
  const corePartial = checks.filter((c) => c.status === "partial" && !c.optional).length;

  let verdict: AuditSecurityReport["overall"]["verdict"];
  if (coreMissing === 0 && corePartial === 0) verdict = "hardened";
  else if (coreMissing <= 2) verdict = "needs-attention";
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
