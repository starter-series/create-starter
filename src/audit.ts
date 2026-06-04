import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { safeReadText, semverCompare, tryGit } from "./audit-helpers.js";
import {
  type StarterConfidence,
  type StarterId,
  extractStarterSignals,
} from "./starter-detect.js";

export type { StarterId } from "./starter-detect.js";
export type ConfidenceLevel = StarterConfidence;
export type ShipVerdict = "yes" | "no" | "needs-attention";
export type WorkflowKind =
  | "release-please"
  | "auto-release"
  | "publish-on-tag"
  | "publish-manual"
  | "unknown"
  | "missing";

export interface MatchedStarter {
  id: StarterId | null;
  confidence: ConfidenceLevel;
  signals: string[];
}

export interface ChangelogReport {
  file: string | null;
  unreleasedSection: boolean;
  unreleasedEntries: number;
  unreleasedPrs: number[];
  /** All substantive (non-merge) commits since the last tag. */
  commitsSinceLastTag: number;
  mergedPrsSinceLastTag: { number: number; title: string }[];
  missingFromChangelog: { number: number; title: string }[];
}

export interface VersionReport {
  current: string | null;
  source: "package.json" | "pyproject.toml" | "manifest.json" | null;
  lastTag: string | null;
  drift: "current==tag" | "current>tag" | "current<tag" | "no-tag" | "unknown";
}

export interface PublishWorkflowReport {
  files: string[];
  likelyKind: WorkflowKind;
}

export interface ShipReady {
  verdict: ShipVerdict;
  blockers: string[];
  warnings: string[];
}

export interface AuditReport {
  repoPath: string;
  matchedStarter: MatchedStarter;
  changelog: ChangelogReport;
  version: VersionReport;
  publishWorkflow: PublishWorkflowReport;
  shipReady: ShipReady;
}

export interface AuditOptions {
  /** Defaults to process.cwd() when omitted. */
  repoPath?: string;
}

// ---- changelog parsing ----

// Issue-closing keywords. A `#N` immediately preceded by one of these refers to
// an *issue* being closed, not a PR number, so it must NOT be harvested as a PR
// reference (it would inflate the Unreleased PR set / merged-PR set with issue
// numbers). GitHub recognizes these (and -s/-d/-ed variants) for auto-close.
const ISSUE_CLOSE_RE =
  /\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#\d/i;

/**
 * Harvest the PR-reference numbers from one line of text, *excluding* `#N`
 * tokens that are issue-close references ("Fixes #12", "Closes #9"). Used for
 * both the CHANGELOG Unreleased scan and the git-log PR scan so the two sets
 * are apples-to-apples.
 */
function harvestPrRefs(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(/#(\d{1,6})\b/g)) {
    const idx = m.index ?? 0;
    // Look back at the words right before this `#N`; if they're a close
    // keyword, it's an issue ref, skip it.
    const prefix = line.slice(Math.max(0, idx - 24), idx + m[0].length);
    if (ISSUE_CLOSE_RE.test(prefix)) continue;
    out.push(Number(m[1]));
  }
  return out;
}

