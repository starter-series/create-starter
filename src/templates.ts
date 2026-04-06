export interface Template {
  id: string;
  name: string;
  description: string;
  repo: string;
  stack: string[];
  category: "mcp" | "package" | "bot" | "app" | "extension" | "deploy";
  variables: Variable[];
}

export interface Variable {
  key: string;
  description: string;
  default?: string;
  /** File globs where this variable should be replaced */
  files: string[];
}

const ORG = "starter-series";

const nameVar: Variable = {
  key: "project_name",
  description: "Project name (kebab-case)",
  files: ["package.json", "pyproject.toml", "README.md"],
};

const descVar: Variable = {
  key: "project_description",
  description: "One-line project description",
  files: ["package.json", "pyproject.toml", "README.md"],
};

export const templates: Template[] = [
  {
    id: "mcp-server",
    name: "MCP Server (TypeScript)",
    description:
      "TypeScript MCP server with OIDC npm publishing, Zod schemas, and safety annotations",
    repo: `${ORG}/mcp-server-starter`,
    stack: ["typescript", "mcp-sdk", "zod"],
    category: "mcp",
    variables: [
      { ...nameVar, default: "my-mcp-server" },
      { ...descVar, default: "An MCP server" },
    ],
  },
  {
    id: "mcp-server-python",
    name: "MCP Server (Python)",
    description:
      "Python MCP server with FastMCP, OIDC PyPI publishing, and async/await",
    repo: `${ORG}/python-mcp-server-starter`,
    stack: ["python", "fastmcp"],
    category: "mcp",
    variables: [
      { ...nameVar, default: "my-mcp-server" },
      { ...descVar, default: "An MCP server" },
    ],
  },
  {
    id: "npm-package",
    name: "npm Package",
    description:
      "npm package with OIDC trusted publishing, Jest, ESLint, and semver bumper",
    repo: `${ORG}/npm-package-starter`,
    stack: ["javascript", "jest", "eslint"],
    category: "package",
    variables: [
      { ...nameVar, default: "my-package" },
      { ...descVar, default: "A lightweight npm package" },
    ],
  },
  {
    id: "discord-bot",
    name: "Discord Bot",
    description:
      "Discord.js v14 bot with auto-loaded slash commands, Docker, and one-click deploy",
    repo: `${ORG}/discord-bot-starter`,
    stack: ["typescript", "discord.js", "docker"],
    category: "bot",
    variables: [
      { ...nameVar, default: "my-discord-bot" },
      { ...descVar, default: "A Discord bot" },
    ],
  },
  {
    id: "telegram-bot",
    name: "Telegram Bot",
    description:
      "grammY bot with polling + webhook dual mode, Docker, and one-click deploy",
    repo: `${ORG}/telegram-bot-starter`,
    stack: ["typescript", "grammy", "docker"],
    category: "bot",
    variables: [
      { ...nameVar, default: "my-telegram-bot" },
      { ...descVar, default: "A Telegram bot" },
    ],
  },
  {
    id: "browser-extension",
    name: "Browser Extension (Manifest V3)",
    description:
      "Chrome + Firefox extension with CWS and AMO auto-publishing",
    repo: `${ORG}/browser-extension-starter`,
    stack: ["javascript", "manifest-v3"],
    category: "extension",
    variables: [
      { ...nameVar, default: "my-extension" },
      { ...descVar, default: "A browser extension" },
    ],
  },
  {
    id: "vscode-extension",
    name: "VS Code Extension",
    description:
      "Dual publish to VS Marketplace + Open VSX, vanilla JS, no build step",
    repo: `${ORG}/vscode-extension-starter`,
    stack: ["javascript", "vscode-api"],
    category: "extension",
    variables: [
      { ...nameVar, default: "my-vscode-extension" },
      { ...descVar, default: "A VS Code extension" },
    ],
  },
  {
    id: "electron-app",
    name: "Electron App",
    description:
      "Cross-platform desktop app with code signing, auto-update, macOS/Windows/Linux",
    repo: `${ORG}/electron-app-starter`,
    stack: ["typescript", "electron", "electron-builder"],
    category: "app",
    variables: [
      { ...nameVar, default: "my-electron-app" },
      { ...descVar, default: "A desktop application" },
    ],
  },
  {
    id: "react-native",
    name: "React Native (Expo)",
    description:
      "Expo SDK 52 + EAS Build with App Store and Play Store CI/CD",
    repo: `${ORG}/react-native-starter`,
    stack: ["typescript", "expo", "react-native"],
    category: "app",
    variables: [
      { ...nameVar, default: "my-app" },
      { ...descVar, default: "A mobile application" },
    ],
  },
  {
    id: "cloudflare-pages",
    name: "Cloudflare Pages",
    description:
      "Static site with Wrangler CLI and Cloudflare Pages auto-deploy",
    repo: `${ORG}/cloudflare-pages-starter`,
    stack: ["html", "css", "javascript", "wrangler"],
    category: "deploy",
    variables: [
      { ...nameVar, default: "my-site" },
      { ...descVar, default: "A static website" },
    ],
  },
  {
    id: "docker-deploy",
    name: "Docker Deploy",
    description:
      "Any language, one Dockerfile, GHCR + SSH deploy to any VPS",
    repo: `${ORG}/docker-deploy-starter`,
    stack: ["docker", "github-actions"],
    category: "deploy",
    variables: [
      { ...nameVar, default: "my-service" },
      { ...descVar, default: "A containerized service" },
    ],
  },
];

export function getTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}
