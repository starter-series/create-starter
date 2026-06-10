# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is **append-only**. Each release on
[GitHub Releases](https://github.com/starter-series/create-starter/releases) is the
authoritative source — `.github/workflows/update-changelog.yml` prepends a
new entry here when a release is published, so the file mirrors the
release feed without duplicating maintenance.

## [Unreleased]

### Added
- **`add_component` MCP tool + `/add-component` slash command + `add-component` CLI subcommand** — the remediation half of the audit loop: lifts a starter's CI/CD layer into an existing repo without re-scaffolding. Component groups: `ci` (.github/workflows/ci.yml), `security` (codeql.yml + SECURITY.md), `dependabot` (dependabot.yml + auto-merge), `maintenance` (stale + weekly health check), `all`. Dry-run by default with a per-file plan (`create` / `identical` / `skip-exists` / `overwrite`); applies with `dry_run: false` (CLI `--apply`); refuses a dirty git tree unless `force`; existing-but-different files are skipped unless `force`, so the dry-run plan doubles as a drift report against the starter (the v1 answer to `update_component`). Deliberately excluded from lifting: `cd*.yml` (needs secrets — `deploy-setup`'s job), `setup.yml`, `update-changelog.yml`, PR templates. Reuses the scaffold download path (50 MB / 30 s / 3-retry caps) and `extractStarterSignals` for starter auto-detection.
- **`seed_security_guidance` MCP tool + `/seed-security-guidance` slash command + `seed-security-guidance` CLI subcommand** — generates a starter `claude-security-guidance.md` tailored to the detected Starter Series template (mcp-server / discord-bot / docker-deploy / etc.). Converts the previously template-only check into an actionable Skill/MCP. Content: universal rules + starter-specific section + how-it-gets-used footer. Supports `--force` / `force: true` to overwrite an existing file.
- **Slash commands**: 5 commands surfaced via `.claude-plugin/commands/` for the `/plugin` Discover screen (v2.1.145+) — `/scaffold`, `/audit-release`, `/audit-cd`, `/audit-security`, `/graduate`. Each command wraps an MCP tool / workflow with explicit positioning (e.g., `/audit-security` notes complementarity with Anthropic's in-session `claude-security-guidance` plugin).
- **`audit_security` 9th check — `claude-security-guidance`**: detects presence of `claude-security-guidance.md` at repo root (also `.claude-security-guidance.md` and `.claude/security-guidance.md` are accepted). Anthropic's Claude Code Security Guidance Plugin (released 2026-05-26) reads this file as an in-session guard. Positioning: in-session guard (Anthropic plugin) + post-PR diff review (`claude-code-security-review` Action) + repo-level static audit (this tool) are complementary, not competing.
- **Graduation guide — Cloudflare Workers agent runtime row**: added to the target-mapping table in both EN/KO docs, reflecting the 2026-05-19 Anthropic × Cloudflare Claude Managed Agents announcement and the 2026-05-26 `@cloudflare/voice` SDK. Current path: `docker-deploy` adapter; dedicated `cloudflare-workers-agent` starter on roadmap.
- **README: "Supply-chain security pre-wired" card** (EN + KO) — explicit list of the 9 checks `audit_security` looks for, cross-referenced with the 2026-04-21 Vercel npm supply-chain incident as a real-world timeliness signal.
- `audit_release` — diagnose release-readiness against the Starter Series quality bar. Detects matched starter, version vs last tag drift, CHANGELOG drift vs merged PRs (`git log <tag>..HEAD`), and publish-workflow kind (release-please / publish-on-tag / auto-release). Available as MCP tool (`audit_release`) and CLI (`create-starter audit [path]`).
- `audit_cd` — check whether the local version has been published to its destination registries. Probes npm, PyPI, Open VSX, VS Marketplace, AMO (Firefox), and GitHub Releases via public APIs. Reports per-destination drift (in-sync / needs-publish / local-stale / not-found / unsupported). Available as MCP tool (`audit_cd`) and CLI (`create-starter audit-cd [path]`). CWS, EAS, Railway, Fly, and GHCR are not yet supported (no public read API or auth required).
- `audit_security` — verify baseline CI security hygiene against the Starter Series bar: gitleaks (with pin check), CodeQL, dependency audit, license check, `--ignore-scripts` on every install, Dependabot grouped updates, secret-scanning hint, and the `anthropics/claude-code-security-review` Action. Available as MCP tool (`audit_security`) and CLI (`create-starter audit-security [path]`).
- Self-hardening: `create-starter` repo now passes its own `audit_security` (HARDENED, 8/8 present). Added `.github/workflows/codeql.yml` and `.github/workflows/claude-security-review.yml` (gated on `CLAUDE_API_KEY` secret presence; pinned to commit SHA, Dependabot-tracked). Native GitHub secret-scanning + push-protection + Dependabot security updates enabled on the repo settings.
- `docs/graduation-from-vibe-coding.md` (+ Korean translation) — five-step path for graduating Lovable/Bolt/v0 exports to GitHub Actions + non-platform deploy targets. Uses the three audit primitives to diagnose and CI/CD lift from the matching starter without rewriting app code. Linked from both READMEs.

### Changed
- **Graduation guide narrative** (EN + KO): shifted from "escape platform lock-in" to **"vendor diversity"**. Reflects 2026-05 reality where Vercel (`bio: "Agentic Infrastructure for apps and agents"`), Cloudflare (Claude Managed Agents + voice SDK), and Netlify are all evolving into agentic infra providers. Graduation is about *choosing* a target per app, not fleeing one. **Followup pass**: removed remaining "universal escape hatch" / "stop paying token costs" language to match the intro.
- **`.claude-plugin/plugin.json`**: bumped to 0.4.0 (was stale at 0.3.0; `manifest.json` and `server.json` were already at 0.4.0). Description updated to surface slash commands + audit primitives. Keywords expanded (`audit`, `release`, `publish-drift`, `supply-chain-security`).
- **`manifest.json`** (Claude Desktop .mcpb): description + long_description + tools array brought in line with `plugin.json` and `package.json`. Previously read "Scaffold projects from the Starter Series templates — MCP server, Claude Code skill, and CLI" which omitted audit primitives and slash commands; Claude Desktop catalog now surfaces the full feature set.
- **`package.json#description`** synced to the polished phrasing used by `plugin.json`. Added `publishConfig.provenance: true` as belt-and-suspenders for npm auto-provenance behavior changes.
- **`audit_security` verdict aggregator**: treats `claude-security-guidance` as a recommended-but-not-required check via a new optional `optional: boolean` field on `SecurityCheckResult`. A repo with every CORE CI primitive present stays HARDENED even when `claude-security-guidance.md` hasn't been written yet — surfaced as an issue but does not downgrade the verdict.
- **Graduation guide Cloudflare Workers row**: replaced vague "hand-write a Wrangler config" pointer with two concrete paths — (a) drop-in `wrangler.toml` snippet + `wrangler deploy` step, and (b) container path via existing `docker-deploy-starter`. Trade-offs noted.
- **`publish.yml` version-sync gate**: replaces the single `server.json` check with a 3-file parity check across `server.json`, `manifest.json`, `.claude-plugin/plugin.json` — catches drift early before publish.
- **`.claude-plugin/commands/graduate.md`**: rewritten to use the explicit "Call the `X` MCP tool with ..." pattern shared by the other four commands. Adds `seed_security_guidance` as step 5. Removes ambiguity that could have led Claude Code to treat the command as a descriptive walkthrough rather than a tool-orchestration script.
- **`.claude-plugin/commands/scaffold.md`**: quoted the `argument-hint` value to avoid strict YAML parsers tripping on `<id>` angle brackets.

### Removed
- `publish.yml`: `--provenance` flag dropped from `npm publish` and `npm publish --dry-run` steps. npm trusted publishing auto-generates and signs provenance attestations when the publish call carries an OIDC token (GA since 2025-07); the flag is redundant. `.mcpb` SLSA attestation via `attest-build-provenance` (PR #38) covers the bundle's separate path. **Followup:** Added `publishConfig.provenance: true` to `package.json` as defensive fallback if npm's auto-detection heuristic narrows in the future.

### Internal
- **Compile-time enum exhaustiveness gate** in `src/mcp-schemas.ts`: a `[Exclude<SecurityCheckName, …>] extends [never] ? true : never` assertion now fires a `tsc` error if a future `SecurityCheckName` value isn't added to `securityCheckNameValues` — closes the drift surface where `satisfies` alone was non-exhaustive.
- **Test length assertion**: `tests/audit-security.test.ts` now asserts `r.checks.length === 9` so a missing wire-in of a future check surfaces in CI immediately, plus a new test for the `optional: true` aggregator behavior.
- **Windows path correctness**: `checkClaudeSecurityGuidance` evidence paths now use `path.relative(repoPath, p)` instead of `p.replace(repoPath + "/", "")`. Same `evidence` shape on POSIX; correct on Windows where the old hardcoded `/` separator no-oped.

### Fixed
- `audit_security` detector: recognize manual gitleaks installs (curl + SHA256 pin) as present, not just the `gitleaks/gitleaks-action` Action variant.
- `audit_security` detector: no longer false-positives on `npm install` substrings inside echo/comment strings (e.g. `echo "Run 'npm install' locally"`). Matches only lines whose first meaningful token is an install command.
- `audit_security` detector: whitelist `--package-lock-only`, `--dry-run`, and `--no-install` flags — these install variants don't execute lifecycle scripts, so `--ignore-scripts` is redundant.
- `audit_security` detector: secret-scanning check now performs a live `gh api repos/<owner>/<repo>` query when available, reporting the actual enabled/disabled state instead of always returning missing.

