import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { auditRelease, formatAuditReport, type AuditReport } from "./audit.js";
import { auditCd, formatAuditCdReport, type AuditCdReport } from "./audit-cd.js";
import {
  auditSecurity,
  formatAuditSecurityReport,
  type AuditSecurityReport,
} from "./audit-security.js";
import {
  auditInstructions,
  formatAuditInstructionsReport,
  type AuditInstructionsReport,
} from "./audit-instructions.js";

export type LaunchProofGateStatus = "pass" | "attention" | "fail";
export type LaunchProofVerdict = "ready" | "attention" | "blocked";

export interface LaunchProofGate {
  name: "release" | "cd" | "security" | "instructions";
  status: LaunchProofGateStatus;
  verdict: string;
  detail: string;
}

export interface LaunchProofReport {
  repoPath: string;
  generatedAt: string;
  outputPath: string | null;
  overall: {
    verdict: LaunchProofVerdict;
    summary: string;
  };
  gates: LaunchProofGate[];
  blockers: string[];
  warnings: string[];
  release: AuditReport;
  cd: AuditCdReport;
  security: AuditSecurityReport;
  instructions: AuditInstructionsReport;
}

export interface GenerateLaunchProofReportOptions {
  repoPath?: string;
  outputPath?: string | null;
  fetch?: typeof fetch;
  now?: Date;
}

export interface GeneratedLaunchProofReport {
  report: LaunchProofReport;
  markdown: string;
}

