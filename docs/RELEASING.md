# Releasing create-starter

This package (`starter-series`) publishes to npm from CI via a GitHub
OIDC **trusted publisher** — no long-lived `NPM_TOKEN`. The CD workflow exchanges
a short-lived OIDC token for publish rights at release time and uploads with
provenance (`package.json#publishConfig.provenance`).

**Languages**: English (this file)

---

## First publish

Before the first OIDC-backed release, register the trusted publisher once on
npmjs.com: open the package page → **Settings → Trusted Publisher** and add the
GitHub Actions workflow that runs `npm publish` (the repository, workflow
filename, and — if used — environment must match exactly). No token is stored in
the repo or in GitHub secrets.

## After 2026-05-20: select an allowed action

npm trusted-publisher configurations created on or after **2026-05-20** must
explicitly select at least one allowed action. When you add the trusted
publisher on npmjs.com (package → **Settings → Trusted Publisher**), set
**Allowed actions** to include **`npm publish`**. Configurations created
before that date were auto-granted publish and are unaffected.

Without this, the OIDC `npm publish` step in CD is rejected at release time
with an authorization error.
