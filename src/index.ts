#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { templates, getTemplate } from "./templates.js";
import { scaffold } from "./scaffold.js";

const server = new McpServer({
  name: "create-starter",
  version: "0.1.0",
});

// ── Tool: list_templates ─────────────────────────────────────────

server.tool(
  "list_templates",
  "List all available Starter Series project templates",
  {},
  async () => {
    const list = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      stack: t.stack,
      category: t.category,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
    };
  },
);

// ── Tool: create_project ─────────────────────────────────────────

server.tool(
  "create_project",
  "Scaffold a new project from a Starter Series template",
  {
    template: z
      .enum(templates.map((t) => t.id) as [string, ...string[]])
      .describe("Template ID (use list_templates to see options)"),
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/, "Must be lowercase kebab-case")
      .describe("Project name (kebab-case)"),
    description: z
      .string()
      .optional()
      .describe("One-line project description"),
    output_dir: z
      .string()
      .optional()
      .describe("Output directory (defaults to ./<name>)"),
  },
  async ({ template: templateId, name, description, output_dir }) => {
    const tmpl = getTemplate(templateId);
    if (!tmpl) {
      return {
        content: [{ type: "text", text: `Unknown template: ${templateId}` }],
        isError: true,
      };
    }

    try {
      const result = await scaffold({
        template: tmpl,
        projectName: name,
        description,
        outputDir: output_dir,
      });

      return {
        content: [
          {
            type: "text",
            text: [
              `Project "${name}" created from ${tmpl.name}`,
              `  Path: ${result.path}`,
              `  Files customized: ${result.filesReplaced}`,
              "",
              "Next steps:",
              `  cd ${name}`,
              tmpl.stack.includes("python")
                ? "  python -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'"
                : "  npm install",
              tmpl.stack.includes("python")
                ? "  python -m " + name.replaceAll("-", "_")
                : "  npm run dev",
            ].join("\n"),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          { type: "text", text: `Failed to scaffold: ${(e as Error).message}` },
        ],
        isError: true,
      };
    }
  },
);

// ── Start ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
