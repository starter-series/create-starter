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
  auditReleaseOutputShape,
  auditCdOutputShape,
  auditSecurityOutputShape,
} from "./mcp-schemas.js";

const PKG_VERSION = "0.4.0";

async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "create-starter",
    version: PKG_VERSION,
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
        "Audit a local repo for baseline security CI hygiene against the Starter Series quality bar: gitleaks, CodeQL, dependency audit, license check, --ignore-scripts, Dependabot, secret-scanning hints, and claude-code-security-review Action. Read-only.",
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
