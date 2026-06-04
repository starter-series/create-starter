import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Read and parse a JSON file, returning null on any read or parse error. */
export function safeReadJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Read a file as utf-8 text, returning null on any read error. */
export function safeReadText(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Run `git <args>` in repoPath and return trimmed stdout, or null on error. */
export function tryGit(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Split a semver string into its three precedence-bearing parts per SemVer 2.0:
 *   <major.minor.patch>[-prerelease][+build]
 * Build metadata (everything after the first `+`) is dropped entirely — SemVer
 * §10: "Build metadata MUST be ignored when determining version precedence."
 * The leading `v` (common in git tags) is tolerated.
 *
 * Returns null if the core (major.minor.patch) is not three dot-separated
 * numeric identifiers, so callers can treat unparseable strings explicitly
 * instead of getting a bogus ordering.
 */
function parseSemver(
  s: string,
): { core: number[]; prerelease: string[] } | null {
  // Strip build metadata (§10) first, then a single leading `v`.
  const noBuild = s.split("+", 1)[0];
  const withoutV = noBuild.replace(/^v/, "");
  const dash = withoutV.indexOf("-");
  const coreStr = dash === -1 ? withoutV : withoutV.slice(0, dash);
  const preStr = dash === -1 ? "" : withoutV.slice(dash + 1);

  const coreParts = coreStr.split(".");
  if (coreParts.length !== 3) return null;
  const core: number[] = [];
  for (const p of coreParts) {
    if (!/^\d+$/.test(p)) return null;
    core.push(Number(p));
  }
  const prerelease = preStr === "" ? [] : preStr.split(".");
  return { core, prerelease };
}

/**
 * Compare two prerelease identifier lists per SemVer §11.4:
 *   - numeric identifiers compare numerically;
 *   - alphanumeric identifiers compare lexically (ASCII);
 *   - a numeric identifier always has LOWER precedence than an alphanumeric one;
 *   - a larger set of fields has higher precedence when all preceding are equal.
 * Both inputs are non-empty (the §11.3 "no prerelease > has prerelease" rule is
 * handled by the caller).
 */
function comparePrerelease(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    // §11.4.4: a larger set of pre-release fields has higher precedence,
    // provided all preceding identifiers are equal.
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const ai = a[i];
    const bi = b[i];
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const an = Number(ai);
      const bn = Number(bi);
      if (an !== bn) return an < bn ? -1 : 1;
    } else if (aNum && !bNum) {
      // §11.4.3: numeric identifiers always have lower precedence.
      return -1;
    } else if (!aNum && bNum) {
      return 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two semver strings per SemVer 2.0 precedence. Returns -1 if a < b,
 * 1 if a > b, 0 if equal. Implements §10 (build metadata ignored) and §11
 * (prerelease ordering, including that a normal release outranks its own
 * prerelease: 1.0.0 > 1.0.0-rc.3).
 *
 * Tolerant of a leading `v` on either side. If either side is not a valid
 * `major.minor.patch[-pre]` string, falls back to a deterministic dot/dash
 * split comparison so the auditor still produces *some* ordering rather than
 * throwing — but well-formed semver always takes the spec path above.
 */
export function semverCompare(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  if (pa && pb) {
    // Compare major.minor.patch numerically (§11.2).
    for (let i = 0; i < 3; i++) {
      if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
    }
    // §11.3: a version WITHOUT a prerelease has higher precedence than one
    // WITH a prerelease at the same core (1.0.0 > 1.0.0-rc.3).
    const aHasPre = pa.prerelease.length > 0;
    const bHasPre = pb.prerelease.length > 0;
    if (!aHasPre && !bHasPre) return 0;
    if (!aHasPre && bHasPre) return 1;
    if (aHasPre && !bHasPre) return -1;
    return comparePrerelease(pa.prerelease, pb.prerelease);
  }

  // Fallback for non-semver strings: strip a leading `v` and the build
  // metadata (still honoring §10), then compare segment-by-segment with the
  // same numeric-vs-string rule. Deterministic, never throws.
  const norm = (s: string) =>
    s
      .split("+", 1)[0]
      .replace(/^v/, "")
      .split(/[.\-]/)
      .map((p) => {
        const n = Number(p);
        return /^\d+$/.test(p) && Number.isFinite(n) ? n : p;
      });
  const aa = norm(a);
  const bb = norm(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const av = aa[i] ?? 0;
    const bv = bb[i] ?? 0;
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") {
      return av < bv ? -1 : 1;
    }
    return String(av) < String(bv) ? -1 : 1;
  }
  return 0;
}

/**
 * Extract the trailing SemVer (`major.minor.patch[-pre][+build]`) substring
 * from a git tag that may carry a monorepo / scoped prefix.
 *
 * GitHub release tags are not always bare `v1.2.3`. Monorepos and scoped
 * packages tag releases as `@scope/pkg@1.2.3`, `pkg-name-v1.2.3`,
 * `release-1.2.3`, `2026.01.0`, etc. Stripping only a leading `v` (the old
 * behavior) left the prefix attached, so `semverCompare("1.2.3",
 * "@scope/x@1.2.3")` reported phantom drift. We anchor on the LAST semver-shaped
 * run in the string so the common `name@1.2.3` / `name-v1.2.3` shapes resolve to
 * `1.2.3`.
 *
 * Returns the matched version (without a leading `v`) or null if the tag has no
 * extractable SemVer core — callers should treat null as "can't compare".
 */
export function extractSemver(tag: string): string | null {
  // Match all semver cores; keep the last one (handles `1.0-shipped-2.3.4`,
  // and the `@scope/x@1.2.3` case where the leading part has no dotted core).
  const re = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/g;
  let last: string | null = null;
  for (const m of tag.matchAll(re)) last = m[1];
  return last;
}

/**
 * Parse a GitHub remote URL (https or ssh form) into owner/repo.
 * Returns `${owner}/${repo}` or null if not a github.com remote.
 */
export function parseGitHubRemote(url: string): string | null {
  const m = url.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