function resolveOutputPath(repoPath: string, outputPath: string | null | undefined): string | null {
  if (outputPath === null) return null;
  const raw = outputPath ?? "launch-proof-report.md";
  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(repoPath, raw);
  const rel = relative(repoPath, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return candidate;
  throw new Error(`proof-report output must stay inside the target repo: ${raw}`);
}

function statusFromRelease(report: AuditReport): LaunchProofGateStatus {
  if (report.shipReady.verdict === "yes") return "pass";
  if (report.shipReady.verdict === "needs-attention") return "attention";
  return "fail";
}

function statusFromCd(report: AuditCdReport): LaunchProofGateStatus {
  if (report.overall.verdict === "in-sync") return "pass";
  if (report.overall.verdict === "unknown") return "attention";
  return "fail";
}

function statusFromSecurity(report: AuditSecurityReport): LaunchProofGateStatus {
  if (report.overall.verdict === "hardened") return "pass";
  if (report.overall.verdict === "needs-attention") return "attention";
  return "fail";
}

function statusFromInstructions(report: AuditInstructionsReport): LaunchProofGateStatus {
  return report.overall.verdict === "attention" ? "attention" : "pass";
}

function classifyOverall(gates: LaunchProofGate[]): LaunchProofVerdict {
  if (gates.some((g) => g.status === "fail")) return "blocked";
  if (gates.some((g) => g.status === "attention")) return "attention";
  return "ready";
}

function summaryForVerdict(verdict: LaunchProofVerdict): string {
  if (verdict === "ready") {
    return "The repo passed the release, publishing, security, and instruction-review proof gates checked by create-starter.";
  }
  if (verdict === "attention") {
    return "The repo has no hard proof-gate failure, but at least one gate needs human review before launch.";
  }
  return "The repo is not ready to launch until the failed proof gates are resolved.";
}

function mergeFindings(
  release: AuditReport,
  cd: AuditCdReport,
  security: AuditSecurityReport,
  instructions: AuditInstructionsReport,
): {
  blockers: string[];
  warnings: string[];
} {
  const blockers = [
    ...release.shipReady.blockers.map((b) => `release: ${b}`),
    ...cd.overall.blockers.map((b) => `cd: ${b}`),
  ];
  if (security.overall.verdict === "soft") {
    blockers.push(...security.overall.issues.map((i) => `security: ${i}`));
  }

  const warnings = [
    ...release.shipReady.warnings.map((w) => `release: ${w}`),
    ...cd.overall.warnings.map((w) => `cd: ${w}`),
  ];
  if (security.overall.verdict === "needs-attention") {
    warnings.push(...security.overall.issues.map((i) => `security: ${i}`));
  }
  warnings.push(...instructions.overall.warnings.map((w) => `instructions: ${w}`));
  if (instructions.overall.verdict === "attention") {
    warnings.push(
      `instructions: ${instructions.duplicates.length} duplicate candidate(s) and ${instructions.surfaceOverlaps.length} surface overlap(s) need review`,
    );
  } else if (instructions.overall.verdict === "advisory") {
    warnings.push(`instructions: ${instructions.riskSummaries.length} advisory keyword risk summary item(s)`);
  }

  return { blockers, warnings };
}

function formatList(items: string[], empty: string): string[] {
  if (items.length === 0) return [`- ${empty}`];
  return items.map((item) => `- ${item}`);
}

export function formatLaunchProofReport(report: LaunchProofReport): string {
  const out: string[] = [];
  out.push("# Launch Proof Report");
  out.push("");
  out.push(`Generated: ${report.generatedAt}`);
  out.push(`Repo: ${report.repoPath}`);
  out.push(`Overall: ${report.overall.verdict.toUpperCase()}`);
  out.push("");
  out.push(report.overall.summary);
  out.push("");
  out.push("> This is a technical launch-readiness report. It is not legal, compliance, store-review, or security-certification advice.");
  out.push("");
  out.push("## Proof gates");
  out.push("");
  out.push("| Gate | Status | Tool verdict | Detail |");
  out.push("| --- | --- | --- | --- |");
  for (const gate of report.gates) {
    out.push(`| ${gate.name} | ${gate.status} | ${gate.verdict} | ${gate.detail} |`);
  }
  out.push("");
  out.push("## Blockers");
  out.push("");
  out.push(...formatList(report.blockers, "No hard blockers from these proof gates."));
  out.push("");
  out.push("## Warnings");
  out.push("");
  out.push(...formatList(report.warnings, "No warnings from these proof gates."));
  out.push("");
  out.push("## Recommended next action");
  out.push("");
  if (report.overall.verdict === "ready") {
    out.push("- Tag or publish only through the configured release workflow, then archive this report with the release evidence.");
  } else {
    out.push("- Fix failed gates first, rerun `create-starter proof-report`, and keep the regenerated report as the launch handoff.");
  }
  out.push("- If this product needs store assets, run the matching asset generator such as `shotkit` before submission.");
  out.push("");
  out.push("## Raw audit evidence");
  out.push("");
  out.push("### audit");
  out.push("");
  out.push("```text");
  out.push(formatAuditReport(report.release).trimEnd());
  out.push("```");
  out.push("");
  out.push("### audit-cd");
  out.push("");
  out.push("```text");
  out.push(formatAuditCdReport(report.cd).trimEnd());
  out.push("```");
  out.push("");
  out.push("### audit-security");
  out.push("");
  out.push("```text");
  out.push(formatAuditSecurityReport(report.security).trimEnd());
  out.push("```");
  out.push("");
  out.push("### audit-instructions");
  out.push("");
  out.push("```text");
  out.push(formatAuditInstructionsReport(report.instructions).trimEnd());
  out.push("```");
  out.push("");
  return out.join("\n");
}

export function formatLaunchProofSummary(report: LaunchProofReport): string {
  const out: string[] = [];
  out.push(`Launch Proof Report: ${report.overall.verdict.toUpperCase()}`);
  if (report.outputPath) out.push(`Output: ${report.outputPath}`);
  out.push("");
  for (const gate of report.gates) {
    out.push(`- ${gate.name}: ${gate.status} (${gate.verdict})`);
  }
  if (report.blockers.length > 0) {
    out.push("");
    out.push("Blockers:");
    for (const blocker of report.blockers) out.push(`- ${blocker}`);
  }
  return out.join("\n") + "\n";
}

export async function generateLaunchProofReport(
  options: GenerateLaunchProofReportOptions = {},
): Promise<GeneratedLaunchProofReport> {
  const repoPath = resolve(options.repoPath ?? process.cwd());
  const outputPath = resolveOutputPath(repoPath, options.outputPath);
  const [release, cd, security, instructions] = await Promise.all([
    auditRelease(repoPath),
    auditCd(repoPath, { fetch: options.fetch }),
    auditSecurity(repoPath),
    auditInstructions(repoPath),
  ]);

  const gates: LaunchProofGate[] = [
    {
      name: "release",
      status: statusFromRelease(release),
      verdict: release.shipReady.verdict,
      detail: `${release.publishWorkflow.likelyKind}; version ${release.version.current ?? "unknown"}`,
    },
    {
      name: "cd",
      status: statusFromCd(cd),
      verdict: cd.overall.verdict,
      detail: `${cd.destinations.length} destination(s) checked`,
    },
    {
      name: "security",
      status: statusFromSecurity(security),
      verdict: security.overall.verdict,
      detail: `${security.summary.present} present, ${security.summary.partial} partial, ${security.summary.missing} missing`,
    },
    {
      name: "instructions",
      status: statusFromInstructions(instructions),
      verdict: instructions.overall.verdict,
      detail: `${instructions.duplicates.length} duplicate(s), ${instructions.surfaceOverlaps.length} overlap(s), ${instructions.riskSummaries.length} advisory risk summary item(s)`,
    },
  ];
  const verdict = classifyOverall(gates);
  const findings = mergeFindings(release, cd, security, instructions);
  const report: LaunchProofReport = {
    repoPath,
    generatedAt: (options.now ?? new Date()).toISOString(),
    outputPath,
    overall: {
      verdict,
      summary: summaryForVerdict(verdict),
    },
    gates,
    blockers: findings.blockers,
    warnings: findings.warnings,
    release,
    cd,
    security,
    instructions,
  };
  const markdown = formatLaunchProofReport(report);
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, markdown + "\n", "utf8");
  }
  return { report, markdown };
}
