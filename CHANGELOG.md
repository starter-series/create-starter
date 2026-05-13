# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is **append-only**. Each release on
[GitHub Releases](https://github.com/starter-series/create-starter/releases) is the
authoritative source — `.github/workflows/update-changelog.yml` prepends a
new entry here when a release is published, so the file mirrors the
release feed without duplicating maintenance.

## [Unreleased]

### Added
- `audit_release` — diagnose release-readiness against the Starter Series quality bar. Detects matched starter, version vs last tag drift, CHANGELOG drift vs merged PRs (`git log <tag>..HEAD`), and publish-workflow kind (release-please / publish-on-tag / auto-release). Available as MCP tool (`audit_release`) and CLI (`create-starter audit [path]`).
- `audit_cd` — check whether the local version has been published to its destination registries. Probes npm, PyPI, Open VSX, VS Marketplace, AMO (Firefox), and GitHub Releases via public APIs. Reports per-destination drift (in-sync / needs-publish / local-stale / not-found / unsupported). Available as MCP tool (`audit_cd`) and CLI (`create-starter audit-cd [path]`). CWS, EAS, Railway, Fly, and GHCR are not yet supported (no public read API or auth required).
- `audit_security` — verify baseline CI security hygiene against the Starter Series bar: gitleaks (with pin check), CodeQL, dependency audit, license check, `--ignore-scripts` on every install, Dependabot grouped updates, secret-scanning hint, and the `anthropics/claude-code-security-review` Action. Available as MCP tool (`audit_security`) and CLI (`create-starter audit-security [path]`).
- Self-hardening: `create-starter` repo now passes its own `audit_security` (HARDENED, 8/8 present). Added `.github/workflows/codeql.yml` and `.github/workflows/claude-security-review.yml` (gated on `CLAUDE_API_KEY` secret presence; pinned to commit SHA, Dependabot-tracked). Native GitHub secret-scanning + push-protection + Dependabot security updates enabled on the repo settings.
- `docs/graduation-from-vibe-coding.md` (+ Korean translation) — five-step path for graduating Lovable/Bolt/v0 exports to GitHub Actions + non-platform deploy targets. Uses the three audit primitives to diagnose and CI/CD lift from the matching starter without rewriting app code. Linked from both READMEs.

### Fixed
- `audit_security` detector: recognize manual gitleaks installs (curl + SHA256 pin) as present, not just the `gitleaks/gitleaks-action` Action variant.
- `audit_security` detector: no longer false-positives on `npm install` substrings inside echo/comment strings (e.g. `echo "Run 'npm install' locally"`). Matches only lines whose first meaningful token is an install command.
- `audit_security` detector: whitelist `--package-lock-only`, `--dry-run`, and `--no-install` flags — these install variants don't execute lifecycle scripts, so `--ignore-scripts` is redundant.
- `audit_security` detector: secret-scanning check now performs a live `gh api repos/<owner>/<repo>` query when available, reporting the actual enabled/disabled state instead of always returning missing.

