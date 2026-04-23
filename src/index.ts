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
        /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
        "Must be alphanumeric with optional '-' or '_' (no dots, spaces, or metachars)",
      )
      .describe("Project name (alphanumeric, '-' or '_' only)"),
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
      });

      const steps = [`cd ${name}`, ...tmpl.postSteps];

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Project "${name}" created from ${tmpl.name}`,
              `  Path: ${result.path}`,
              `  Files customized: ${result.filesReplaced}`,
              "",
              "Next steps:",
              ...steps.map((s) => `  ${s}`),
            ].join("\n"),
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
server.connect(transport).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
