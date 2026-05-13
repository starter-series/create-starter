import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

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

// ---- fs helpers (duplicated minimally to keep modules independent) ----

function safeReadJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeReadText(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function tryGit(repoPath: string, args: string[]): string | null {
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

function semverCompare(a: string, b: string): number {
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

function classifyDrift(local: string | null, published: string | null): CdStatus {
  if (!local || !published) return "not-found";
  const cmp = semverCompare(local, published);
  if (cmp === 0) return "in-sync";
  if (cmp > 0) return "needs-publish";
  return "local-stale";
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

async function probeNpm(
  pkgName: string,
  localVersion: string | null,
  f: typeof fetch,
  timeout: number,
): Promise<DestinationReport> {
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
  const latest = distTags.latest ?? null;
  return {
    name: "npm",
    identifier: pkgName,
    publishedVersion: latest,
    publishedAt: latest && time[latest] ? time[latest] : null,
    status: classifyDrift(localVersion, latest),
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
  const m =
    remote.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/) ??
    null;
  if (!m) return null;
  const id = `${m[1]}/${m[2]}`;

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
      status: classifyDrift(localVersion, tag),
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

// ---- repo signal extraction ----

interface RepoSignals {
  starterId: string | null;
  signals: string[];
  localVersion: string | null;
  versionSource: AuditCdReport["versionSource"];
  npmName: string | null;
  pyName: string | null;
  vscodePublisher: string | null;
  vscodeName: string | null;
  geckoId: string | null;
}

function extractSignals(repoPath: string): RepoSignals {
  const signals: string[] = [];
  let starterId: string | null = null;
  let localVersion: string | null = null;
  let versionSource: AuditCdReport["versionSource"] = null;
  let npmName: string | null = null;
  let pyName: string | null = null;
  let vscodePublisher: string | null = null;
  let vscodeName: string | null = null;
  let geckoId: string | null = null;

  const pkg = safeReadJson(join(repoPath, "package.json"));
  if (pkg) {
    if (typeof pkg.version === "string") {
      localVersion = pkg.version;
      versionSource = "package.json";
    }
    if (typeof pkg.name === "string") npmName = pkg.name;

    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const engines = (pkg.engines ?? {}) as Record<string, string>;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const hasDep = (name: string) => name in deps || name in devDeps;

    if (hasDep("discord.js")) {
      starterId = "discord-bot";
      signals.push("package.json deps include discord.js");
    } else if (hasDep("grammy")) {
      starterId = "telegram-bot";
      signals.push("package.json deps include grammy");
    } else if (hasDep("@modelcontextprotocol/sdk")) {
      starterId = "mcp-server";
      signals.push("package.json deps include @modelcontextprotocol/sdk");
    } else if (hasDep("electron-builder") || hasDep("electron")) {
      starterId = "electron-app";
      signals.push("package.json deps include electron/electron-builder");
    } else if (hasDep("expo")) {
      starterId = "react-native";
      signals.push("package.json deps include expo");
    } else if (engines.vscode || Object.values(scripts).some((s) => /\bvsce\b/.test(s))) {
      starterId = "vscode-extension";
      signals.push("package.json has engines.vscode or vsce script");
      if (typeof pkg.publisher === "string") vscodePublisher = pkg.publisher;
      if (typeof pkg.name === "string") vscodeName = pkg.name;
    } else if (pkg.bin && pkg.files) {
      starterId = "npm-package";
      signals.push("package.json has bin and files");
    }
  }

  const pyproject = safeReadText(join(repoPath, "pyproject.toml"));
  if (pyproject) {
    const ver = pyproject.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
    if (ver && !localVersion) {
      localVersion = ver[1];
      versionSource = "pyproject.toml";
    }
    const name = pyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (name) pyName = name[1];
    if (/^\s*(?:dependencies\s*=\s*\[[^\]]*)?["']?(?:mcp\[cli\]|fastmcp)["']?/im.test(pyproject)) {
      starterId = "mcp-server-python";
      signals.push("pyproject.toml has fastmcp/mcp dep");
    }
  }

  if (existsSync(join(repoPath, "wrangler.toml")) || existsSync(join(repoPath, "wrangler.jsonc"))) {
    starterId = starterId ?? "cloudflare-pages";
    signals.push("wrangler.toml present");
  }

  const manifest = safeReadJson(join(repoPath, "manifest.json"));
  if (manifest && manifest.manifest_version === 3) {
    starterId = "browser-extension";
    signals.push("manifest.json with manifest_version=3");
    if (!localVersion && typeof manifest.version === "string") {
      localVersion = manifest.version;
      versionSource = "manifest.json";
    }
    const bss = (manifest.browser_specific_settings ?? {}) as Record<string, unknown>;
    const gecko = (bss.gecko ?? {}) as Record<string, unknown>;
    if (typeof gecko.id === "string") geckoId = gecko.id;
  }

  if (!starterId && existsSync(join(repoPath, "Dockerfile"))) {
    starterId = "docker-deploy";
    signals.push("Dockerfile present");
  }

  return {
    starterId,
    signals,
    localVersion,
    versionSource,
    npmName,
    pyName,
    vscodePublisher,
    vscodeName,
    geckoId,
  };
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

  const sig = extractSignals(abs);
  const destinations: DestinationReport[] = [];
  const probes: Promise<DestinationReport>[] = [];

  // Per-starter destination plan
  switch (sig.starterId) {
    case "mcp-server":
    case "npm-package":
      if (sig.npmName) probes.push(probeNpm(sig.npmName, sig.localVersion, f, timeout));
      break;
    case "mcp-server-python":
      if (sig.pyName) probes.push(probePyPI(sig.pyName, sig.localVersion, f, timeout));
      break;
    case "vscode-extension":
      if (sig.vscodePublisher && sig.vscodeName) {
        probes.push(
          probeOpenVsx(sig.vscodePublisher, sig.vscodeName, sig.localVersion, f, timeout),
        );
        probes.push(
          probeVsMarketplace(sig.vscodePublisher, sig.vscodeName, sig.localVersion, f, timeout),
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
        probes.push(probeAmo(sig.geckoId, sig.localVersion, f, timeout));
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
    matchedStarter: { id: sig.starterId, signals: sig.signals },
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
