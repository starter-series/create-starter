export interface Template {
  id: string;
  name: string;
  description: string;
  repo: string;
  stack: string[];
  category: "mcp" | "package" | "bot" | "app" | "extension" | "deploy";
  defaults: { name: string; description: string };
  postSteps: string[];
}

const ORG = "starter-series";

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
    postSteps: JS_STEPS,
  },
  {
    id: "discord-bot",
    name: "Discord Bot",
    description:
      "Discord.js v14 bot with auto-loaded slash commands, Docker, and one-click deploy",
    repo: `${ORG}/discord-bot-starter`,
    stack: ["typescript", "discord.js", "docker"],
    category: "bot",
    defaults: { name: "my-discord-bot", description: "A Discord bot" },
    postSteps: JS_STEPS,
  },
  {
    id: "telegram-bot",
    name: "Telegram Bot",
    description:
      "grammY bot with polling + webhook dual mode, Docker, and one-click deploy",
    repo: `${ORG}/telegram-bot-starter`,
    stack: ["typescript", "grammy", "docker"],
    category: "bot",
    defaults: { name: "my-telegram-bot", description: "A Telegram bot" },
    postSteps: JS_STEPS,
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
    postSteps: JS_STEPS,
  },
  {
    id: "electron-app",
    name: "Electron App",
    description:
      "Cross-platform desktop app with code signing, auto-update, macOS/Windows/Linux",
    repo: `${ORG}/electron-app-starter`,
    stack: ["typescript", "electron", "electron-builder"],
    category: "app",
    defaults: { name: "my-electron-app", description: "A desktop application" },
    postSteps: JS_STEPS,
  },
  {
    id: "react-native",
    name: "React Native (Expo)",
    description:
      "Expo SDK 52 + EAS Build with App Store and Play Store CI/CD",
    repo: `${ORG}/react-native-starter`,
    stack: ["typescript", "expo", "react-native"],
    category: "app",
    defaults: { name: "my-app", description: "A mobile application" },
    postSteps: JS_STEPS,
  },
  {
    id: "cloudflare-pages",
    name: "Cloudflare Pages",
    description:
      "Static site with Wrangler CLI and Cloudflare Pages auto-deploy",
    repo: `${ORG}/cloudflare-pages-starter`,
    stack: ["html", "css", "javascript", "wrangler"],
    category: "deploy",
    defaults: { name: "my-site", description: "A static website" },
    postSteps: JS_STEPS,
  },
  {
    id: "docker-deploy",
    name: "Docker Deploy",
    description:
      "Any language, one Dockerfile, GHCR + SSH deploy to any VPS",
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
