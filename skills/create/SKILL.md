---
name: create
description: Scaffold a new project from the Starter Series templates (MCP server, Discord/Telegram bot, VS Code / browser extension, Electron, React Native, Cloudflare Pages, npm package, Docker deploy).
---

You are scaffolding a new project using the **Starter Series** templates via the `create-starter` MCP server.

## How to invoke

The `create-starter` MCP server exposes two tools. Use them directly — do **not** shell out to `curl`, `tar`, or `git clone`.

- `list_templates` — returns the full template table as JSON.
- `create_project` — scaffolds a new project.

## Workflow

1. **Pick a template.** If the user named one explicitly, resolve it against the registry below. If not, call `list_templates` and ask the user to pick one.
2. **Collect required input:**
   - `name` *(required)* — project name. Must match `^[A-Za-z0-9][A-Za-z0-9_-]*$` (alnum start, then `[A-Za-z0-9_-]` only). No dots, no spaces, no path separators.
   - `description` *(optional)* — one-line description that replaces the template default.
   - `output_dir` *(optional)* — where to create the project. Defaults to `./<name>` relative to the MCP server's cwd.
3. **Call `create_project`** with the gathered arguments. The server handles download, extraction, placeholder substitution, Python package renaming, and `git init`.
4. **Report the next steps** from the tool's response (it returns a `cd`-then-install sequence tuned to the template).

## Template registry

| ID | Name | Category |
|----|------|----------|
| `mcp-server` | MCP Server (TypeScript) | mcp |
| `mcp-server-python` | MCP Server (Python) | mcp |
| `npm-package` | npm Package | package |
| `discord-bot` | Discord Bot | bot |
| `telegram-bot` | Telegram Bot | bot |
| `browser-extension` | Browser Extension (MV3) | extension |
| `vscode-extension` | VS Code Extension | extension |
| `electron-app` | Electron App | app |
| `react-native` | React Native (Expo) | app |
| `cloudflare-pages` | Cloudflare Pages | deploy |
| `docker-deploy` | Docker Deploy (language-agnostic) | deploy |

Call `list_templates` for the authoritative, up-to-date list with full metadata.

## Rules

- Never invent template IDs. Only use IDs returned by `list_templates` or present in the table above.
- Never construct tarball URLs or shell commands yourself — always go through `create_project`.
- If the tool returns an `isError: true` response, surface the message verbatim and stop; do not retry with a different name unless the user asks.
- After a successful scaffold, suggest reviewing `.env.example` if the output mentions environment variables, and remind the user that `git init` has already run — they just need to add a remote.
- Keep your response concise: one line confirming the template + name, then the next-step commands as a code block.
