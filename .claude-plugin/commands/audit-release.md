---
description: Diagnose release-readiness against the Starter Series quality bar — matched starter, version-vs-last-tag drift, CHANGELOG drift vs merged PRs, and publish-workflow kind. Read-only.
argument-hint: [path]
---

You are auditing whether the current repo is **release-ready**.

## Steps

1. Call the `audit_release` MCP tool with `path` set to the absolute path of the repo the user is in. If no path is given, use the MCP server's cwd.
2. Surface the structured report:
   - **Ship-ready verdict** (`ready` / `needs-attention` / `blocked`)
   - **Matched starter** (id + signals)
   - **Version** (current, source, last tag, drift)
   - **CHANGELOG** (file path, Unreleased section status, merged-PR drift)
   - **Publish workflow** (file, kind)
   - **Blockers / warnings**
3. If `blocked`, propose concrete fixes (e.g., bump version, sync CHANGELOG Unreleased with merged PRs since last tag).

## Do NOT

- Modify the repo. This tool is diagnostic; the user decides how to fix.
- Conflate with Anthropic's `/code-review` — that fixes correctness; this audits release/publish state.
