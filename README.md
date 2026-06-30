# create-starter

> Scaffold and audit Starter Series projects — MCP server, Claude Code skill, and CLI in one package.

Part of: **Human-Controlled AI Systems** — scaffolding is the easy half. What keeps a shipped repo trustworthy is the audit primitives (`audit`, `audit-cd`, `audit-security`) verifying release, CD, and CI security hygiene against a known bar — gating each merge instead of asking a human to re-check by hand.

[🇰🇷 한국어](README.ko.md)

## Currently implemented

- **CLI** — `npx @starter-series/create my-bot --template discord-bot`. One of 11 templates with Zod-validated input, atomic rename on success, retry + timeout + 50 MB download cap.
- **MCP server** — nine stdio tools: `list_templates`, `create_project`, `audit_release`, `audit_cd`, `audit_security`, `audit_instructions`, `generate_launch_proof_report`, `seed_security_guidance`, `add_component`. One binary chooses the mode by argv (positional -> CLI, none -> MCP stdio).
- **Claude Desktop extension** — `.mcpb` bundle on every release; drag onto the Claude Desktop settings window.
- **Claude Code plugin + skill** — `/plugin install create-starter@starter-series` ships the MCP server and the conversational `create` skill together.
- **MCP Registry entry** — `io.github.starter-series/create-starter`, OIDC-verified namespace, npm tarball cross-checked.
- **`audit_release`** — detects matched starter, version vs last-tag drift, CHANGELOG drift vs merged PRs (`git log <tag>..HEAD`), publish-workflow kind (release-please / publish-on-tag / auto-release).
- **`audit_cd`** — probes npm, PyPI, Open VSX, VS Marketplace, AMO, GitHub Releases for per-destination publish drift (in-sync / needs-publish / local-stale / not-found / unsupported).
- **`audit_security`** — checks 9 items: 8 core CI primitives (gitleaks with pin check, CodeQL, dependency audit, license check, `--ignore-scripts`, Dependabot grouped, secret-scanning hint, claude-code-security-review Action) plus the optional repo-author `claude-security-guidance.md`. The 8 core checks gate the HARDENED verdict; this repo passes 8/8 core.
- **`audit_instructions` / `audit-instructions`** — reviews agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions) for exact same-file duplicates, cross-file surface overlap, and keyword-based risk reminders. Duplicate/overlap findings need review; keyword risk summaries are advisory only and not exhaustive safety or semantic drift detection.
- **`proof-report` / `generate_launch_proof_report`** — runs release, CD, and security audits together and writes a client-ready [`Launch Proof Report`](docs/launch-proof-report.md). This is the monetizable handoff surface: evidence first, no "certified" claim, exit code 1 unless the repo is actually launch-ready.
- **`add_component`** — the remediation half of the audit loop: lifts a starter's CI/CD layer (ci / security / dependabot / maintenance / all) into an *existing* repo without re-scaffolding. Dry-run by default with a per-file plan (create / identical / skip-exists / overwrite); refuses a dirty git tree unless forced; never touches app code or secrets-bearing CD workflows. The dry-run plan doubles as a drift report against the starter.
- **Graduation guide** — `docs/graduation-from-vibe-coding.md` (+ Korean): five-step path from Lovable/Bolt/v0 exports to GitHub Actions + a real deploy target, using the three audit primitives.

## Planned

- `audit_cd` support for Chrome Web Store, EAS, Railway, Fly, and GHCR. Currently reported as `unsupported` because those destinations require auth or have no public read API.

## Design intent

- **One binary, two surfaces.** CLI and MCP stdio share one scaffolding engine. Argv decides which surface answers. No duplicated logic for "the same thing called from a human vs an agent".
- **Atomic on failure.** Extraction happens in a sibling `.<name>-incomplete-<rand>` directory and only renames into the final path on success. Network failure, corrupt archive, partial write — none of them leaves a half-scaffolded directory behind.
- **Audit is first-class.** Templates ship a security baseline (gitleaks pinned to SHA, CodeQL, Dependabot grouped, `--ignore-scripts`, claude-code-security-review). The three audit commands check whether a downstream repo still matches that bar — turning the baseline from a one-time scaffold into an ongoing gate.
- **Eat your own dogfood.** This repo passes `audit_security` 8/8 core checks (HARDENED); the 9th is the optional `claude-security-guidance.md`. If the tool that audits other repos can't pass its own bar, the bar isn't real.
- **Read-only outside its sandbox.** Downloads are capped (50 MB, 30 s timeout, 3 retries). Relative output paths cannot escape cwd; absolute paths are accepted only as explicit user intent. `git init` failure is logged but non-fatal.

## Non-goals

- **Full vendor parity in `audit_cd`.** Destinations without a public read API stay `unsupported` rather than reporting confidently-wrong state.
- **Rewriting app code.** The graduation flow lifts CI/CD from the matching starter; it never touches application code.
- **A general-purpose project generator.** Templates are the Starter Series 11. New stacks land as new starters, not as flags on `create_project`.
- **Semantic instruction drift or AI safety enforcement.** `audit_instructions` is a review aid for exact duplicate/surface overlap and keyword reminders. It is not a semantic similarity engine, runtime guardrail, red-team harness, or exhaustive safety/security linter.

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
  create-starter audit [path]
  create-starter audit-cd [path]
  create-starter audit-security [path]
  create-starter audit-instructions [path]
  create-starter proof-report [path] [--output <file>] [--stdout]
  create-starter seed-security-guidance [path] [--force]
  create-starter add-component [path] [--component <g>] [--starter <id>] [--apply] [--force]
  create-starter --list
  create-starter --help

