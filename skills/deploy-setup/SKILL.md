---
name: deploy-setup
description: Wire up a freshly scaffolded Starter Series project for its first release — detect the template, register required GitHub secrets, set up OIDC trusted publishing where applicable, and trigger the first CD run. Pairs with the `create` skill (you scaffold first, then run this).
---

You are walking a developer through the **first deploy** of a Starter Series project. The project has been scaffolded (via `create-starter` skill / CLI / MCP) and is on disk; this skill takes it from "scaffolded" to "first release published."

## Prerequisites

- The project is already scaffolded and on disk. Verify by checking for `.github/workflows/cd*.yml` and `package.json` / `pyproject.toml` / `Dockerfile`.
- `gh` CLI is installed and authenticated (`gh auth status`). If not, instruct the user.
- A GitHub repository exists for the project. If not, offer `gh repo create`.

## Workflow

### Step 1: Detect the template

Read these files to identify which starter the project came from:

| Signal | Template |
|---|---|
| `package.json#mcpName` starts with `io.github.` and `package.json#main` exists, no `electron` dep | `mcp-server` (Node MCP) |
| `pyproject.toml` references `mcp` package | `mcp-server-python` |
| `package.json#dependencies.discord.js` | `discord-bot` |
| `package.json#dependencies.grammy` | `telegram-bot` |
| `manifest.json#manifest_version === 3` | `browser-extension` |
| `package.json#engines.vscode` | `vscode-extension` |
| `package.json#dependencies.electron` (or `devDependencies.electron`) | `electron-app` |
| `package.json#dependencies.expo` | `react-native` |
| `wrangler.toml` exists | `cloudflare-pages` |
| `Dockerfile` at root + no `package.json` | `docker-deploy` |
| `package.json#publishConfig.access === "public"` and no other signal | `npm-package` |

Report the detected template name to the user.

### Step 2: Inspect the CD workflow

Read `.github/workflows/cd.yml` (or `cd-android.yml` + `cd-ios.yml` for react-native, or `cd-firefox.yml` for browser-extension). Extract:

- The list of `secrets.X` referenced in `with:` / `env:` / `if:` blocks. These are the secrets that must be set.
- Whether the workflow uses **OIDC trusted publishing** (look for `id-token: write` in `permissions:` and `npm publish --provenance` / `pypa/gh-action-pypi-publish` in steps). If yes, the publish step needs no token secret — only registry-side configuration (web UI). If no, a token secret is required.

### Step 3: Required secrets matrix (per template)

If the user wants verbatim guidance, use this table:

