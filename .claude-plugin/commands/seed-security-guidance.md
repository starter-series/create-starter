---
description: Generate a starter claude-security-guidance.md at the repo root tailored to the detected Starter Series template. Anthropic's Claude Code Security Guidance Plugin (released 2026-05-26) reads this file as an in-session guard.
argument-hint: "[path] [--force]"
---

You are seeding a starter `claude-security-guidance.md` so Anthropic's Claude Code Security Guidance Plugin can use it as an in-session guard while writing code.

## Steps

1. Call the `seed_security_guidance` MCP tool with `path` set to the absolute path of the repo. If no path is given, use the MCP server's cwd. Pass `force: true` only when the user explicitly asks to overwrite an existing file.

2. Surface the report:
   - **status** — `created` (new file), `exists` (file present, no change), or `overwritten` (file was replaced because `force: true`).
   - **matched starter** — which Starter Series template informed the starter-specific section. `null` means the generic fallback section was used.
   - **relative path** — where the file landed (always `claude-security-guidance.md` at repo root for now).

3. If `status === "exists"`, tell the user the file is already in place; offer to re-run with `--force` only if they want the latest template.

4. If `status === "created" | "overwritten"`, suggest:
   - Read the generated file and edit any org-specific rules in the marked sections.
   - Commit via `git add claude-security-guidance.md && git commit -m "chore(security): seed claude-security-guidance.md"`.
   - Re-run `audit_security` to confirm the `claude-security-guidance` check flips to PRESENT.

## Positioning

This complements (does not replace):
- **`claude-code-security-review` GitHub Action** — runs on every PR, AI review of diffs.
- **`audit_security` MCP tool** — detects this file's presence as the 9th check.

The three together: in-session guard (this), post-PR review (`claude-code-security-review`), repo-level static audit (`audit_security`).

## Do NOT

- Pass `force: true` without explicit user confirmation — it overwrites any hand-edited rules.
- Edit the file's content yourself from this command. Generate it via the MCP tool, then let the user edit.
