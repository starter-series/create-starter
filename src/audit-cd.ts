import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { extractSemver, parseGitHubRemote, semverCompare, tryGit } from "./audit-helpers.js";
import { extractStarterSignals } from "./starter-detect.js";

export type DestinationName =
  | "npm"
  | "pypi"
  | "open-vsx"
  | "vs-marketplace"
  | "amo"
  | "github-releases";

export type CdStatus =
  | "in-sync"
  | "needs-publish"
  | "local-stale"
  | "not-found"
  | "error"
  | "unsupported";

export type CdVerdict = "in-sync" | "needs-publish" | "drift" | "unknown";

export interface DestinationReport {
  name: DestinationName;
  identifier: string;
  publishedVersion: string | null;
  publishedAt: string | null;
  status: CdStatus;
  detail?: string;
}

export interface AuditCdReport {
  repoPath: string;
  matchedStarter: { id: string | null; signals: string[] };
  localVersion: string | null;
  versionSource: "package.json" | "pyproject.toml" | "manifest.json" | null;
  destinations: DestinationReport[];
  overall: { verdict: CdVerdict; blockers: string[]; warnings: string[] };
}

export interface AuditCdOptions {
  /** Injectable for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
}

function classifyDrift(local: string | null, published: string | null): CdStatus {
  if (!local || !published) return "not-found";
  const cmp = semverCompare(local, published);
  if (cmp === 0) return "in-sync";
  if (cmp > 0) return "needs-publish";
  return "local-stale";
}

/**
 * Like {@link classifyDrift} but for a published *git tag* that may carry a
 * monorepo / scoped prefix (`@scope/x@1.2.3`, `release-1.2.3`). Extract the
 * trailing SemVer before comparing; if the tag has no extractable SemVer we
 * can't meaningfully compare, so we treat it as in-sync (no phantom drift)
 * rather than fabricating a stale/needs-publish verdict from prefix noise.
 */
function classifyDriftTag(local: string | null, tag: string | null): CdStatus {
  if (!local || !tag) return "not-found";
  const publishedVer = extractSemver(tag);
  if (publishedVer === null) return "in-sync";
  return classifyDrift(local, publishedVer);
}

/**
 * Template placeholder identifiers that ship inside the Starter Series
 * scaffolds. A repo still carrying one of these has not been configured for a
 * real destination yet — reporting `not-found` / `needs-publish` against the
 * literal placeholder is misleading. We surface a distinct `unsupported`
 * ("template not configured") status instead so the auditor nudges the user to
 * set a real name rather than to "publish my-mcp-server".
 */
const TEMPLATE_PLACEHOLDERS = new Set([
  "my-mcp-server",
  "my-package",
  "my-discord-bot",
  "my-telegram-bot",
  "my-extension",
  "my-vscode-extension",
  "my-electron-app",
  "my-app",
  "my-site",
  "my-service",
]);

function isPlaceholderIdentifier(id: string): boolean {
  const lower = id.toLowerCase();
  // Bare or scoped placeholder package names (e.g. "my-mcp-server",
  // "@you/my-mcp-server"), and the AMO template gecko id.
  const bare = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  if (TEMPLATE_PLACEHOLDERS.has(bare)) return true;
  // AMO template id from the browser-extension starter manifest.
  if (lower.includes("{your-extension-id}") || lower === "{your-extension-id}@example.com") {
    return true;
  }
  return false;
}

function placeholderReport(name: DestinationName, identifier: string): DestinationReport {
  return {
    name,
    identifier,
    publishedVersion: null,
    publishedAt: null,
    status: "unsupported",
    detail: "template not configured — set a real package/extension identifier before publishing",
  };
}

// ---- fetch with timeout ----

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; reason: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, reason: `${res.status} ${res.statusText}` };
    }
    const data = (await res.json()) as unknown;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// ---- destination probes ----

