---
description: Lift a starter's CI/CD layer (ci / security / dependabot / maintenance) into an existing repo without re-scaffolding — dry-run plan first, then apply.
argument-hint: [path] [component-group]
---

You are helping the user add Starter Series CI/CD components to an **existing**
repo — the remediation step after an audit found gaps.

## Steps

1. **Plan (dry-run)** — call the `add_component` MCP tool with:
   - `path`: the absolute path of the user's repo
   - `component`: `ci`, `security`, `dependabot`, `maintenance`, or `all`
     (default `all`; if the user came from an `audit_security` finding, pick
     the group that covers it)
   - `starter`: omit to auto-detect; pass an explicit template id if detection
     warns about low confidence or the user disagrees
   - leave `dry_run` unset (defaults to true — nothing is written)

2. **Review the plan with the user** — per file: `create` (new), `identical`
   (already matches), `skip-exists` (exists but differs — show the diff with
   `git diff --no-index` if the user wants to see it before overwriting).

3. **Apply** — once the user approves, call `add_component` again with
   `dry_run: false`. If files were reported `skip-exists` and the user wants
   the starter's version, re-run with `force: true` — only after they've seen
   what they'd lose. The tool refuses a dirty git tree unless forced, so have
   them commit/stash first.

4. **Wire what needs hands** — CD workflows are deliberately NOT lifted (they
   need per-repo secrets). If the user wants deploys, hand off to the
   `deploy-setup` skill next.

## Do NOT

- Force-overwrite without showing the user what differs first.
- Lift onto a dirty tree by default — a clean tree keeps the change reviewable
  and revertable with one `git checkout`.
- Touch application code; this command is for the `.github/` pipeline layer
  plus `SECURITY.md` only.
