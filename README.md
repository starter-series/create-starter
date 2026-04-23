# create-starter

> Scaffold projects from the [Starter Series](https://github.com/starter-series) templates — available as an MCP server and a Claude Code skill.

[🇰🇷 한국어](README.ko.md)

## What it does

`create-starter` clones a Starter Series template, renames the project, substitutes placeholders (name, description), and prints the next steps. No filesystem manipulation happens before Zod-validated input is accepted.

Works in two modes:

- **MCP server** — any MCP-compatible agent (Claude Desktop, Cursor, etc.) can call the `list_templates` and `create_project` tools.
- **Claude Code skill** — the bundled `skill/SKILL.md` lets Claude Code drive scaffolding conversationally.

## Usage

`create-starter` is driven by an agent (Claude Code, Claude Desktop, Cursor, …), not by a typed prompt flow. Once the MCP server is registered (see [Use as MCP server](#use-as-mcp-server)), invocation looks like this:

```
You › Use create-starter to scaffold a discord bot called my-bot.

Agent › (calls list_templates, then create_project)
        Project "my-bot" created from Discord Bot
          Path: /Users/you/code/my-bot
          Files customized: 7

        Next steps:
          cd my-bot
          npm install
          npm run dev
```

The agent confirms the template ID and project name, calls `create_project`, and you `cd` into the scaffolded directory. No separate prompt flow — the agent handles the dialogue.

> The `create-starter` binary itself speaks the MCP stdio protocol, so running it directly (e.g. `npx create-starter`) without an MCP client will not print an interactive menu.

## Available templates

| ID | Stack |
|----|-------|
| `mcp-server` | TypeScript + `@modelcontextprotocol/sdk` + Zod |
| `mcp-server-python` | Python + FastMCP |
| `npm-package` | Jest + ESLint + OIDC publish |
| `discord-bot` | discord.js v14 + Docker |
| `telegram-bot` | grammY + Docker |
| `browser-extension` | Chrome/Firefox MV3 |
| `vscode-extension` | VS Marketplace + Open VSX |
| `electron-app` | cross-platform + code signing |
| `react-native` | Expo SDK 52 + EAS |
| `cloudflare-pages` | Wrangler + Pages |
| `docker-deploy` | any language + GHCR + SSH |

Call `list_templates` for the live list.

## Install

```bash
npm install
npm run build
```

Requires Node.js ≥20.

## Use as MCP server

Register in your MCP client (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "create-starter": {
      "command": "node",
      "args": ["/absolute/path/to/create-starter/dist/index.js"]
    }
  }
}
```

Then ask your agent: *"Use create-starter to scaffold a new discord bot named `my-bot`."*

## Use as Claude Code skill

Copy `skill/` into your Claude Code skills directory, or symlink it:

```bash
ln -s "$(pwd)/skill" ~/.claude/skills/create-starter
```

Then in Claude Code: `/create-starter` (or mention the template naturally).

## Tools

- **`list_templates`** → returns the full template table.
- **`create_project`** → args:
  - `template` *(required)* — template ID from the table above.
  - `name` *(required)* — kebab-case project name (`^[a-z0-9][a-z0-9._-]*$`).
  - `description` *(optional)* — one-line description.
  - `output_dir` *(optional)* — defaults to `./<name>`.

## License

MIT © heznpc