function parseUnreleased(text: string): { entries: string[]; prs: number[]; found: boolean } {
  const lines = text.split(/\r?\n/);
  let started = false;
  const entries: string[] = [];
  const prs = new Set<number>();
  for (const line of lines) {
    if (/^##\s*\[?unreleased\]?/i.test(line.trim())) {
      started = true;
      continue;
    }
    if (started && /^##\s/.test(line)) break;
    if (started) {
      const trimmed = line.trim();
      if (/^[-*]\s+/.test(trimmed)) entries.push(trimmed);
      // Only harvest PR-context numbers; an entry like "- Fix crash (closes #9)"
      // references issue #9, not PR #9 — counting it would falsely mark PR #9 as
      // "covered" in the changelog.
      for (const n of harvestPrRefs(line)) prs.add(n);
    }
  }
  return { entries, prs: [...prs].sort((a, b) => a - b), found: started };
}

function parseMergedPrs(gitLog: string): { number: number; title: string }[] {
  const out: { number: number; title: string }[] = [];
  for (const line of gitLog.split(/\r?\n/)) {
    // Matches "feat: foo (#123)" or "Merge pull request #123 from..."
    const merge = line.match(/^Merge pull request #(\d+) /);
    if (merge) {
      out.push({ number: Number(merge[1]), title: line.replace(/^Merge pull request #\d+ /, "") });
      continue;
    }
    const paren = line.match(/\(#(\d+)\)\s*$/);
    // The trailing `(#N)` of a squash-merge is a PR ref. Guard against the
    // (rare) `fix #N` issue-close form sitting in the trailing parens.
    if (paren && !ISSUE_CLOSE_RE.test(line.slice(Math.max(0, (paren.index ?? 0) - 24)))) {
      out.push({ number: Number(paren[1]), title: line });
    }
  }
  // de-dup by number, keep first
  const seen = new Set<number>();
  return out.filter((p) => {
    if (seen.has(p.number)) return false;
    seen.add(p.number);
    return true;
  });
}

/**
 * Count substantive commits in a `git log --pretty=%s` block — i.e. all commit
 * subjects that are NOT a merge-commit subject line. Used to decide "has work
 * happened since the last tag?" independent of whether commits carry PR
 * numbers. Squash/rebase-merge repos drop the `(#N)` suffix, so a PR-only count
 * sees zero work and falsely reports READY; counting raw commits closes that
 * gap.
 */
function countCommits(gitLog: string): number {
  return gitLog
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^Merge (?:pull request |branch |remote-tracking )/.test(l))
    .length;
}

// ---- publish workflow detection ----

function detectPublishWorkflow(repoPath: string): PublishWorkflowReport {
  const dir = join(repoPath, ".github", "workflows");
  if (!existsSync(dir)) return { files: [], likelyKind: "missing" };

  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    return { files: [], likelyKind: "missing" };
  }

  // Detect publish/release workflows by CONTENT, not just filename. Many repos
  // name their CD workflow `cd.yml` (or `cd-ios.yml`, `cd-firefox.yml`), which
  // no `release|publish|deploy` filename keyword matches — a filename-only
  // filter false-negatives them and yields a bogus "no publish workflow"
  // blocker. Keep the filename keywords as a fast path; otherwise fall back to
  // recognized publish/release actions and commands in the file body.
  const filenameHit = (f: string) =>
    /(?:release|publish|deploy)/i.test(f) || /(?:^|[-_])cd(?:[-_.]|$)/i.test(f);
  const publishContent =
    /(?:\b(?:npm|pnpm|yarn)\s+publish\b|\bvsce\s+publish\b|\bovsx\s+publish\b|\beas\s+submit\b|gh-action-pypi-publish|action-gh-release|\bgh\s+release\s+create\b|\btwine\s+upload\b|wrangler[^\n]*\bdeploy\b|docker\/build-push-action)/i;

  const candidates: { file: string; content: string }[] = [];
  for (const f of entries) {
    const content = safeReadText(join(dir, f));
    if (!content) continue;
    // Match publish signals against non-comment lines only, so a workflow that
    // merely *mentions* a publish action in a comment (e.g. update-changelog.yml
    // explaining the release flow) is not misdetected as a publisher.
    const codeOnly = content
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    if (filenameHit(f) || publishContent.test(codeOnly)) {
      candidates.push({ file: f, content });
    }
  }
  if (candidates.length === 0) return { files: [], likelyKind: "missing" };

  let kind: WorkflowKind = "unknown";
  for (const { content } of candidates) {
    if (/release-please/i.test(content)) {
      kind = "release-please";
      break;
    }
    if (/on:\s*push:\s*tags:/m.test(content) || /tags:\s*\n\s*-\s*['"]?v/m.test(content)) {
      kind = "publish-on-tag";
    } else if (/workflow_dispatch/.test(content) && kind === "unknown") {
      kind = "publish-manual";
    } else if (kind === "unknown") {
      kind = "auto-release";
    }
  }

  return { files: candidates.map((c) => c.file), likelyKind: kind };
}

// ---- main audit ----

export async function auditRelease(repoPath: string): Promise<AuditReport> {
  const abs = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }

  const sig = extractStarterSignals(abs);
  const matchedStarter: MatchedStarter = {
    id: sig.id,
    confidence: sig.confidence,
    signals: sig.signals,
  };
  const current = sig.localVersion;
  const source = sig.versionSource;

  const lastTag = tryGit(abs, ["describe", "--tags", "--abbrev=0"]) || null;
  let drift: VersionReport["drift"] = "unknown";
  if (current && lastTag) {
    const cmp = semverCompare(current, lastTag);
    drift = cmp === 0 ? "current==tag" : cmp > 0 ? "current>tag" : "current<tag";
  } else if (current && !lastTag) {
    drift = "no-tag";
  }

  const changelogPath = ["CHANGELOG.md", "CHANGELOG", "changelog.md"]
    .map((f) => join(abs, f))
    .find((p) => existsSync(p)) ?? null;
  const changelogText = changelogPath ? safeReadText(changelogPath) : null;
  const parsed = changelogText
    ? parseUnreleased(changelogText)
    : { entries: [], prs: [], found: false };

  let mergedPrs: { number: number; title: string }[] = [];
  // Count ALL commits since the tag (not just PR-numbered ones) so rebase-merge
  // / squash-without-PR-number repos still register that work has happened. The
  // PR subset below is only for the CHANGELOG cross-reference.
  let commitsSinceTag = 0;
  if (lastTag) {
    const log = tryGit(abs, ["log", `${lastTag}..HEAD`, "--pretty=%s"]);
    if (log) {
      mergedPrs = parseMergedPrs(log);
      commitsSinceTag = countCommits(log);
    }
  } else {
    const log = tryGit(abs, ["log", "--pretty=%s", "-n", "200"]);
    if (log) {
      mergedPrs = parseMergedPrs(log);
      commitsSinceTag = countCommits(log);
    }
  }

  const unreleasedPrSet = new Set(parsed.prs);
  const missing = mergedPrs.filter((p) => !unreleasedPrSet.has(p.number));

  const publishWorkflow = detectPublishWorkflow(abs);

  // Ship-ready verdict
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Bump-required is driven by raw commit count, not PR-matched commits, so a
  // rebase-merge repo (no `(#N)` suffixes) is no longer falsely reported READY.
  if (commitsSinceTag > 0 && drift === "current==tag") {
    const detail =
      mergedPrs.length > 0
        ? `${mergedPrs.length} merged PR(s)`
        : `${commitsSinceTag} commit(s)`;
    blockers.push(
      `${detail} since tag ${lastTag} but version still ${current} — bump required`,
    );
  }
  if (publishWorkflow.likelyKind === "missing" && matchedStarter.id && matchedStarter.id !== "docker-deploy") {
    blockers.push("No release/publish workflow detected in .github/workflows/");
  }
  if (parsed.found && missing.length > 5) {
    warnings.push(
      `${missing.length} merged PR(s) missing from CHANGELOG Unreleased section`,
    );
  } else if (parsed.found && missing.length > 0) {
    warnings.push(
      `${missing.length} merged PR(s) missing from CHANGELOG Unreleased: ${missing
        .slice(0, 5)
        .map((p) => "#" + p.number)
        .join(", ")}`,
    );
  }
  if (!parsed.found && changelogPath) {
    warnings.push("CHANGELOG.md exists but no Unreleased section");
  }
  if (!changelogPath) {
    warnings.push("CHANGELOG.md missing");
  }
  if (drift === "no-tag" && commitsSinceTag > 0) {
    warnings.push("Repo has no git tags — release history cannot be inferred");
  }

  let verdict: ShipVerdict;
  if (blockers.length > 0) verdict = "no";
  else if (warnings.length > 0) verdict = "needs-attention";
  else verdict = "yes";

  return {
    repoPath: abs,
    matchedStarter,
    changelog: {
      file: changelogPath,
      unreleasedSection: parsed.found,
      unreleasedEntries: parsed.entries.length,
      unreleasedPrs: parsed.prs,
      commitsSinceLastTag: commitsSinceTag,
      mergedPrsSinceLastTag: mergedPrs,
      missingFromChangelog: missing,
    },
    version: { current, source, lastTag, drift },
    publishWorkflow,
    shipReady: { verdict, blockers, warnings },
  };
}

// ---- formatting ----

function bullet(label: string, value: string): string {
  return `  - ${label}: ${value}`;
}

export function formatAuditReport(r: AuditReport): string {
  const out: string[] = [];
  out.push(`audit_release — ${r.repoPath}`);
  out.push("");

  const verdictIcon =
    r.shipReady.verdict === "yes" ? "READY" : r.shipReady.verdict === "no" ? "BLOCKED" : "ATTENTION";
  out.push(`Ship-ready: ${verdictIcon}`);
  for (const b of r.shipReady.blockers) out.push(`  ! ${b}`);
  for (const w of r.shipReady.warnings) out.push(`  ~ ${w}`);
  out.push("");

  out.push("Matched starter:");
  out.push(
    bullet("id", r.matchedStarter.id ?? "(none)") +
      ` [${r.matchedStarter.confidence}]`,
  );
  for (const s of r.matchedStarter.signals) out.push(`    · ${s}`);
  out.push("");

  out.push("Version:");
  out.push(bullet("current", r.version.current ?? "(unknown)"));
  out.push(bullet("source", r.version.source ?? "(unknown)"));
  out.push(bullet("last tag", r.version.lastTag ?? "(none)"));
  out.push(bullet("drift", r.version.drift));
  out.push("");

  out.push("Changelog:");
  out.push(bullet("file", r.changelog.file ?? "(missing)"));
  out.push(bullet("Unreleased section", String(r.changelog.unreleasedSection)));
  out.push(bullet("Unreleased entries", String(r.changelog.unreleasedEntries)));
  out.push(
    bullet(
      "merged PRs since last tag",
      String(r.changelog.mergedPrsSinceLastTag.length),
    ),
  );
  if (r.changelog.missingFromChangelog.length > 0) {
    const sample = r.changelog.missingFromChangelog
      .slice(0, 10)
      .map((p) => `#${p.number}`)
      .join(", ");
    out.push(
      bullet(
        "missing from Unreleased",
        `${r.changelog.missingFromChangelog.length} (${sample}${
          r.changelog.missingFromChangelog.length > 10 ? ", …" : ""
        })`,
      ),
    );
  }
  out.push("");

  out.push("Publish workflow:");
  out.push(
    bullet(
      "files",
      r.publishWorkflow.files.length === 0
        ? "(none)"
        : r.publishWorkflow.files.join(", "),
    ),
  );
  out.push(bullet("kind", r.publishWorkflow.likelyKind));

  return out.join("\n") + "\n";
}
