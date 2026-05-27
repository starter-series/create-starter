// Output schemas for MCP `registerTool` calls. Mirror the TypeScript
// interfaces in src/audit.ts, src/audit-cd.ts, src/audit-security.ts so the
// `structuredContent` returned by each tool satisfies the spec.
//
// Spec: MCP 2025-07-09 — "When outputSchema is provided: Servers MUST populate
// structuredContent with data conforming to this schema."
//
// Kept as ZodRawShapeCompat (flat object literals of schemas) — that's what
// McpServer.registerTool accepts. Wrap a top-level entry in z.object(...) only
// when nesting inside another schema.
//
// Enum value tuples below use `satisfies readonly T[]` to assert at compile
// time that every literal here is a valid member of the corresponding union
// type exported by audit*.ts. If audit*.ts adds a new variant, the schema
// here will produce a runtime mismatch on first emission — caught loudly,
// not silently — but the compile-time check still guards against typos.

import { z } from "zod";
import type { ShipVerdict, WorkflowKind, ConfidenceLevel } from "./audit.js";
import type { CdStatus, CdVerdict, DestinationName } from "./audit-cd.js";
import type { CheckStatus, SecurityCheckName } from "./audit-security.js";

// ---- shared enums (sourced from audit*.ts union types) ----

const shipVerdictValues = ["yes", "no", "needs-attention"] as const satisfies readonly ShipVerdict[];

const workflowKindValues = [
  "release-please",
  "auto-release",
  "publish-on-tag",
  "publish-manual",
  "unknown",
  "missing",
] as const satisfies readonly WorkflowKind[];

const confidenceLevelValues = [
  "high",
  "medium",
  "low",
  "none",
] as const satisfies readonly ConfidenceLevel[];

const cdStatusValues = [
  "in-sync",
  "needs-publish",
  "local-stale",
  "not-found",
  "error",
  "unsupported",
] as const satisfies readonly CdStatus[];

const cdVerdictValues = [
  "in-sync",
  "needs-publish",
  "drift",
  "unknown",
] as const satisfies readonly CdVerdict[];

const destinationNameValues = [
  "npm",
  "pypi",
  "open-vsx",
  "vs-marketplace",
  "amo",
  "github-releases",
] as const satisfies readonly DestinationName[];

const checkStatusValues = [
  "present",
  "missing",
  "partial",
  "not-applicable",
] as const satisfies readonly CheckStatus[];

const securityCheckNameValues = [
  "gitleaks",
  "codeql",
  "dep-audit",
  "license-check",
  "ignore-scripts",
  "dependabot",
  "secret-scanning",
  "claude-code-security-review",
  "claude-security-guidance",
] as const satisfies readonly SecurityCheckName[];

// Compile-time exhaustiveness gate: `satisfies` only proves every array element
// is a valid SecurityCheckName — it does NOT prove the reverse, that every
// SecurityCheckName appears in the array. If a future check type is added to
// the union in audit-security.ts but not to the array above, `_MissingFromArray`
// resolves to the missing name(s), the conditional resolves to `never`, and
// the assignment fails compilation. Refresh the array, ship the fix.
type _MissingFromArray = Exclude<SecurityCheckName, (typeof securityCheckNameValues)[number]>;
const _securityCheckExhaustive: [_MissingFromArray] extends [never] ? true : never = true;
void _securityCheckExhaustive;

// VersionSource = "package.json" | ... | null — inline literal in
// audit.ts and audit-cd.ts; not exported as a named type, so we list it
// directly. The nullability is expressed via .nullable() in each schema.
const versionSourceValues = ["package.json", "pyproject.toml", "manifest.json"] as const;

// ---- audit_release ----

export const auditReleaseOutputShape = {
  repoPath: z.string(),
  matchedStarter: z.object({
    id: z.string().nullable(),
    confidence: z.enum(confidenceLevelValues),
    signals: z.array(z.string()),
  }),
  changelog: z.object({
    file: z.string().nullable(),
    unreleasedSection: z.boolean(),
    unreleasedEntries: z.number(),
    unreleasedPrs: z.array(z.number()),
    mergedPrsSinceLastTag: z.array(
      z.object({ number: z.number(), title: z.string() }),
    ),
    missingFromChangelog: z.array(
      z.object({ number: z.number(), title: z.string() }),
    ),
  }),
  version: z.object({
    current: z.string().nullable(),
    source: z.enum(versionSourceValues).nullable(),
    lastTag: z.string().nullable(),
    drift: z.enum([
      "current==tag",
      "current>tag",
      "current<tag",
      "no-tag",
      "unknown",
    ]),
  }),
  publishWorkflow: z.object({
    files: z.array(z.string()),
    likelyKind: z.enum(workflowKindValues),
  }),
  shipReady: z.object({
    verdict: z.enum(shipVerdictValues),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
};

// ---- audit_cd ----

export const auditCdOutputShape = {
  repoPath: z.string(),
  matchedStarter: z.object({
    id: z.string().nullable(),
    signals: z.array(z.string()),
  }),
  localVersion: z.string().nullable(),
  versionSource: z.enum(versionSourceValues).nullable(),
  destinations: z.array(
    z.object({
      name: z.enum(destinationNameValues),
      identifier: z.string(),
      publishedVersion: z.string().nullable(),
      publishedAt: z.string().nullable(),
      status: z.enum(cdStatusValues),
      detail: z.string().optional(),
    }),
  ),
  overall: z.object({
    verdict: z.enum(cdVerdictValues),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
};

// ---- audit_security ----

export const auditSecurityOutputShape = {
  repoPath: z.string(),
  ecosystem: z.enum(["node", "python", "mixed", "other"]),
  checks: z.array(
    z.object({
      name: z.enum(securityCheckNameValues),
      status: z.enum(checkStatusValues),
      evidence: z.array(z.string()),
      recommendation: z.string().optional(),
      optional: z.boolean().optional(),
    }),
  ),
  summary: z.object({
    present: z.number(),
    missing: z.number(),
    partial: z.number(),
  }),
  overall: z.object({
    verdict: z.enum(["hardened", "needs-attention", "soft"]),
    issues: z.array(z.string()),
  }),
};

// ---- seed_security_guidance ----

export const seedSecurityGuidanceOutputShape = {
  repoPath: z.string(),
  filePath: z.string(),
  matchedStarter: z.string().nullable(),
  status: z.enum(["created", "exists", "overwritten"]),
  bytesWritten: z.number(),
  relativePath: z.string(),
};
