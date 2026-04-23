#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { stderrLogger } from "./log.js";
import { formatScaffoldReport, SAFE_NAME, scaffold } from "./scaffold.js";
import { getTemplate, templates } from "./templates.js";
import { runCli } from "./cli.js";

const PKG_VERSION = "0.3.0";

async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "create-starter",
    version: PKG_VERSION,
  });

  server.tool(
    "list_templates",
    "List all available Starter Series project templates",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            templates.map(({ id, name, description, stack, category }) => ({
              id,
              name,
              description,
              stack,
              category,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.tool(
    "create_project",
    "Scaffold a new project from a Starter Series template",
    {
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
