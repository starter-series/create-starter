---
description: Check baseline CI security hygiene against the Starter Series bar — gitleaks, CodeQL, dep audit, license check, --ignore-scripts, Dependabot grouped, secret-scanning, claude-code-security-review, claude-security-guidance. Read-only, complementary to Anthropic's in-session security guidance plugin.
argument-hint: [path]
---

You are auditing the repo's **supply chain + CI security hygiene** as a complement to Anthropic's in-session `claude-security-guidance` plugin (in-session guard) and `claude-code-security-review` Action (post-PR review).

## Steps

1. Call the `audit_security` MCP tool with `path` set to the absolute path of the repo. If no path is given, use the MCP server's cwd.
2. Surface the verdict (`hardened` / `needs-attention` / `soft`) and the table of checks:
   - present / partial / missing / not-applicable
   - Evidence (workflow files, config presence, gh-api result)
   - Recommendation (for non-present items)
3. For each `missing` or `partial`, propose the concrete add (workflow snippet, repo setting via `gh api`).

## Positioning

- **In-session guard** (Anthropic `claude-security-guidance` plugin, released 2026-05-26): catches vulnerabilities as code is written.
- **Post-PR AI review** (`anthropics/claude-code-security-review` Action): reviews diffs on PR.
- **Repo-level audit** (`audit_security`, this tool): verifies the static CI baseline is present and pinned.

These three are **complementary**. Recommend installing all three when missing.

## Do NOT

- Modify the repo or repo settings. Suggest the `gh api` PATCH commands; let the user run them.