| Template | Required GitHub secrets | Registry-side setup |
|---|---|---|
| `mcp-server` | (none — OIDC via npm) | npm: enable trusted publisher for the package |
| `npm-package` | (none — OIDC via npm) | npm: enable trusted publisher |
| `mcp-server-python` | (none — OIDC via PyPI) | PyPI: register trusted publisher under https://pypi.org/manage/account/publishing/ |
| `vscode-extension` | `VSCE_PAT` (required), `OVSX_PAT` (optional) | Azure DevOps: create PAT with Marketplace > Manage scope |
| `browser-extension` | `CHROME_REFRESH_TOKEN`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_EXTENSION_ID`, `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | CWS: OAuth client. AMO: API key |
| `electron-app` | `GH_TOKEN` (or use `GITHUB_TOKEN`); platform code-signing certs (optional) | None for first run; signing certs for release |
| `react-native` | `EXPO_TOKEN`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `ASC_API_KEY_*`, `ANDROID_KEYSTORE_BASE64`, etc. | Expo: account; App Store Connect API key; Play Console service account |
| `cloudflare-pages` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Cloudflare: API token with Pages:Edit |
| `discord-bot` | `RAILWAY_TOKEN` + `RAILWAY_SERVICE_ID` (Railway path) **or** `FLY_API_TOKEN` (Fly path) | Railway: project + service; Fly: app create |
| `telegram-bot` | Same as discord-bot | Same |
| `docker-deploy` | `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `APP_PORT` (optional) | VPS reachable; `~/.env.app` exists on host |

### Step 4: Diff against existing secrets

Run `gh secret list -R <owner>/<repo>` to see what's already set. Subtract from the required list. For each missing secret, ask the user:

> "I need a value for `VSCE_PAT`. This is a Personal Access Token with `Marketplace > Manage` scope from https://dev.azure.com/_usersSettings/tokens. Paste the token (it will be masked):"

Then run `gh secret set VSCE_PAT --body "$value" -R <owner>/<repo>`.

**Never** echo the value to the conversation, **never** write it to disk, **never** include it in `git commit` messages.

### Step 5: OIDC trusted publishing setup (where applicable)

For `mcp-server`, `npm-package`, `create-starter`, `mcp-server-python`:

The CD workflow requires **registry-side** trusted publisher registration before the first publish. Provide the user with:

- **npm**: link to https://www.npmjs.com/settings/<their-org-or-user>/packages → select package → Trusted Publishers → "Add GitHub Actions" with the repo + workflow filename. Tell them: "Your npm account must have 2FA on writes enabled for trusted publishing to be available."
- **PyPI**: link to https://pypi.org/manage/account/publishing/ → "Add a new pending publisher" with the GitHub org, repo name, workflow filename, and (optionally) environment name.

These steps cannot be automated via `gh` — they're registry-side web UI. Provide the URL and exact field values.

### Step 6: Trigger the first deploy

Once secrets are in place and OIDC is registered:

```bash
# Bump version first (some templates require this; check cd.yml's version-guard step)
npm run version:patch  # or version:minor, or version:major

# Commit + push the version bump
git commit -am "chore: bump version for first release"
git push

# Trigger the CD workflow
gh workflow run cd.yml -R <owner>/<repo>

# Watch the run
gh run watch -R <owner>/<repo>
```

For tag-triggered repos (docker-deploy uses `push: tags: v*`), instead:

```bash
git tag v0.1.0
git push origin v0.1.0
```

### Step 7: Verify the release

After the run finishes:

```bash
gh release view -R <owner>/<repo>
```

For npm: `npm view <package-name>` shows the published version.
For PyPI: `pip index versions <package-name>` (or visit pypi.org/p/<name>).
For Marketplace: visit https://marketplace.visualstudio.com/items?itemName=<publisher>.<name>.
For GHCR: `docker pull ghcr.io/<owner>/<repo>:<version>`.

## Dry-run mode

If the user asks for a dry run, do everything **except** `gh secret set` and `gh workflow run`. Print the would-be commands and the secret names you'd request. Useful for review before committing to a deploy.

## Output format

Walk the user through one numbered step at a time. After each interactive prompt, summarize what got set / what's pending. End with a "Next: trigger `cd.yml`" once secrets and OIDC are in place.

## Edge cases

- **Repo not yet created**: offer `gh repo create <name> --public --source=. --push` and re-detect after.
- **Multiple cd workflows** (react-native, browser-extension): detect both, run their secret matrices in sequence.
- **GH_TOKEN already a default**: GitHub Actions provides `secrets.GITHUB_TOKEN` automatically with read+write to the same repo. Don't ask the user to set it.
- **Existing failed run**: if there's a failed run on `cd.yml`, surface the failure with `gh run view <id> --log-failed | head -50` so we don't blindly retrigger.
- **User aborts mid-flow**: do not auto-retry. Save progress in a one-line `.deploy-setup.checkpoint` file at repo root listing which secrets/OIDC steps are done, and resume from there next invocation. (Optional — only if user asks.)

## Safety rails

- **Never** put a token value in a chat message you produce. Always pipe to `gh secret set --body "$VALUE"`.
- **Never** modify CD workflows during this skill — it's setup, not editing. If a workflow looks wrong, surface it but ask the user before touching.
- **Never** publish without the user explicitly confirming "yes, run cd.yml now."
- For first npm/PyPI publishes, recommend the user manually trigger once with workflow_dispatch (auditable) before any tag-based automation.
