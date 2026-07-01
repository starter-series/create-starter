# Launch Proof Report

The Launch Proof Report turns create-starter's release, CD, security, and instruction-review audit primitives into one client-ready launch handoff.

It is meant for the moment when an app already runs, but the owner needs evidence that the repo can be released, published, and maintained without trusting README claims.

## What it checks

| Gate | Source command | What it proves |
| --- | --- | --- |
| Release | `starter-series audit` | Version, changelog, matched starter, and publish workflow shape are coherent enough to ship. |
| CD | `starter-series audit-cd` | Local package/app version is compared against public registries or release destinations when public read APIs exist. |
| Security | `starter-series audit-security` | Baseline CI security hygiene is present: secret scanning, dependency audit, CodeQL, pinned gitleaks, license check, Dependabot, install-script guard, and security-review workflow. |
| Instructions | `starter-series audit-instructions` | Agent instruction files are checked for exact duplicate review findings and cross-file surface overlap. Keyword risk summaries are advisory only, not exhaustive safety or semantic drift detection. |

The report deliberately does not certify legal, store-review, privacy, or security-compliance status. It is a technical launch-readiness handoff.

## Run it

```bash
npx -y starter-series proof-report /path/to/repo
```

By default the command writes:

```text
/path/to/repo/launch-proof-report.md
```

Use `--stdout` when another agent or CI step needs the Markdown directly:

```bash
npx -y starter-series proof-report /path/to/repo --stdout
```

Use `--output` to put the report in a handoff folder:

```bash
npx -y starter-series proof-report /path/to/repo --output reports/launch-proof.md
```

`--output` is resolved inside the target repo. Paths that escape the repo are rejected.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The report was generated and the overall verdict is `READY`. |
| `1` | The report was generated, but at least one proof gate is `BLOCKED` or needs attention. |
| `2` | The command could not run, for example because the path or flags were invalid. |

## Paid-service wrapper

If you turn this into a paid launch check, sell the report, not the template.

The deliverable should include:

- `launch-proof-report.md`
- the exact commit SHA audited
- the command output from `npm test` or the repo-native test command
- the generated package or store asset evidence when applicable
- a short remediation list sorted as `blocker`, `warning`, and `nice-to-have`

Do not call the product "certified" unless a real external certification process exists. The honest offer is:

> I will turn your AI-built repo into a launch-proof handoff: release gate, publish gate, security gate, instruction-review gate, and the next fixes needed before you ship.

## Relationship to shotkit

For browser extensions and other visual launches, run `shotkit` after the proof gates are passing. `shotkit` produces store and social assets; the Launch Proof Report records whether the repo is technically ready to release.