/** Pick the highest SemVer key from an npm `versions` map (or any tag map). */
function highestVersion(versions: string[]): string | null {
  let best: string | null = null;
  for (const v of versions) {
    if (best === null || semverCompare(v, best) > 0) best = v;
  }
  return best;
}

async function probeNpm(
  pkgName: string,
  localVersion: string | null,
  f: typeof fetch,
  timeout: number,
): Promise<DestinationReport> {
  if (isPlaceholderIdentifier(pkgName)) return placeholderReport("npm", pkgName);
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`;
  const res = await fetchJson(url, f, timeout);
  if (!res.ok) {
    if (res.status === 404) {
      return {
        name: "npm",
        identifier: pkgName,
        publishedVersion: null,
        publishedAt: null,
        status: "not-found",
        detail: "package not on npm registry",
      };
    }
    return {
      name: "npm",
      identifier: pkgName,
      publishedVersion: null,
      publishedAt: null,
      status: "error",
      detail: res.reason,
    };
  }
  const data = res.data as Record<string, unknown>;
  const distTags = (data["dist-tags"] ?? {}) as Record<string, string>;
  const time = (data.time ?? {}) as Record<string, string>;
  const versionsMap = (data.versions ?? {}) as Record<string, unknown>;

  // Prefer dist-tags.latest. A package published only under prerelease tags
  // (e.g. `next`, `beta`) has NO `dist-tags.latest` even though it IS
  // published — falling through to "not-found" there is wrong (the old bug).
  // Fall back to the highest version across all dist-tags, then the highest
  // key in the full `versions` map, so a prerelease-only package reports its
  // real highest published version instead of a phantom 404.
  let published: string | null = distTags.latest ?? null;
  let detail: string | undefined;
  if (!published) {
    const tagVersions = Object.values(distTags).filter((v): v is string => typeof v === "string");
    const versionKeys = Object.keys(versionsMap);
    published = highestVersion(tagVersions) ?? highestVersion(versionKeys);
    if (published) {
      const tagNames = Object.keys(distTags).join(", ") || "none";
      detail = `no dist-tags.latest (published only as: ${tagNames}); comparing against highest published version ${published}`;
    }
  }

  if (!published) {
    // Reachable on the registry but with zero versions — genuinely nothing
    // published (e.g. an unpublished/security-holding placeholder doc).
    return {
      name: "npm",
      identifier: pkgName,
      publishedVersion: null,
      publishedAt: null,
      status: "not-found",
      detail: "package exists on npm but has no published versions",
    };
  }

  return {
    name: "npm",
    identifier: pkgName,
    publishedVersion: published,
    publishedAt: published && time[published] ? time[published] : null,
    status: classifyDrift(localVersion, published),
    detail,
  };
}

async function probePyPI(
  pkgName: string,
  localVersion: string | null,
  f: typeof fetch,
  timeout: number,
): Promise<DestinationReport> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(pkgName)}/json`;
  const res = await fetchJson(url, f, timeout);
  if (!res.ok) {
    if (res.status === 404) {
      return {
        name: "pypi",
        identifier: pkgName,
        publishedVersion: null,
        publishedAt: null,
        status: "not-found",
        detail: "package not on PyPI",
      };
    }
    return {
      name: "pypi",
      identifier: pkgName,
      publishedVersion: null,
      publishedAt: null,
      status: "error",
      detail: res.reason,
    };
  }
  const data = res.data as Record<string, unknown>;
  const info = (data.info ?? {}) as Record<string, string>;
  return {
    name: "pypi",
    identifier: pkgName,
    publishedVersion: info.version ?? null,
    publishedAt: null,
    status: classifyDrift(localVersion, info.version ?? null),
  };
}

