---
description: Check publish drift across destination registries — npm, PyPI, Open VSX, VS Marketplace, AMO (Firefox), GitHub Releases — via public read APIs. Read-only, makes outbound HTTPS.
argument-hint: [path]
---

You are checking whether the local repo's declared version is **actually published** to each destination it claims.

## Steps

1. Call the `audit_cd` MCP tool with `path` set to the absolute path of the repo. If no path is given, use the MCP server's cwd.
2. Surface per-destination drift:
   - `in-sync` — local version matches the published latest
   - `needs-publish` — local is ahead of published (CI/CD did not run, or token is missing)
   - `local-stale` — published is ahead of local (someone else shipped)
   - `not-found` — package/extension name not in registry yet
   - `unsupported` — destination not auto-checkable (CWS, EAS, Railway, Fly, GHCR — explain why)
3. For each `needs-publish`, suggest the publish path (tag push, OIDC trusted publisher config, etc.) — do not push the tag yourself.

## Do NOT

- Publish, tag, or trigger any release workflow. This tool is diagnostic only.
- Treat `unsupported` destinations as failures — they require manual or auth-gated checks.
