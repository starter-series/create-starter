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

import { z } from "zod";

// ---- audit_release ----

const confidenceLevel = z.enum(["high", "medium", "low", "none"]);

export const auditReleaseOutputShape = {
  repoPath: z.string(),
  matchedStarter: z.object({
    id: z.string().nullable(),
    confidence: confidenceLevel,
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
    source: z
      .enum(["package.json", "pyproject.toml", "manifest.json"])
      .nullable(),
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
    likelyKind: z.enum([
      "release-please",
      "auto-release",
      "publish-on-tag",
      "publish-manual",
      "unknown",
      "missing",
    ]),
  }),
  shipReady: z.object({
    verdict: z.enum(["yes", "no", "needs-attention"]),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
};

// ---- audit_cd ----

const cdStatus = z.enum([
  "in-sync",
  "needs-publish",
  "local-stale",
  "not-found",
  "error",
  "unsupported",
]);

const destinationName = z.enum([
  "npm",
  "pypi",
  "open-vsx",
  "vs-marketplace",
  "amo",
  "github-releases",
]);

export const auditCdOutputShape = {
  repoPath: z.string(),
  matchedStarter: z.object({
    id: z.string().nullable(),
    signals: z.array(z.string()),
  }),
  localVersion: z.string().nullable(),
  versionSource: z
    .enum(["package.json", "pyproject.toml", "manifest.json"])
    .nullable(),
  destinations: z.array(
    z.object({
      name: destinationName,
      identifier: z.string(),
      publishedVersion: z.string().nullable(),
      publishedAt: z.string().nullable(),
      status: cdStatus,
      detail: z.string().optional(),
    }),
  ),
  overall: z.object({
    verdict: z.enum(["in-sync", "needs-publish", "drift", "unknown"]),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
};

// ---- audit_security ----

const checkStatus = z.enum(["present", "missing", "partial", "not-applicable"]);

const securityCheckName = z.enum([
  "gitleaks",
  "codeql",
  "dep-audit",
  "license-check",
  "ignore-scripts",
  "dependabot",
  "secret-scanning",
  "claude-code-security-review",
]);

export const auditSecurityOutputShape = {
  repoPath: z.string(),
  ecosystem: z.enum(["node", "python", "mixed", "other"]),
  checks: z.array(
    z.object({
      name: securityCheckName,
      status: checkStatus,
      evidence: z.array(z.string()),
      recommendation: z.string().optional(),
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
