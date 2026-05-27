---
description: Graduate a Lovable / Bolt / v0 export to GitHub Actions + a non-platform deploy target via the Starter Series 5-step path (diagnose → pick target → lift CI/CD → wire secrets → verify).
argument-hint: [path-to-export]
---

You are walking the user through the **vibe-coding-to-production graduation** path documented in `docs/graduation-from-vibe-coding.md`.

## Steps

1. **Diagnose** — Run `audit_release`, `audit_cd`, `audit_security` on the export repo. Surface gaps.
2. **Pick a target** — Map the app shape to a Starter Series template:
   - Next.js / Vite / React → `docker-deploy` (own VPS) or `cloudflare-pages` (static)
   - Browser extension → `browser-extension` starter
   - Discord/Telegram bot → matching bot starter
   - Cross-platform desktop → `electron-app`
   - Mobile → `react-native`
   - Reusable library → `npm-package` or `python-mcp-server`
3. **Lift CI/CD** — Copy `.github/workflows/` + Dockerfile (if applicable) + `.gitleaks.toml` from the matching starter. Replace placeholder owner/repo references with the user's current remote.
4. **Wire secrets** — Run the per-target secret list from the guide. Prefer OIDC trusted publishing (npm, PyPI) where supported — zero long-lived tokens.
5. **Verify** — Re-run all three `audit_*` tools. Suggest the tag/push that triggers publish.

## Positioning (2026-05 framing)

This is about **vendor diversity**, not "escaping" any platform. Vercel/Cloudflare/etc. have all evolved into "Agentic Infrastructure" providers — graduation gives the user a choice of multiple deploy targets, not a flight from one.

## Do NOT

- Tag a release or trigger publish on the user's behalf. This is destructive (npm publish is hard to undo).
- Rewrite the user's app code. Only touch `.github/`, config files, and CI scripts.
