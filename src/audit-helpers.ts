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
 * Compare two semver-ish strings. Returns -1 if a < b, 1 if a > b, 0 if equal.
 * Tolerant: strips leading `v`, splits on `.`/`-`/`+`, falls back to string
 * compare for non-numeric segments. Good enough for "is local ahead of tag?"
 * checks; not a full semver parser.
 */
export function semverCompare(a: string, b: string): number {
  const norm = (s: string) =>
    s.replace(/^v/, "").split(/[.\-+]/).map((p) => {
      const n = Number(p);
      return Number.isFinite(n) ? n : p;
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
 * Parse a GitHub remote URL (https or ssh form) into owner/repo.
 * Returns `${owner}/${repo}` or null if not a github.com remote.
 */
export function parseGitHubRemote(url: string): string | null {
  const m = url.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
