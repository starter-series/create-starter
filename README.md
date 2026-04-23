# create-starter

> Scaffold projects from the [Starter Series](https://github.com/starter-series) templates — MCP server, Claude Code skill, and direct CLI, in one package.

[🇰🇷 한국어](README.ko.md)

## What it does

`create-starter` downloads a Starter Series template, substitutes placeholders (name, description), handles Python package renames (pyproject + src dir), and runs `git init`. Input is validated by Zod before any filesystem change, extraction happens in a sibling tmp dir so failures never leave half-scaffolded output, and downloads have retry + timeout + size limits.

It runs in five modes — pick whichever matches your workflow.

- **Claude Code plugin** — `/plugin marketplace add starter-series/create-starter` then `/plugin install create-starter@starter-series`. Ships the MCP server and skill together.
- **Claude Desktop extension** — drag a `.mcpb` from the [latest release](https://github.com/starter-series/create-starter/releases/latest) onto the Claude Desktop settings window. No `npm`, no JSON editing.
- **CLI** — `npx @starter-series/create my-bot --template discord-bot` in any terminal.
- **MCP server** — any MCP-compatible agent (Claude Desktop, Claude Code, Cursor, Windsurf, …) can call `list_templates` and `create_project`.
- **Claude Code skill** — the bundled `skills/create/SKILL.md` guides Claude Code conversationally (auto-installed with the plugin).

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

## One-click install in Claude Desktop

Grab the latest `.mcpb` bundle from the [Releases page](https://github.com/starter-series/create-starter/releases/latest) and drag it onto the Claude Desktop settings window. Claude Desktop unpacks the bundled `dist/` and `node_modules/` and registers `create-starter` as an MCP server — no `npm`, no config file, no absolute path.

> `.mcpb` (MCP Bundle, formerly `.dxt`) is Anthropic's packaged extension format for MCP servers. See [Desktop Extensions](https://www.anthropic.com/engineering/desktop-extensions).

To rebuild the bundle locally:

```bash
npm ci
npm run bundle:mcpb   # produces create-starter-<version>.mcpb
```

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

## Use as Claude Code plugin

The plugin bundles both the MCP server and the `create` skill — one install wires them up together.

From the Claude Code REPL:

```
/plugin marketplace add starter-series/create-starter
/plugin install create-starter@starter-series
```

Then ask Claude: *"scaffold a new discord bot named `my-bot`"* and the `create-starter:create` skill guides the conversation into the MCP tools.

For local development (no marketplace round-trip):

```bash
claude --plugin-dir /path/to/create-starter
```

Point at a git clone so edits in `skills/create/SKILL.md` or `dist/index.js` take effect the moment the session starts.

## Use via MCP Registry

This server is published to the [Official MCP Registry](https://registry.modelcontextprotocol.io/) under the namespace:

```
io.github.starter-series/create-starter
```

MCP-compatible clients that integrate registry discovery can install it by name without manual path wiring. The registry entry points at the npm package `@starter-series/create`, so `npx` runs the same stdio server described above.

Ownership is verified through GitHub OIDC (namespace `io.github.starter-series/*`) and npm tarball inspection (`package.json#mcpName`). See [`.github/workflows/publish-mcp-registry.yml`](.github/workflows/publish-mcp-registry.yml) for the publish flow.

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