Options
  -t, --template <id>      Template ID (see --list)
  -d, --description <text> One-line project description
  -o, --output-dir <path>  Output directory (default: ./<name>)
      --no-git             Skip "git init" after scaffold
      --output <file>       proof-report output (default: <path>/launch-proof-report.md)
      --stdout              print proof-report Markdown; with --output, also writes the file
      --component <group>   add-component group: ci, security, dependabot, maintenance, all
      --starter <id>        add-component source starter override
      --apply               Write the add-component plan (default is dry-run)
      --force               Overwrite differing component files or guidance
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

## Graduating from Lovable / Bolt / v0

Already have a working app on a vibe-coding platform and want to graduate to GitHub Actions + your own deploy target? Read [`docs/graduation-from-vibe-coding.md`](docs/graduation-from-vibe-coding.md) ([한국어](docs/graduation-from-vibe-coding.ko.md)) — a 5-step path that uses `audit`, `audit-cd`, and `audit-security` to diagnose your repo, then lifts CI/CD from the matching starter without rewriting your app code.

## Install from source

```bash
git clone https://github.com/starter-series/create-starter
cd create-starter
npm install
npm run build
```

Requires Node.js ≥22.

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

Ownership is verified through GitHub OIDC (namespace `io.github.starter-series/*`) and npm tarball inspection (`package.json#mcpName`). See [`.github/workflows/publish-mcp-registry.yml`](https://github.com/starter-series/create-starter/blob/main/.github/workflows/publish-mcp-registry.yml) for the publish flow.

For npm release setup (trusted-publisher registration, including the post-2026-05-20 allowed-action step), see [`docs/RELEASING.md`](docs/RELEASING.md).

## Tools

Scaffolding:

- **`list_templates`** — returns the full template table as JSON.
- **`create_project`** — args:
  - `template` *(required)* — template ID from the table above.
  - `name` *(required)* — project name matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`.
  - `description` *(optional)* — one-line description.
  - `output_dir` *(optional)* — defaults to `./<name>` relative to the MCP server's cwd. Relative paths must stay inside cwd; absolute paths are accepted as explicit user intent.
  - `init_git` *(optional, default `true`)* — run `git init` after scaffold.

Audit (each takes an optional `path` arg, default = MCP server cwd; all read-only):

- **`audit_release`** — release-readiness diagnosis. CLI mirror: `create-starter audit [path]`.
- **`audit_cd`** — per-destination publish-drift probe. CLI mirror: `create-starter audit-cd [path]`.
- **`audit_security`** — baseline CI security hygiene check. CLI mirror: `create-starter audit-security [path]`.
- **`audit_instructions`** — agent-instruction duplicate and surface-overlap review, with advisory keyword risk summaries. CLI mirror: `create-starter audit-instructions [path]`.
- **`generate_launch_proof_report`** — combined Markdown launch handoff from release, CD, and security audits. CLI mirror: `create-starter proof-report [path] [--output <file>] [--stdout]`.
- **`seed_security_guidance`** — generate a starter-aware `claude-security-guidance.md` draft. CLI mirror: `create-starter seed-security-guidance [path] [--force]`.
- **`add_component`** — propose or apply starter CI/CD components to an existing repo as a dry-run plan. CLI mirror: `create-starter add-component [path] [--component <g>] [--starter <id>] [--apply] [--force]`.

## Safety & reliability

- Project names are regex-validated before any filesystem touch; relative output paths are rejected if they escape the working directory.
- Downloads enforce a 30 s timeout, 3-attempt exponential backoff, and a 50 MB size cap.
- Extraction happens in a sibling `.<name>-incomplete-<rand>` dir; on any failure (network, corrupt archive, extraction error) the tmp dir is removed. The final path only appears via an atomic `rename` once everything succeeded.
- `git init` failures are logged to stderr but do not fail the scaffold; the project is usable without a `.git` directory.

## Supply-chain security pre-wired

Every Starter Series template ships with the 9 checks `audit_security` looks for — no opt-in required:

| Check | What it catches |
|---|---|
| **gitleaks** (SHA256-pinned manual install) | Committed secrets in code or history |
| **CodeQL** (weekly + PR) | Static analysis for JS/TS/Python |
| **Dependency audit** (`npm audit --audit-level=moderate` / `pip-audit`) | Known CVEs in transitive deps |
| **License check** | GPL/AGPL contamination |
| **`--ignore-scripts`** on every `npm/pnpm/yarn install` | Malicious postinstall scripts |
| **Dependabot grouped updates** | Lockfile-conflict storms from one-by-one bumps |
| **GitHub secret scanning + push protection** | Tokens leaked at push time |
| **`anthropics/claude-code-security-review`** Action on PR | AI-based diff review |
| **`claude-security-guidance.md`** *(this is the only one you write)* | Org-specific rules consumed by Anthropic's in-session [Claude Code Security Guidance Plugin](https://www.anthropic.com/news/claude-code-plugins) (released 2026-05-26) |

This was Vercel's stack during their 2026-04-21 npm supply-chain incident — they pre-empted compromise via the same pre-wired checks plus Socket/npm/GitHub coordination. The Starter Series ships those checks pre-wired in every starter.

## License

MIT © heznpc
