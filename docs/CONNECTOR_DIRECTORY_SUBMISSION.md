# Anthropic Connector Directory — Submission Dossier

> Reference material for submitting `create-starter` to the [Anthropic Connectors Directory](https://claude.ai/settings/plugins/submit).
> Last reviewed: 2026-04-24 against `https://claude.com/docs/connectors/building/submission`.

`create-starter` is a **local** MCP server (stdio transport). The Anthropic directory accepts local connectors via Desktop Extensions (`.mcpb`); local connectors require a published privacy policy and documentation. This document is the paste-ready dossier — no research required on submission day.

---

## 1. Directory-listed metadata

| Field | Value |
|---|---|
| **Name** | `create-starter` |
| **Display name** | create-starter |
| **Tagline** (≤ ~80 chars) | Scaffold production-ready projects from the Starter Series templates. |
| **Category** | Developer Tools / Scaffolding |
| **Author** | heznpc |
| **License** | MIT |
| **Version at submission** | 0.3.0 |
| **Homepage URL** | https://github.com/starter-series/create-starter#readme |
| **Documentation URL** | https://github.com/starter-series/create-starter#readme |
| **Source URL** | https://github.com/starter-series/create-starter |
| **Issues / Support URL** | https://github.com/starter-series/create-starter/issues |
| **Privacy policy URL** | https://github.com/starter-series/create-starter/blob/main/docs/PRIVACY.md *(TODO: publish before submission if reviewer asks; current stance is "no data collection" — can inline into this dossier)* |
| **npm package** | https://www.npmjs.com/package/@starter-series/create |
| **MCP Registry entry** | `io.github.starter-series/create-starter` (https://registry.modelcontextprotocol.io/) |

### Short description (≤ 160 chars)

> Scaffold production-ready projects — Discord bot, Docker deploy, MCP server, Electron, and more — from the Starter Series templates, with CI/CD baked in.

### Long description (paste into form)

> `create-starter` scaffolds projects from the [Starter Series](https://github.com/starter-series) templates: Discord bot, Telegram bot, Docker deploy, MCP server (TS + Python), npm package with OIDC publish, browser extension, VS Code extension, Electron app, React Native, and Cloudflare Pages.
>
> It downloads the selected template tarball from GitHub, substitutes placeholders (project name, description), handles Python package renames (pyproject + `src/` directory), and runs `git init`. Inputs are Zod-validated before any filesystem write. Extraction happens in a sibling tmp directory and the final path only appears after an atomic `rename` — a failed scaffold never leaves half-written state. Downloads have a 30 s timeout, 3-attempt exponential backoff, and a 50 MB size cap. No credentials handled, no telemetry.
>
> One tool per action: `list_templates` enumerates templates, `create_project` scaffolds one. A bundled Claude Code skill (`skills/create/SKILL.md`) guides the conversation. Installs as Claude Code plugin, Claude Desktop `.mcpb`, or plain `npx`.

### Installation commands per channel

| Channel | Command |
|---|---|
| Claude Desktop (.mcpb) | Drag `create-starter-0.3.0.mcpb` from [latest GitHub release](https://github.com/starter-series/create-starter/releases/latest) onto the Claude Desktop settings window. |
| Claude Code plugin | `/plugin marketplace add starter-series/create-starter` then `/plugin install create-starter@starter-series` |
| npm CLI | `npx @starter-series/create <name> --template <id>` |
| MCP server (manual) | Register `node /abs/path/dist/index.js` under `mcpServers` in the client's config JSON. |
| MCP Registry | `io.github.starter-series/create-starter` (clients with registry discovery) |

---

## 2. Technical surface

| Dimension | Value |
|---|---|
| **Transport** | `stdio` (local only). **No remote endpoint, no Streamable-HTTP server.** |
| **Authentication** | None. No OAuth, no API keys, no tokens. |
| **Capabilities exposed** | 2 tools, 1 Claude Code skill. No resources, no prompts. |
| **Tool list** | `list_templates` (read-only), `create_project` (destructive — writes to disk) |
| **Tool annotations** | `list_templates` → `readOnlyHint: true`. `create_project` → `destructiveHint: false` (idempotent-on-failure: atomic rename or full rollback). |
| **Runtime** | Node.js ≥ 20, cross-platform (macOS / Linux / Windows). Bundled `node_modules/` in `.mcpb`. |
| **Host binaries invoked** | `git` (optional; scaffold succeeds without it — warning on stderr only). No other subprocesses. |
| **Network egress** | HTTPS GET to `github.com/starter-series/<template>/archive/refs/heads/main.tar.gz` only. No other hosts. |
| **Filesystem writes** | Only under user-supplied `output_dir` (default `./<name>`). Extraction happens in sibling `.<name>-incomplete-<rand>/`; atomic `rename` on success, recursive `rm` on any failure. |
| **Path safety** | Project name regex `^[A-Za-z0-9][A-Za-z0-9_-]*$`. Relative `output_dir` rejected if it escapes cwd; absolute paths accepted as explicit user intent. |
| **Download hardening** | 30 s timeout per attempt, 3-attempt exponential backoff, 50 MB size cap. Archive is extracted with `tar` library (not `child_process`). |
| **Execution of downloaded code** | **Never.** Downloaded content is a `.tar.gz` archive extracted as files. No `eval`, no `require()` of extracted code, no `npm install` of the scaffolded project. |
| **Telemetry** | None. `stderr` logs are local-only; gated by `CREATE_STARTER_DEBUG=1`. |
| **Publisher verification** | GitHub OIDC on npm publish + MCP Registry namespace `io.github.starter-series/*`. |

---

## 3. Security & privacy answers

Anticipated review prompts and our ready-to-paste answers:

**Q: Does the connector handle user data, PII, or credentials?**
No. The connector handles only (a) the template ID the user selects, (b) the project name the user types, and (c) an optional one-line description the user types. None of these are transmitted anywhere — they are written into the local scaffold. No credentials, no OAuth, no API keys.

**Q: Does the connector make network calls? To which hosts?**
Yes — one category of call only: HTTPS `GET` to `https://github.com/starter-series/<template>/archive/refs/heads/main.tar.gz` (or the equivalent `codeload.github.com` redirect). This is how the template tarball is fetched. No other origins are contacted. Timeouts: 30 s per attempt, 3 attempts with exponential backoff, 50 MB size cap.

**Q: Does the connector execute arbitrary code on the host?**
No. The only subprocess is an optional `git init` (skipped with `--no-git` or when `git` is absent). Template archives are extracted as files; their contents are never evaluated, required, or executed. The connector itself is a Node.js ESM module invoked with `node dist/index.js`.

**Q: Are there destructive operations on the filesystem?**
Creates only. Writes occur only under the user-specified `output_dir` (default `./<name>`). Extraction is staged in a sibling `.<name>-incomplete-<rand>/` directory; on any error the sibling is recursively removed and the final path is not created. On success, a single atomic `rename` promotes the sibling to the final path. The connector never deletes files outside this sibling, never overwrites existing project directories (fails fast if `output_dir` exists and is non-empty), and does not run `chmod` on anything it did not create.

**Q: PII / telemetry / analytics?**
None. No events are emitted, no metrics collected, no identifiers generated. Verbose `stderr` logs are disabled by default and only enabled when the user sets `CREATE_STARTER_DEBUG=1`; those logs stay on the user's machine and contain only the paths being operated on.

**Q: Third-party services or data sharing?**
The only third party is GitHub, for downloading public template tarballs from the `starter-series` organization. No analytics vendor, no error reporter, no model API is contacted. GitHub's own logging applies to the public HTTPS request.

**Q: Where is data at rest?**
Entirely on the user's local disk. The connector runs as the user's local process; files are written under paths the user supplies.

**Q: How is the connector updated?**
Users update via their chosen channel: `npm install -g @starter-series/create@latest`, reinstalling the plugin from the marketplace, or dragging a newer `.mcpb` onto Claude Desktop. There is no auto-update mechanism and no background process.

---

## 4. Known limitations

- **Host dependencies.** Requires Node.js ≥ 20 on the host. `git` is optional — the scaffold completes without it but leaves no `.git` directory.
- **Template `ref` pinning.** The default template ref is `main`. Each scaffold gets the then-current tip of the template branch; there is no per-scaffold version pinning. This is deliberate (templates are meant to stay modern) but it does mean two scaffolds days apart may differ.
- **No execution sandbox.** The connector trusts the host filesystem permissions. If the user passes an `output_dir` they own, the scaffold writes there; if they pass a system path they can write to, it will write there. No extra sandboxing is applied on top of the OS.
- **GitHub availability.** The template fetch requires `github.com` reachability. Behind a corporate proxy that blocks GitHub, the scaffold fails with a retry-exhausted network error.
- **Windows `rename` edge case.** Cross-volume `rename` on Windows can fail; the connector surfaces the error clearly but cannot transparently fall back to copy-then-delete across volumes.
- **No uninstall side-effects.** Removing the connector does not remove previously scaffolded projects — by design, since those are the user's work.

---

## 5. Support / contact

| Channel | URL |
|---|---|
| GitHub Issues (primary) | https://github.com/starter-series/create-starter/issues |
| Discussions | https://github.com/starter-series/create-starter/discussions |
| Maintainer | heznpc ([github.com/heznpc](https://github.com/heznpc)) |
| Security reports | Open a private security advisory at https://github.com/starter-series/create-starter/security/advisories/new |

Response SLA: best-effort, typically within 72 hours.

---

## 6. Compatibility matrix

| Client | Install path | Status |
|---|---|---|
| **Claude Code** | Plugin marketplace (`starter-series/create-starter`) | Tested — plugin bundles MCP server + `create` skill. Primary development target. |
| **Claude Desktop** | `.mcpb` drag-install | Tested — `create-starter-0.3.0.mcpb` attached to every GitHub release. |
| **Cursor** | Manual `mcpServers` JSON entry | Untested end-to-end but expected to work (standard stdio MCP client). |
| **Windsurf** | Manual `mcpServers` JSON entry | Untested end-to-end but expected to work (standard stdio MCP client). |
| **MCP Registry-aware clients** | `io.github.starter-series/create-starter` | Registry entry live; client-side discovery not verified in third-party clients. |

OS coverage: macOS (arm64, x64), Linux (x64), Windows (x64). All three are smoke-tested via the GitHub Actions matrix defined in `.github/workflows/ci.yml`.

---

## 7. Submission checklist (pre-submit tick-list)

Run through before clicking Submit on `https://claude.ai/settings/plugins/submit`:

- [ ] `v0.3.0` (or later) is the **latest** version on npm (`npm view @starter-series/create version`).
- [ ] `server.json` version matches the npm version.
- [ ] MCP Registry entry for `io.github.starter-series/create-starter` is **live and healthy**.
- [ ] Latest GitHub release has `create-starter-<version>.mcpb` attached and verified to install cleanly into Claude Desktop (drag-and-drop, then call `list_templates`).
- [ ] `README.md` and `README.ko.md` reflect the submitted version.
- [ ] CI green on `main` (`ci.yml`, `publish.yml`, `publish-mcp-registry.yml`).
- [ ] Icon asset ready — see `assets/icon.png` spec in section 9.
- [ ] 3–5 carousel screenshots (≥1000 px wide, PNG) of the scaffolding flow, **without the user prompt visible**, saved under `assets/screenshots/`.
- [ ] Privacy policy URL live, or the "no data collection" stance in this document linked from the submission form.
- [ ] Tool annotations (`readOnlyHint`, `destructiveHint`, `title`) present in the server's `tools/list` response — verify with a local MCP client.
- [ ] Homepage, documentation, source, and support URLs return HTTP 200.
- [ ] Template table in the long description matches `list_templates` output at submission time.
- [ ] Demo video URL (optional, not accepted in carousel but can link in description) — e.g. a 30–60 s asciinema/GIF demo hosted at `https://github.com/starter-series/create-starter#demo` if created.
- [ ] Maintainer email (`wantcongz@gmail.com`) still monitored.

---

## 8. Form answer draft (EN, paste-ready)

Strings below are pre-composed to match every form field we know about. On submission day, open the form and copy each value verbatim.

```
[Name]
create-starter

[Display name]
create-starter

[Tagline]
Scaffold production-ready projects from the Starter Series templates.

[Category]
Developer Tools

[Short description]
Scaffold production-ready projects — Discord bot, Docker deploy, MCP server, Electron, and more — from the Starter Series templates, with CI/CD baked in.

[Long description]
create-starter scaffolds projects from the Starter Series templates: Discord bot, Telegram bot, Docker deploy, MCP server (TypeScript + Python), npm package with OIDC publish, browser extension, VS Code extension, Electron app, React Native (Expo + EAS), and Cloudflare Pages. It downloads the selected template tarball from GitHub, substitutes placeholders, handles Python package renames, and optionally runs `git init`. Inputs are Zod-validated; extraction is staged in a sibling tmp directory and promoted via atomic `rename`, so a failed scaffold never leaves half-written state. Downloads enforce a 30 s timeout, 3-attempt exponential backoff, and a 50 MB cap. No credentials handled, no telemetry. Ships as a Claude Code plugin (MCP server + skill), a Claude Desktop `.mcpb` Desktop Extension, an npm CLI, and a standalone MCP stdio server.

[Use cases]
- "Scaffold a Discord bot called kudos-bot"
- "Create a new MCP server in TypeScript"
- "Set up a Docker-deployed Go service with GHCR and SSH deploy"
- "List every Starter Series template and pick one for me"

[Homepage URL]
https://github.com/starter-series/create-starter#readme

[Documentation URL]
https://github.com/starter-series/create-starter#readme

[Source URL]
https://github.com/starter-series/create-starter

[Support URL]
https://github.com/starter-series/create-starter/issues

[Privacy policy URL]
https://github.com/starter-series/create-starter/blob/main/docs/CONNECTOR_DIRECTORY_SUBMISSION.md#3-security--privacy-answers

[Transport]
stdio (local Desktop Extension / Claude Code plugin)

[Authentication type]
None

[Read/write capabilities]
Read: HTTPS GET of public template tarballs from github.com/starter-series.
Write: local filesystem writes under the user-supplied output_dir only.

[Tool list]
1. list_templates — read-only; returns the template catalog as JSON.
2. create_project — writes; scaffolds a project from a selected template.

[Tool annotations confirmation]
Both tools set `title` and the appropriate hint. list_templates → readOnlyHint=true.
create_project → readOnlyHint=false; destructive operations confined to an atomic
rename of a fresh sibling directory under the user-specified output_dir.

[Third-party connections]
GitHub only, for public template tarball download. No other external services.

[Data handling]
No PII collected, no telemetry emitted, no data at rest outside the scaffolded
project directory. User inputs (name, description, template id) are written locally
into the scaffold and never transmitted.

[Health data access]
No.

[Test account / setup]
No account required. Reviewer can install the .mcpb, call list_templates, then
create_project with template=mcp-server, name=demo to produce a working scaffold.

[GA date]
2026-04-24 (v0.3.0 currently GA on npm and MCP Registry).

[Surfaces tested]
- Claude Code (plugin) — tested
- Claude Desktop (.mcpb) — tested
- Cursor / Windsurf (manual mcpServers entry) — not formally tested

[Branding / logo]
assets/icon.png (1024x1024 PNG, transparent background). TODO on submission day
if not yet generated.

[Screenshots]
assets/screenshots/01-list-templates.png
assets/screenshots/02-create-project.png
assets/screenshots/03-scaffold-complete.png
(All ≥1000 px wide, PNG, prompt text cropped out per Anthropic MCP App spec.)
```

---

## 9. Icon & screenshot specs

### Icon (`assets/icon.png`)

Anthropic's submission doc does **not** publish strict dimensions for connector logos — it only says "server logo (URL or SVG upload), favicon verification". Industry-safe default: **1024 × 1024 PNG, transparent background, ≥ 2:1 contrast on both light and dark backgrounds**. A 512 × 512 variant should also be kept for favicon.

Current state: `assets/icon.png` is a **placeholder TODO** (file not yet generated). On submission day, produce:

- `assets/icon.png` — 1024 × 1024, PNG, transparent. Glyph: the Starter Series logo or a stylized `{ }` scaffold mark.
- `assets/icon-512.png` — 512 × 512 PNG (favicon).

### Screenshots (carousel)

Per Anthropic's MCP App spec:

- **Count**: 3–5
- **Format**: PNG (not GIF, not video)
- **Min width**: 1000 px
- **Aspect ratio**: any, but keep consistent across the set
- **Content**: crop to the Claude response pane only; **do not include the user prompt** in the frame

Suggested flow:

1. `01-list-templates.png` — Claude rendering the `list_templates` JSON as a table.
2. `02-create-project.png` — Claude confirming `create_project` args and the resulting file tree.
3. `03-scaffold-complete.png` — the `README.md` of a freshly scaffolded `discord-bot` open in the user's editor.

---

## 10. Ambiguities flagged during research

- The two official support.claude.com articles redirect to `claude.com/docs/connectors/building/submission`; the support pages themselves no longer contain fields. This dossier tracks the dev-docs source.
- Anthropic does not publish exact logo dimensions for connector submissions — 1024 × 1024 is our assumed safe default.
- Video / GIF carousel assets are **explicitly not accepted**; a demo video can still be linked from the long description or homepage.
- Whether `stdio` / local connectors are listed alongside remote Streamable-HTTP connectors in the same directory view is not fully specified; local connectors are accepted but may be grouped under "Desktop extensions".
- Privacy policy URL: Anthropic says "required for local connectors". Our stance is no data collection — the answer in section 3 stands in for a policy page. If the reviewer asks for a standalone URL we will extract section 3 into `docs/PRIVACY.md` before resubmitting.

---

*Document owner: heznpc. Update this file in lockstep with `package.json#version`, `server.json#version`, and `manifest.json#version`.*
