# Contributing to create-starter

Thanks for considering a contribution. This is a solo-maintained tool, so a few notes on what's likely to merge quickly vs. what needs discussion first.

## Quick start

```bash
git clone https://github.com/starter-series/create-starter
cd create-starter
npm ci --ignore-scripts
npm run build
npm test
```

Requires **Node.js ≥22** (see `package.json#engines`).

## What lands quickly

- Bug fixes with a regression test.
- New templates — open an issue first describing the stack and target deploy platform. New stacks land as new starters in the [starter-series org](https://github.com/starter-series), not as flags on `create_project`.
- Audit detector improvements — see `src/audit-security.ts`, `src/audit-cd.ts`, `src/audit.ts`. New detectors need a unit test in `tests/`.
- Workflow security hardening — pinning, OIDC, least privilege.
- Documentation fixes (English/Korean parity).

## What needs discussion first

- New top-level CLI flags or MCP tools — open an issue with the motivation.
- Major dependency upgrades that change behavior (e.g. `zod` major, `tar` major).
- Anything that touches the `.mcpb` bundle format (`scripts/bundle-mcpb.mjs`).
- Removing or renaming an existing CLI flag / MCP tool.

## Project conventions

- **Author:** `heznpc` is the sole author. PRs from contributors are credited via the GitHub commit attribution; we do not add `Co-Authored-By` trailers.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`). Squash-merge is the default.
- **Tests:** `node --test` with `tsx`. Each new branch in `src/` should have a test in `tests/`.
- **Lint/typecheck:** `npm run lint` (= `tsc --noEmit`). `npm run build` (= `tsc`) is what CI verifies.
- **Security:** `--ignore-scripts` on every `npm` invocation in CI. Workflow permissions are job-level least privilege. New workflows that need write scopes must justify them in the PR description.
- **Localization:** `README.md` and `README.ko.md` ship together. Korean uses formal honorifics (존댓말). `docs/graduation-from-vibe-coding.md` and `.ko.md` likewise.

## Reporting security issues

Please **do not** open public GitHub issues for security problems. See [SECURITY.md](SECURITY.md) for private channels.

## License

By submitting a contribution you agree it will be released under the [MIT License](LICENSE).
