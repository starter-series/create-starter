---
description: Graduate a Lovable / Bolt / v0 export to GitHub Actions + a non-platform deploy target via the Starter Series 5-step path. Orchestrates the three audit MCP tools and surfaces lift-in steps for the matching starter.
argument-hint: [path-to-export]
---

You are walking the user through the **vibe-coding-to-production graduation** path documented in `docs/graduation-from-vibe-coding.md`. The path is workflow-only — there is **no `graduate` MCP tool**; instead, this command orchestrates `audit_release`, `audit_cd`, and `audit_security`, then guides the lift-in and verify steps.

## Steps

1. **Diagnose** — Call all three MCP tools, in this order:
   - Call the `audit_release` MCP tool with `path` set to the absolute path of the export repo.
   - Call the `audit_cd` MCP tool with the same `path`.
   - Call the `audit_security` MCP tool with the same `path`.

   Surface gaps from each report. The matched starter id from `audit_release` determines the target in step 2.

2. **Pick a target** — Map the matched starter (or app shape if `audit_release` returned `id: null`) to a Starter Series template:
   - Next.js / Vite / React → `docker-deploy` (own VPS) or `cloudflare-pages` (static)
   - Browser extension → `browser-extension` starter
   - Discord/Telegram bot → matching bot starter
   - Cross-platform desktop → `electron-app`
   - Mobile → `react-native`
   - Reusable library → `npm-package` or `python-mcp-server`

3. **Lift CI/CD** — Copy `.github/workflows/` + Dockerfile (if applicable) + `.gitleaks.toml` from the matching starter. Replace placeholder owner/repo references with the user's current remote.

4. **Wire secrets** — Run the per-target secret list from the guide. Prefer OIDC trusted publishing (npm, PyPI) where supported — zero long-lived tokens.

5. **Seed security guidance** — Call the `seed_security_guidance` MCP tool with the same `path` to generate a starter `claude-security-guidance.md` tailored to the matched starter type.

6. **Verify** — Re-call `audit_release`, `audit_cd`, `audit_security` on the now-graduated repo. Suggest the tag/push that triggers publish (do not push the tag yourself — npm publish is hard to undo).

## Positioning (2026-05 framing)

This is about **vendor diversity**, not "escaping" any platform. Vercel/Cloudflare/etc. have all evolved into "Agentic Infrastructure" providers — graduation gives the user a choice of multiple deploy targets, not a flight from one.

## Do NOT

- Tag a release or trigger publish on the user's behalf. This is destructive (npm publish is hard to undo).
- Rewrite the user's app code. Only touch `.github/`, config files, CI scripts, and `claude-security-guidance.md`.
