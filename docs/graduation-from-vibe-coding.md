# Graduating from Lovable, Bolt, and v0 to production

> You built a working app in a vibe-coding platform. Now you want the option to deploy *anywhere* — your own VPS, multiple stores, multiple registries — instead of being limited to one platform's defaults. This guide walks you through that handoff using `create-starter`.
>
> This isn't about "escaping" any platform. As of 2026-05, Vercel, Cloudflare, and Netlify are all evolving into "Agentic Infrastructure" providers — each excellent for the workloads they target. Graduation just gives you **vendor diversity**: the freedom to pick a different target per app without rewriting your CI/CD every time.

**Languages**: English (this file) · [한국어](graduation-from-vibe-coding.ko.md)

---

## When this guide applies

This guide is for you if:

- ✅ Your app would benefit from a **different deploy target** (your own VPS, GHCR, Cloudflare Workers/Pages, App Store, Chrome Web Store, npm, PyPI…) than your current platform's default
- ✅ You want **GitHub Actions logs** for CI/CD steps the platform hides
- ✅ You want to **stop paying token costs** for repeated build cycles
- ✅ You want **CI-side supply-chain security gates** (gitleaks, CodeQL, OIDC publish, supply-chain attestations) before code reaches production
- ✅ Your code is **already in GitHub** (Lovable's sync, Bolt's export, v0's git panel)

It is **not** for you if:

- ❌ You're happy with the platform's auto-deploy and don't need GitHub Actions
- ❌ Your app fits exactly one platform's stack (e.g., Next.js on Vercel) and you have no other reason to add complexity

---

## The graduation path

Five steps. Each runs in your terminal. None of them require leaving your existing AI session — every CLI command is also exposed as an MCP tool, so you can ask Claude Code to run them for you.

```
1. Diagnose       → audit, audit-cd, audit-security
2. Pick a target  → docker-deploy / cloudflare-pages / npm-package / …
3. Lift CI/CD     → copy .github/workflows from the matching starter
4. Wire secrets   → repo secrets via gh secret set
5. Verify         → re-run audit; tag a release
```

---

## Step 1 — Diagnose

Clone your platform's GitHub repo locally and run the three audit primitives.

```bash
git clone https://github.com/<you>/<your-app>.git
cd <your-app>
npx -y @starter-series/create audit
npx -y @starter-series/create audit-cd
npx -y @starter-series/create audit-security
```

You'll get three reports:

- **audit** — closest matching Starter Series template, CHANGELOG drift vs merged PRs, version-bump status, publish-workflow kind. Most vibe-coded apps start with `Matched starter: (none)` and `Publish workflow: missing` — that's expected.
- **audit-cd** — current state of each destination registry. Will report `not-found` for npm/PyPI/Open VSX/AMO/GitHub Releases until you publish.
- **audit-security** — `SOFT` is typical at this stage. The recommendations under each MISSING/PARTIAL row tell you exactly what to add.

> **Tip**: Inside Claude Code, just ask: *"audit this repo with starter-series"*. The MCP tools run automatically.

---

## Step 2 — Pick a target

Each vibe-coding platform has a sensible default (Lovable → Netlify/Vercel, Bolt → Netlify, v0 → Vercel). Graduation gives you the **option** to ship to a different target when one of your apps would be a better fit elsewhere. Pick the matching starter:

| Your app | Recommended target | Starter |
|----------|-------------------|---------|
| Next.js / Vite / React app on **your own VPS** | Docker + GHCR + SSH | [`docker-deploy`](https://github.com/starter-series/docker-deploy-starter) |
| **Static site** (HTML/CSS + light JS) | Cloudflare Pages | [`cloudflare-pages`](https://github.com/starter-series/cloudflare-pages-starter) |
| **Claude / voice agent** (server-side runtime) | Cloudflare Workers + Claude Managed Agents | [`docker-deploy`](https://github.com/starter-series/docker-deploy-starter) (adapter) — see note below |
| **Browser extension** (already MV3) | CWS + AMO | [`browser-extension`](https://github.com/starter-series/browser-extension-starter) |
| **Cross-platform desktop app** | electron-builder + code signing | [`electron-app`](https://github.com/starter-series/electron-app-starter) |
| **Mobile app** | Expo + EAS | [`react-native`](https://github.com/starter-series/react-native-starter) |
| **Discord/Telegram bot** | Docker + Railway/Fly | [`discord-bot`](https://github.com/starter-series/discord-bot-starter) / [`telegram-bot`](https://github.com/starter-series/telegram-bot-starter) |
| **Reusable library** | npm OIDC trusted publishing | [`npm-package`](https://github.com/starter-series/npm-package-starter) |
| **Python tool / agent** | PyPI OIDC trusted publishing | [`python-mcp-server`](https://github.com/starter-series/python-mcp-server-starter) |

> **Claude / voice agent on Cloudflare Workers (added 2026-05)** — Anthropic and Cloudflare announced Claude Managed Agents on Cloudflare Workers (2026-05-19); the `@cloudflare/voice` SDK shipped a week later (2026-05-26). For now the path is: build with `docker-deploy` (containerized) or hand-write a Wrangler config; a dedicated `cloudflare-workers-agent` starter is on the roadmap once the Managed Agents API stabilizes.

**Most common path**: vibe-coded React/Next/Vite SPA → `docker-deploy` (any VPS you own) or `cloudflare-pages` (free, unlimited bandwidth).

---

## Step 3 — Lift CI/CD

You **don't** need to scaffold a fresh project and copy your code over. Instead, lift the `.github/workflows/` directory and supporting files from the matching starter into your existing repo.

### Option A — Manual lift (recommended for first time)

```bash
# Pick a target, e.g. docker-deploy
TARGET=docker-deploy

# Grab just the CI infrastructure
git clone --depth=1 https://github.com/starter-series/${TARGET}-starter.git /tmp/starter
cp -r /tmp/starter/.github .
cp /tmp/starter/Dockerfile* .          # if applicable
cp /tmp/starter/.gitleaks.toml . 2>/dev/null || true
cp /tmp/starter/.dockerignore . 2>/dev/null || true
cp /tmp/starter/CHANGELOG.md .         # adopts the same release notes format

# Open the workflow files and replace placeholder repo names
# Look for YOUR_USERNAME, YOUR_REGISTRY, etc.
```

### Option B — Scaffold into a sibling and diff

```bash
# Scaffold a fresh sibling
npx -y @starter-series/create my-fresh --template ${TARGET}

# Compare files, copy what you want
diff -r my-fresh/.github .github
```

### Option C — From inside Claude Code

> *"Add the docker-deploy starter's `.github/workflows/` and Dockerfile to this repo. Don't touch my app code. Update placeholder owner/repo references to match the current remote."*

The agent will fetch the files via the MCP tools and report what changed.

---

## Step 4 — Wire secrets

Every deploy target needs its own secret set. Common ones:

| Target | Required secrets | OIDC available? |
|--------|------------------|-----------------|
| docker-deploy | `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY` | No |
| npm-package | `NPM_TOKEN` (or **none** with OIDC trusted publishing) | ✅ Yes, set up at npmjs.com |
| python-mcp-server | (none with OIDC) | ✅ Yes, set up at PyPI |
| browser-extension | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | No |
| vscode-extension | `VSCE_PAT`, `OVSX_PAT` | No |
| electron-app | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, signing cert + password | No |
| react-native | `EXPO_TOKEN` | No |
| cloudflare-pages | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | No |

```bash
# Example: set npm OIDC-free secrets
gh secret set DEPLOY_SSH_HOST -b "your.vps.example.com"
gh secret set DEPLOY_SSH_USER -b "deploy"
gh secret set DEPLOY_SSH_KEY < ~/.ssh/deploy_id_ed25519

# For OIDC-enabled targets (npm, PyPI), NO secrets needed — just set up
# the publisher on the registry side. See each starter's README for the link.
```

---

## Step 5 — Verify

Re-run the audit primitives. Targets should now look like this:

```
audit          → Ship-ready: ATTENTION (only CHANGELOG drift remaining, expected)
audit-security → Overall: HARDENED (8/8 present) or NEEDS-ATTENTION (1-2 missing)
audit-cd       → All destinations report not-found (because nothing's been published yet)
```

Now ship your first release:

```bash
# Update CHANGELOG.md Unreleased section with your initial entries
git add . && git commit -m "chore: lift CI/CD from starter-series/${TARGET}-starter"
git push origin main

# Tag a release — most starters trigger publish on tag push
git tag v0.1.0
git push --tags
```

Watch the workflow run, then re-run `audit-cd`:

```bash
npx -y @starter-series/create audit-cd
# → npm/Open VSX/AMO/GH Releases now report in-sync
```

If something fails on the first run, the CI logs will tell you exactly which secret or config is wrong. The starters are designed so the error messages are actionable, not opaque platform errors.

---

## Common gotchas

### Lovable export uses `@vercel/analytics`
Search for `@vercel/analytics` in your code and either remove it (and the corresponding tag in `app.tsx`/`layout.tsx`) or wire it to a non-Vercel analytics provider (Plausible, Umami self-hosted).

### Bolt export has WebContainer-specific imports
WebContainer is Bolt's browser sandbox. Any `import * from '@webcontainer/api'` won't run outside Bolt. Replace with native Node equivalents (`fs/promises`, `child_process`) or remove if it was just for in-browser preview.

### v0 export hardcodes Vercel paths
v0 generates `app/api/*` routes that assume Vercel's edge runtime. If you're moving to docker-deploy, change `export const runtime = 'edge'` to `'nodejs'` and verify your DB driver works in Node (most do).

### Supabase backend is fine
All three platforms commonly pair with Supabase. Supabase has no platform lock-in — your existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` work from any deploy target. Just move them from platform env vars to repo secrets.

### .env files in the export
Vibe platforms sometimes commit `.env.local` to GitHub. The first time gitleaks runs in CI, it'll flag this. Rotate the leaked keys (don't just rebase), then add `.env*` to `.gitignore` and remove from history via `git filter-repo --path .env.local --invert-paths`.

---

## What the graduation gives you

After completing all five steps, you have:

| Capability | Vibe platform | After graduation |
|-----------|---------------|------------------|
| Deploy target | Platform-locked | **Anywhere** (VPS, Cloudflare, npm, app stores) |
| CI logs | Hidden | **GitHub Actions** with full step-level visibility |
| Secret scanning | Limited | **gitleaks + GitHub native secret scanning** on every push |
| Static analysis | None | **CodeQL** on every PR |
| AI security review | None | **`anthropics/claude-code-security-review`** on every PR |
| Publish auth | Platform owns | **OIDC trusted publishing** (no long-lived tokens) |
| Release notes | Manual | Auto-generated from PR titles + CHANGELOG |
| Rollback | Platform UI | `git revert` + re-tag |
| Cost | Platform token billing | **Free CI minutes** for public repos, ~$0.30/hr private |

---

## Next steps

- **Stuck on a specific platform?** Open an issue: [starter-series/create-starter/issues](https://github.com/starter-series/create-starter/issues/new). Include the export source (Lovable/Bolt/v0) and which step blocked you.
- **Want the AI to drive the whole thing?** Install `create-starter` as a Claude Code plugin: `/plugin marketplace add starter-series/create-starter && /plugin install create-starter@starter-series`. Then say *"graduate this Lovable export to docker-deploy"* and the agent handles steps 1–4.
- **More starters?** See the [full list](https://github.com/starter-series). If your case isn't covered, the `docker-deploy` starter is language- and framework-agnostic — it's the universal escape hatch.
