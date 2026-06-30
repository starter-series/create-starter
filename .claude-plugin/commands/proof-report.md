---
description: Generate a Launch Proof Report for an existing repo by combining release, publish, and security audit evidence.
argument-hint: "[path] [--write]"
---

You are generating a **Launch Proof Report** for an existing repo.

## Steps

1. Call the `generate_launch_proof_report` MCP tool with:
   - `path`: the absolute path of the repo to check. If no path is given, use the MCP server's cwd.
   - `write`: `true` only when the user wants `launch-proof-report.md` written to disk; otherwise leave it false and return the Markdown.
   - `output_path`: optional. Use only when the user asked for a specific file path.

2. Surface the structured verdict first:
   - **overall** — `ready`, `attention`, or `blocked`
   - **gates** — release, CD, security
   - **blockers** — fixes required before launch
   - **warnings** — human-review items

3. If the report is not `ready`, propose the next command:
   - release issue -> `/audit-release`
   - publish drift -> `/audit-cd`
   - security posture -> `/audit-security`
   - missing CI/CD files -> `/add-component`

4. If the user is packaging this as a client handoff, recommend writing the report and committing it with the exact audited commit SHA noted in the surrounding message.

## Do NOT

- Call the result "certified" or imply legal/store/security certification.
- Modify app code.
- Trigger publish, tag, deploy, or release workflows.
