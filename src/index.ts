#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { stderrLogger } from "./log.js";
import { formatScaffoldReport, SAFE_NAME, scaffold } from "./scaffold.js";
import { getTemplate, templates } from "./templates.js";
import { runCli } from "./cli.js";
import { auditRelease, formatAuditReport, type AuditReport } from "./audit.js";
import { auditCd, formatAuditCdReport, type AuditCdReport } from "./audit-cd.js";
import {
  auditSecurity,
  formatAuditSecurityReport,
  type AuditSecurityReport,
} from "./audit-security.js";
import {
  seedSecurityGuidance,
  formatSeedSecurityGuidanceReport,
} from "./seed-security-guidance.js";
import {
  auditReleaseOutputShape,
  auditCdOutputShape,
  auditSecurityOutputShape,
  seedSecurityGuidanceOutputShape,
  addComponentOutputShape,
  componentGroupValues,
} from "./mcp-schemas.js";
import { addComponent, formatAddComponentReport } from "./add-component.js";
import { readVersion } from "./version.js";

async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "create-starter",
    version: readVersion(),
  });

  server.registerTool(
    "list_templates",
    {
      description: "List all available Starter Series project templates",
      outputSchema: {
        templates: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            stack: z.array(z.string()),
            category: z.enum(["mcp", "package", "bot", "app", "extension", "deploy"]),
          }),
        ),
      },
    },
    async () => {
      const summary = templates.map(({ id, name, description, stack, category }) => ({
        id,
        name,
        description,
        stack,
        category,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
        structuredContent: { templates: summary },
      };
    },
  );

  server.registerTool(
    "create_project",
    {
      description: "Scaffold a new project from a Starter Series template",
      inputSchema: {
        template: z
          .enum(templates.map((t) => t.id) as [string, ...string[]])
          .describe("Template ID (use list_templates to see options)"),
        name: z
          .string()
          .regex(
            SAFE_NAME,
            "Must start with [A-Za-z0-9] and contain only [A-Za-z0-9_-] (no dots, spaces, or path separators)",
          )
          .describe("Project name (alphanumeric start, '-' or '_' only)"),
        description: z
          .string()
          .optional()
          .describe("One-line project description"),
        output_dir: z
          .string()
          .optional()
          .describe("Output directory (defaults to ./<name>, relative to the MCP server's cwd)"),
        init_git: z
          .boolean()
          .optional()
          .describe("Initialize a fresh git repo after scaffold (default: true)"),
      },
      outputSchema: {
        path: z.string(),
        filesExtracted: z.number(),
        filesReplaced: z.number(),
        gitInitialized: z.boolean(),
      },
    },
    async ({ template: templateId, name, description, output_dir, init_git }) => {
      const tmpl = getTemplate(templateId);
      if (!tmpl) {
        return {
          content: [{ type: "text" as const, text: `Unknown template: ${templateId}` }],
          isError: true,
        };
      }

      try {
        const result = await scaffold({
          template: tmpl,
          projectName: name,
          description,
          outputDir: output_dir,
          initGit: init_git ?? true,
          logger: stderrLogger,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatScaffoldReport(name, tmpl, result),
            },
          ],
          structuredContent: {
            path: result.path,
            filesExtracted: result.filesExtracted,
            filesReplaced: result.filesReplaced,
            gitInitialized: result.gitInitialized,
          },
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to scaffold: ${(e as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Each audit_* tool is registered inline because TS can't infer the generic
  // OutputArgs through a helper without the call sites looking even uglier.
  // The shape is intentionally identical: optional path, structured report,
  // text mirror via format*, isError on throw.

  const auditPathInput = {
    path: z
      .string()
      .optional()
      .describe(
        "Path to the repo to audit (default: the MCP server's cwd). Use the absolute path of the project the user is working in.",
      ),
  };

  server.registerTool(
    "audit_release",
    {
      description:
        "Audit a local repo for release-readiness against the Starter Series quality bar. Detects matched starter, CHANGELOG drift vs merged PRs, version-bump status, and publish-workflow presence. Read-only; never mutates the repo.",
      inputSchema: auditPathInput,
      outputSchema: auditReleaseOutputShape,
    },
    async ({ path: repoPath }) => {
      try {
        const report: AuditReport = await auditRelease(repoPath ?? process.cwd());
        return {
          content: [{ type: "text" as const, text: formatAuditReport(report) }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `audit_release failed: ${(e as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "audit_cd",
    {
      description:
        "Check whether the local repo's version has been published to its destination registries (npm, PyPI, Open VSX, VS Marketplace, AMO, GitHub Releases). Makes outbound HTTPS requests to public registry APIs; never mutates. Reports per-destination drift (in-sync / needs-publish / local-stale / not-found).",
      inputSchema: auditPathInput,
      outputSchema: auditCdOutputShape,
    },
    async ({ path: repoPath }) => {
      try {
        const report: AuditCdReport = await auditCd(repoPath ?? process.cwd());
        return {
          content: [{ type: "text" as const, text: formatAuditCdReport(report) }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `audit_cd failed: ${(e as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "audit_security",
    {
      description:
        "Audit a local repo for baseline security CI hygiene against the Starter Series quality bar: gitleaks, CodeQL, dependency audit, license check, --ignore-scripts, Dependabot, secret-scanning hints, claude-code-security-review Action, and claude-security-guidance.md. Read-only.",
      inputSchema: auditPathInput,
      outputSchema: auditSecurityOutputShape,
    },
    async ({ path: repoPath }) => {
      try {
        const report: AuditSecurityReport = await auditSecurity(repoPath ?? process.cwd());
        return {
          content: [{ type: "text" as const, text: formatAuditSecurityReport(report) }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `audit_security failed: ${(e as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "add_component",
    {
      description:
        "Lift a starter's CI/CD layer into an EXISTING repo without re-scaffolding — the remediation half of the audit loop (audit_security/audit_release diagnose; this installs the missing files from the matching starter). Components: ci (.github/workflows/ci.yml), security (codeql.yml + SECURITY.md), dependabot (dependabot.yml + auto-merge), maintenance (stale + weekly health check), or all. DRY-RUN BY DEFAULT: returns a per-file plan (create / identical / skip-exists / overwrite) and writes nothing until dry_run is false. Existing-but-different files are skipped unless force — so the dry-run plan doubles as a drift report against the starter. Never touches app code or secrets-bearing CD workflows.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(
            "Path to the repo (default: the MCP server's cwd). Use the absolute path of the project the user is working in.",
          ),
        component: z
          .enum(componentGroupValues)
          .optional()
          .describe("Which group to lift (default: all)."),
        starter: z
          .string()
          .optional()
          .describe(
            "Template id to lift from (see list_templates). Auto-detected from the repo when omitted.",
          ),
        dry_run: z
          .boolean()
          .optional()
          .describe("Preview only (default true). Set false to write the planned files."),
        force: z
          .boolean()
          .optional()
          .describe(
            "Overwrite files that differ from the starter AND allow applying onto a dirty git tree. Default false.",
          ),
      },
      outputSchema: addComponentOutputShape,
    },
    async ({ path: repoPath, component, starter, dry_run, force }) => {
      try {
        const report = await addComponent(repoPath ?? process.cwd(), {
          component,
          starter,
          dryRun: dry_run,
          force,
        });
        return {
          content: [{ type: "text" as const, text: formatAddComponentReport(report) }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `add_component failed: ${(e as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "seed_security_guidance",
    {
      description:
        "Generate a starter `claude-security-guidance.md` at the repo root, tailored to the detected Starter Series template. The file is consumed in-session by Anthropic's Claude Code Security Guidance Plugin (released 2026-05-26) as a guard while Claude writes code. Use `force: true` to overwrite an existing file.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(
            "Path to the repo (default: the MCP server's cwd). Use the absolute path of the project the user is working in.",
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "Overwrite an existing claude-security-guidance.md. Default false (returns status='exists' instead).",
          ),
      },
      outputSchema: seedSecurityGuidanceOutputShape,
    },
    async ({ path: repoPath, force }) => {
      try {
        const report = seedSecurityGuidance({ repoPath, force });
        return {
          content: [{ type: "text" as const, text: formatSeedSecurityGuidanceReport(report) }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `seed_security_guidance failed: ${(e as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  // No extra argv → MCP stdio mode (how Claude Desktop/Code/Cursor invoke us).
  // Any positional arg or flag → CLI mode (for direct terminal use).
  const extras = process.argv.slice(2);
  if (extras.length === 0) {
    await runMcpServer();
  } else {
    const code = await runCli(extras);
    process.exit(code);
  }
}

main().catch((err) => {
  process.stderr.write(`[create-starter] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
