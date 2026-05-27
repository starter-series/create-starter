# Security Policy

## Supported versions

The latest published `0.x` minor on npm receives security fixes. Earlier minors do not. `create-starter` is pre-1.0; minor bumps may include breaking changes alongside fixes.

| Version | Supported |
|---|---|
| `0.4.x` | ✅ Latest |
| `< 0.4` | ❌ |

## Reporting a vulnerability

**Please do not file public GitHub issues for security problems.** Use one of the private channels below.

- **GitHub private advisory** (preferred) — open a draft at <https://github.com/starter-series/create-starter/security/advisories/new>. This routes directly to the maintainer and triggers GHSA workflows.
- **Email** — `wantcongz@gmail.com` with subject `[create-starter security] <short description>`.

Please include:

- The affected version (or commit SHA).
- A minimal reproduction or proof-of-concept.
- Your assessment of impact (e.g. RCE, path traversal, SSRF, supply-chain).
- Whether you intend to publish your own write-up; coordinated disclosure timelines are negotiable.

## Response expectations

- **Acknowledgement** within 72 hours.
- **Triage + initial assessment** within 7 days.
- **Fix or mitigation** within 30 days for High/Critical severity; 90 days for Moderate/Low.
- **Public advisory** published via GHSA once a fix is available, with credit to the reporter unless they prefer anonymity.

## Scope

In scope:

- The `@starter-series/create` npm package (CLI + MCP server).
- The `.mcpb` Claude Desktop bundle.
- The `create-starter` Claude Code plugin and bundled `create` skill.
- The `audit_release` / `audit_cd` / `audit_security` MCP tools.
- The GitHub Actions workflows in `.github/workflows/`.

Out of scope:

- Downstream projects scaffolded from a template — those are independent repos; report vulnerabilities to the respective template repo.
- Issues in third-party MCP clients (Claude Desktop, Cursor, Windsurf) — report to the client vendor.
- Vulnerabilities that require already-compromised credentials or full filesystem access (these are post-exploit conditions).

## Hardening posture

This repo passes its own `audit_security` 8/8 HARDENED — gitleaks (SHA-pinned), CodeQL (advanced workflow), `npm audit`, license check, `--ignore-scripts` on every install, Dependabot grouped updates, native GitHub secret-scanning + push protection, and the `anthropics/claude-code-security-review` Action (SHA-pinned).