async function probeVsMarketplace(
  publisher: string,
  name: string,
  localVersion: string | null,
  f: typeof fetch,
  timeout: number,
): Promise<DestinationReport> {
  const url = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
  const id = `${publisher}.${name}`;
  const body = {
    filters: [
      {
        criteria: [{ filterType: 7, value: id }],
        pageNumber: 1,
        pageSize: 1,
        sortBy: 0,
        sortOrder: 0,
      },
    ],
    assetTypes: [],
    flags: 0x100, // IncludeLatestVersionOnly
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await f(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        accept: "application/json;api-version=3.0-preview.1",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        name: "vs-marketplace",
        identifier: id,
        publishedVersion: null,
        publishedAt: null,
        status: "error",
        detail: `${res.status} ${res.statusText}`,
      };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const results = (data.results ?? []) as Array<{ extensions?: Array<Record<string, unknown>> }>;
    const ext = results[0]?.extensions?.[0];
    if (!ext) {
      return {
        name: "vs-marketplace",
        identifier: id,
        publishedVersion: null,
        publishedAt: null,
        status: "not-found",
        detail: "extension not on VS Marketplace",
      };
    }
    const versions = (ext.versions ?? []) as Array<{ version?: string; lastUpdated?: string }>;
    const latest = versions[0];
    return {
      name: "vs-marketplace",
      identifier: id,
      publishedVersion: latest?.version ?? null,
      publishedAt: latest?.lastUpdated ?? null,
      status: classifyDrift(localVersion, latest?.version ?? null),
    };
  } catch (e) {
    return {
      name: "vs-marketplace",
      identifier: id,
      publishedVersion: null,
      publishedAt: null,
      status: "error",
      detail: (e as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeOpenVsx(
  publisher: string,
  name: string,
  localVersion: string | null,
  f: typeof fetch,
  timeout: number,
): Promise<DestinationReport> {
  const url = `https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}`;
  const id = `${publisher}.${name}`;
  const res = await fetchJson(url, f, timeout);
  if (!res.ok) {
    if (res.status === 404) {
      return {
        name: "open-vsx",
        identifier: id,
        publishedVersion: null,
        publishedAt: null,
        status: "not-found",
        detail: "extension not on Open VSX",
      };
    }
    return {
      name: "open-vsx",
      identifier: id,
      publishedVersion: null,
      publishedAt: null,
      status: "error",
      detail: res.reason,
    };
  }
  const data = res.data as Record<string, unknown>;
  const v = (data.version as string | undefined) ?? null;
  const timestamp = (data.timestamp as string | undefined) ?? null;
  return {
    name: "open-vsx",
    identifier: id,
    publishedVersion: v,
    publishedAt: timestamp,
    status: classifyDrift(localVersion, v),
  };
}

async function probeAmo(
  geckoId: string,
  localVersion: string | null,
  f: typeof fetch,
  timeout: number,
): Promise<DestinationReport> {
  if (isPlaceholderIdentifier(geckoId)) return placeholderReport("amo", geckoId);
  const url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(geckoId)}/`;
  const res = await fetchJson(url, f, timeout);
  if (!res.ok) {
    if (res.status === 404) {
      return {
        name: "amo",
        identifier: geckoId,
        publishedVersion: null,
        publishedAt: null,
        status: "not-found",
        detail: "add-on not found on AMO",
      };
    }
    return {
      name: "amo",
      identifier: geckoId,
      publishedVersion: null,
      publishedAt: null,
      status: "error",
      detail: res.reason,
    };
  }
  const data = res.data as Record<string, unknown>;
  const cv = (data.current_version ?? {}) as Record<string, unknown>;
  return {
    name: "amo",
    identifier: geckoId,
    publishedVersion: (cv.version as string | undefined) ?? null,
    publishedAt: null,
    status: classifyDrift(localVersion, (cv.version as string | undefined) ?? null),
  };
}

function probeGithubReleases(
  repoPath: string,
  localVersion: string | null,
): DestinationReport | null {
  const remote = tryGit(repoPath, ["config", "--get", "remote.origin.url"]);
  if (!remote) return null;
  const id = parseGitHubRemote(remote);
  if (!id) return null;

  try {
    const out = execFileSync(
      "gh",
      ["release", "view", "--json", "tagName,publishedAt", "-R", id],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const data = JSON.parse(out) as { tagName?: string; publishedAt?: string };
    const tag = data.tagName ?? null;
    return {
      name: "github-releases",
      identifier: id,
      publishedVersion: tag,
      publishedAt: data.publishedAt ?? null,
      // Tags may be monorepo/scoped (`@scope/x@1.2.3`, `release-1.2.3`); extract
      // the trailing SemVer before comparing so a prefixed tag at the same
      // version doesn't read as phantom drift.
      status: classifyDriftTag(localVersion, tag),
    };
  } catch (e) {
    type ExecErr = Error & { stderr?: Buffer | string; stdout?: Buffer | string };
    const err = e as ExecErr;
    const stderr =
      typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf-8") ?? "";
    const haystack = `${err.message ?? ""} ${stderr}`.toLowerCase();
    if (/release not found|no release|404|no published release/.test(haystack)) {
      return {
        name: "github-releases",
        identifier: id,
        publishedVersion: null,
        publishedAt: null,
        status: "not-found",
        detail: "no GitHub Releases yet",
      };
    }
    if (/command not found|enoent|spawnSync gh/.test(haystack)) {
      return {
        name: "github-releases",
        identifier: id,
        publishedVersion: null,
        publishedAt: null,
        status: "error",
        detail: "gh CLI not installed",
      };
    }
    if (/auth|login|not authenticated/.test(haystack)) {
      return {
        name: "github-releases",
        identifier: id,
        publishedVersion: null,
        publishedAt: null,
        status: "error",
        detail: "gh CLI not authenticated (run: gh auth login)",
      };
    }
    return {
      name: "github-releases",
      identifier: id,
      publishedVersion: null,
      publishedAt: null,
      status: "error",
      detail: stderr.trim() || err.message || "gh release view failed",
    };
  }
}

// ---- main audit ----

export async function auditCd(
  repoPath: string,
  options: AuditCdOptions = {},
): Promise<AuditCdReport> {
  const abs = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }

  const f = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? 5000;

  const sig = extractStarterSignals(abs);
  const destinations: DestinationReport[] = [];
  const probes: Promise<DestinationReport>[] = [];

  // Wrap every probe so a single malformed payload can't abort the whole
  // multi-destination audit. A probe that throws synchronously (e.g. a version
  // returned as a JSON number, so `.replace` throws inside the probe) or
  // rejects is converted into a per-destination `{status:'error'}` report; the
  // other destinations still resolve. `name`/`identifier` are captured here so
  // the error report is still attributable even though the probe never got far
  // enough to build its own.
  const safeProbe = (
    name: DestinationName,
    identifier: string,
    run: () => Promise<DestinationReport>,
  ): Promise<DestinationReport> =>
    run().catch((e: unknown) => ({
      name,
      identifier,
      publishedVersion: null,
      publishedAt: null,
      status: "error" as const,
      detail: `probe crashed: ${(e as Error)?.message ?? String(e)}`,
    }));

  // Per-starter destination plan
  switch (sig.id) {
    case "mcp-server":
    case "npm-package":
      if (sig.npmName) {
        probes.push(
          safeProbe("npm", sig.npmName, () => probeNpm(sig.npmName!, sig.localVersion, f, timeout)),
        );
      }
      break;
    case "mcp-server-python":
      if (sig.pyName) {
        probes.push(
          safeProbe("pypi", sig.pyName, () => probePyPI(sig.pyName!, sig.localVersion, f, timeout)),
        );
      }
      break;
    case "vscode-extension":
      if (sig.vscodePublisher && sig.vscodeName) {
        const ovId = `${sig.vscodePublisher}.${sig.vscodeName}`;
        probes.push(
          safeProbe("open-vsx", ovId, () =>
            probeOpenVsx(sig.vscodePublisher!, sig.vscodeName!, sig.localVersion, f, timeout),
          ),
        );
        probes.push(
          safeProbe("vs-marketplace", ovId, () =>
            probeVsMarketplace(sig.vscodePublisher!, sig.vscodeName!, sig.localVersion, f, timeout),
          ),
        );
      } else {
        destinations.push({
          name: "open-vsx",
          identifier: "(unknown)",
          publishedVersion: null,
          publishedAt: null,
          status: "unsupported",
          detail: "package.json missing publisher or name",
        });
      }
      break;
    case "browser-extension":
      if (sig.geckoId) {
        probes.push(
          safeProbe("amo", sig.geckoId, () => probeAmo(sig.geckoId!, sig.localVersion, f, timeout)),
        );
      } else {
        destinations.push({
          name: "amo",
          identifier: "(none)",
          publishedVersion: null,
          publishedAt: null,
          status: "unsupported",
          detail: "manifest.json browser_specific_settings.gecko.id not set",
        });
      }
      break;
    default:
      break;
  }

  // GitHub Releases for all repo types (best-effort, requires gh CLI)
  const ghRelease = probeGithubReleases(abs, sig.localVersion);
  if (ghRelease) destinations.push(ghRelease);

  const resolved = await Promise.all(probes);
  destinations.unshift(...resolved);

  // Verdict aggregation
  const blockers: string[] = [];
  const warnings: string[] = [];
  let verdict: CdVerdict = "in-sync";

  for (const d of destinations) {
    if (d.status === "needs-publish") {
      blockers.push(
        `${d.name} (${d.identifier}): local ${sig.localVersion} > published ${d.publishedVersion ?? "(none)"}`,
      );
      verdict = "needs-publish";
    } else if (d.status === "local-stale") {
      warnings.push(
        `${d.name} (${d.identifier}): local ${sig.localVersion} < published ${d.publishedVersion}`,
      );
      if (verdict === "in-sync") verdict = "drift";
    } else if (d.status === "not-found") {
      warnings.push(`${d.name} (${d.identifier}): no published release yet`);
      if (verdict === "in-sync") verdict = "drift";
    } else if (d.status === "error" || d.status === "unsupported") {
      warnings.push(
        `${d.name} (${d.identifier}): ${d.status} — ${d.detail ?? "no detail"}`,
      );
      if (verdict === "in-sync") verdict = "unknown";
    }
  }

  if (destinations.length === 0) {
    verdict = "unknown";
    warnings.push("No known destinations detected for this starter type");
  }

  return {
    repoPath: abs,
    matchedStarter: { id: sig.id, signals: sig.signals },
    localVersion: sig.localVersion,
    versionSource: sig.versionSource,
    destinations,
    overall: { verdict, blockers, warnings },
  };
}

// ---- formatting ----

export function formatAuditCdReport(r: AuditCdReport): string {
  const out: string[] = [];
  out.push(`audit_cd — ${r.repoPath}`);
  out.push("");

  out.push(`Overall: ${r.overall.verdict.toUpperCase()}`);
  for (const b of r.overall.blockers) out.push(`  ! ${b}`);
  for (const w of r.overall.warnings) out.push(`  ~ ${w}`);
  out.push("");

  out.push("Matched starter:");
  out.push(`  - id: ${r.matchedStarter.id ?? "(none)"}`);
  for (const s of r.matchedStarter.signals) out.push(`    · ${s}`);
  out.push("");

  out.push(`Local version: ${r.localVersion ?? "(unknown)"} (${r.versionSource ?? "n/a"})`);
  out.push("");

  out.push("Destinations:");
  if (r.destinations.length === 0) {
    out.push("  (none detected)");
  }
  for (const d of r.destinations) {
    out.push(`  - ${d.name} (${d.identifier})`);
    out.push(`      status: ${d.status}`);
    out.push(`      published: ${d.publishedVersion ?? "(none)"}${d.publishedAt ? ` @ ${d.publishedAt}` : ""}`);
    if (d.detail) out.push(`      note: ${d.detail}`);
  }

  return out.join("\n") + "\n";
}
