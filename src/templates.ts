export interface Template {
  id: string;
  name: string;
  description: string;
  repo: string;
  ref?: string;
  stack: string[];
  category: "mcp" | "package" | "bot" | "app" | "extension" | "deploy";
  defaults: { name: string; description: string };
  postSteps: string[];
}

const ORG = "starter-series";

export const retiredTemplateIds: readonly string[] = ["discord-bot", "telegram-bot", "electron-app", "react-native", "cloudflare-pages"];

const JS_STEPS = ["npm install", "npm run dev"];
const PY_STEPS = [
  "python -m venv .venv && source .venv/bin/activate",
  "pip install -e '.[dev]'",
];

export const templates: Template[] = [
  {
    id: "mcp-server",
    name: "MCP Server (TypeScript)",
    description:
      "TypeScript MCP server with OIDC npm publishing, Zod schemas, and safety annotations",
    repo: `${ORG}/mcp-server-starter`,
    stack: ["typescript", "mcp-sdk", "zod"],
    category: "mcp",
    defaults: { name: "my-mcp-server", description: "An MCP server" },
    postSteps: JS_STEPS,
  },
  {
    id: "mcp-server-python",
    name: "MCP Server (Python)",
    description:
      "Python MCP server with FastMCP, OIDC PyPI publishing, and async/await",
    repo: `${ORG}/python-mcp-server-starter`,
    stack: ["python", "fastmcp"],
    category: "mcp",
    defaults: { name: "my-mcp-server", description: "An MCP server" },
    postSteps: PY_STEPS,
  },
  {
    id: "npm-package",
    name: "npm Package",
    description:
      "npm package with OIDC trusted publishing, Jest, ESLint, and semver bumper",
    repo: `${ORG}/npm-package-starter`,
    stack: ["javascript", "jest", "eslint"],
    category: "package",
    defaults: { name: "my-package", description: "A lightweight npm package" },
    postSteps: ["npm install", "npm test", "npm run build"],
  },
  {
    id: "browser-extension",
    name: "Browser Extension (Manifest V3)",
    description:
      "Chrome + Firefox extension with CWS and AMO auto-publishing",
    repo: `${ORG}/browser-extension-starter`,
    stack: ["javascript", "manifest-v3"],
    category: "extension",
    defaults: { name: "my-extension", description: "A browser extension" },
    postSteps: JS_STEPS,
  },
  {
    id: "vscode-extension",
    name: "VS Code Extension",
    description:
      "Dual publish to VS Marketplace + Open VSX, vanilla JS, no build step",
    repo: `${ORG}/vscode-extension-starter`,
    stack: ["javascript", "vscode-api"],
    category: "extension",
    defaults: {
      name: "my-vscode-extension",
      description: "A VS Code extension",
    },
    postSteps: ["npm install", "npm test", "npm run build"],
  },
  {
    id: "docker-deploy",
    name: "Docker Deploy",
    description: "Any language, one Dockerfile, GHCR + SSH deploy to any VPS",
    repo: `${ORG}/docker-deploy-starter`,
    stack: ["docker", "github-actions"],
    category: "deploy",
    defaults: { name: "my-service", description: "A containerized service" },
    postSteps: ["docker compose up"],
  },
];

export function getTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}

export function archiveUrl(tmpl: Template): string {
  const ref = tmpl.ref ?? "main";
  return `https://github.com/${tmpl.repo}/archive/refs/heads/${ref}.tar.gz`;
}
