# create-starter

> Scaffold projects from the [Starter Series](https://github.com/starter-series) templates — MCP server, Claude Code skill, and direct CLI, in one package.

[🇰🇷 한국어](README.ko.md)

## What it does

`create-starter` downloads a Starter Series template, substitutes placeholders (name, description), handles Python package renames (pyproject + src dir), and runs `git init`. Input is validated by Zod before any filesystem change, extraction happens in a sibling tmp dir so failures never leave half-scaffolded output, and downloads have retry + timeout + size limits.

It runs in three modes — pick whichever matches your workflow.

- **CLI** — `npx @starter-series/create my-bot --template discord-bot` in any terminal.
- **MCP server** — any MCP-compatible agent (Claude Desktop, Claude Code, Cursor, Windsurf, …) can call `list_templates` and `create_project`.
- **Claude Code skill** — the bundled `skill/SKILL.md` lets Claude Code drive scaffolding conversationally.

## Quick start — CLI

```bash
npx @starter-series/create my-bot --template discord-bot
# or, after cloning and building:
node dist/index.js my-bot --template discord-bot
```

```
create-starter — scaffold a project from the Starter Series.

Usage
  create-starter <name> --template <id> [options]
  create-starter --list
  create-starter --help

Options
  -t, --template <id>      Template ID (see --list)
  -d, --description <text> One-line project description
  -o, --output-dir <path>  Output directory (default: ./<name>)
      --no-git             Skip "git init" after scaffold
      --list               List templates and exit
  -h, --help               Show help and exit
  -v, --version            Print version and exit

Environment
  CREATE_STARTER_DEBUG=1   Emit verbose stderr logs
```

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
| `react-native` | Expo + EAS |
| `cloudflare-pages` | Wrangler + Pages |
| `docker-deploy` | any language + GHCR + SSH |

Run `create-starter --list` (CLI) or call `list_templates` (MCP) for the authoritative, up-to-date list.

## Install from source

```bash
git clone https://github.com/starter-series/create-starter
cd create-starter
npm install
npm run build
```

Requires Node.js ≥20.

## Use as MCP server

Register the built binary in your MCP client (Claude Desktop, Cursor, etc.):

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

Then ask your agent: *"Use create-starter to scaffold a new discord bot named `my-bot`."* The agent will call `list_templates` if needed and then `create_project`.

> The binary speaks **MCP stdio** when called with no extra arguments, and switches to **CLI mode** when given any positional argument or flag. Both modes share the same scaffolding engine.

## Use as Claude Code skill

```bash
ln -s "$(pwd)/skill" ~/.claude/skills/create-starter
```

Then in Claude Code: mention the template naturally, or invoke the skill by name — it guides Claude to call the MCP tools instead of shelling out to `curl` / `tar`.

## Tools

- **`list_templates`** — returns the full template table as JSON.
- **`create_project`** — args:
  - `template` *(required)* — template ID from the table above.
  - `name` *(required)* — project name matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`.
  - `description` *(optional)* — one-line description.
  - `output_dir` *(optional)* — defaults to `./<name>` relative to the MCP server's cwd. Relative paths must stay inside cwd; absolute paths are accepted as explicit user intent.
  - `init_git` *(optional, default `true`)* — run `git init` after scaffold.

## Safety & reliability

- Project names are regex-validated before any filesystem touch; relative output paths are rejected if they escape the working directory.
- Downloads enforce a 30 s timeout, 3-attempt exponential backoff, and a 50 MB size cap.
- Extraction happens in a sibling `.<name>-incomplete-<rand>` dir; on any failure (network, corrupt archive, extraction error) the tmp dir is removed. The final path only appears via an atomic `rename` once everything succeeded.
- `git init` failures are logged to stderr but do not fail the scaffold; the project is usable without a `.git` directory.

## License

MIT © heznpc
