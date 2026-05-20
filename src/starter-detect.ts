import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeReadJson, safeReadText } from "./audit-helpers.js";

export type StarterConfidence = "high" | "medium" | "low" | "none";

export type StarterId =
  | "mcp-server"
  | "mcp-server-python"
  | "npm-package"
  | "discord-bot"
  | "telegram-bot"
  | "browser-extension"
  | "vscode-extension"
  | "electron-app"
  | "react-native"
  | "cloudflare-pages"
  | "docker-deploy";

export type VersionSource = "package.json" | "pyproject.toml" | "manifest.json" | null;

/**
 * Everything an audit needs to know about a repo: which starter it resembles,
 * what version it claims locally, and the registry-specific identifiers
 * (npm name, PyPI name, VS publisher, AMO gecko.id) needed by audit_cd.
 *
 * Single source of truth — audit.ts and audit-cd.ts both consume this.
 */
export interface StarterSignals {
  id: StarterId | null;
  confidence: StarterConfidence;
  signals: string[];

  localVersion: string | null;
  versionSource: VersionSource;

  // Registry-specific identifiers (only meaningful for certain starter ids).
  npmName: string | null;
  pyName: string | null;
  vscodePublisher: string | null;
  vscodeName: string | null;
  geckoId: string | null;
}

function depFrom(pkg: Record<string, unknown>, name: string): boolean {
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  return name in deps || name in devDeps;
}

export function extractStarterSignals(repoPath: string): StarterSignals {
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    throw new Error(`Not a directory: ${repoPath}`);
  }

  const signals: string[] = [];
  let id: StarterId | null = null;
  let confidence: StarterConfidence = "none";
  let localVersion: string | null = null;
  let versionSource: VersionSource = null;
  let npmName: string | null = null;
  let pyName: string | null = null;
  let vscodePublisher: string | null = null;
  let vscodeName: string | null = null;
  let geckoId: string | null = null;

  // Python first: a Python-flavored MCP server wins over package.json signals
  // because pyproject.toml + fastmcp is a strong, unambiguous match.
  const pyproject = safeReadText(join(repoPath, "pyproject.toml"));
  if (pyproject) {
    const verMatch = pyproject.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
    if (verMatch) {
      localVersion = verMatch[1];
      versionSource = "pyproject.toml";
    }
    const nameMatch = pyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (nameMatch) pyName = nameMatch[1];
    if (/^\s*(?:dependencies\s*=\s*\[[^\]]*)?["']?(?:mcp\[cli\]|fastmcp)["']?/im.test(pyproject)) {
      id = "mcp-server-python";
      confidence = "high";
      signals.push("pyproject.toml has fastmcp/mcp dep");
    }
  }

  // Cloudflare Pages: wrangler.toml is unique to this template
  if (!id && (existsSync(join(repoPath, "wrangler.toml")) || existsSync(join(repoPath, "wrangler.jsonc")))) {
    id = "cloudflare-pages";
    confidence = "high";
    signals.push("wrangler.toml present");
  }

  // Browser extension: MV3 manifest.json is unambiguous
  const manifest = safeReadJson(join(repoPath, "manifest.json"));
  if (manifest && manifest.manifest_version === 3) {
    id = "browser-extension";
    confidence = "high";
    signals.push("manifest.json with manifest_version=3");
    if (!localVersion && typeof manifest.version === "string") {
      localVersion = manifest.version;
      versionSource = "manifest.json";
    }
    const bss = (manifest.browser_specific_settings ?? {}) as Record<string, unknown>;
    const gecko = (bss.gecko ?? {}) as Record<string, unknown>;
    if (typeof gecko.id === "string") geckoId = gecko.id;
  }

  // package.json content — fills in JS starter ids and registry identifiers
  const pkg = safeReadJson(join(repoPath, "package.json"));
  if (pkg) {
    if (typeof pkg.version === "string" && !localVersion) {
      localVersion = pkg.version;
      versionSource = "package.json";
    }
    if (typeof pkg.name === "string") npmName = pkg.name;
    if (typeof pkg.publisher === "string") vscodePublisher = pkg.publisher;
    if (typeof pkg.name === "string") vscodeName = pkg.name;

    const engines = (pkg.engines ?? {}) as Record<string, string>;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;

    if (!id) {
      if (depFrom(pkg, "discord.js")) {
        id = "discord-bot";
        confidence = "high";
        signals.push("package.json deps include discord.js");
      } else if (depFrom(pkg, "grammy")) {
        id = "telegram-bot";
        confidence = "high";
        signals.push("package.json deps include grammy");
      } else if (depFrom(pkg, "@modelcontextprotocol/sdk")) {
        id = "mcp-server";
        confidence = "high";
        signals.push("package.json deps include @modelcontextprotocol/sdk");
      } else if (depFrom(pkg, "electron-builder") || depFrom(pkg, "electron")) {
        id = "electron-app";
        confidence = "high";
        signals.push("package.json deps include electron/electron-builder");
      } else if (depFrom(pkg, "expo")) {
        id = "react-native";
        confidence = "high";
        signals.push("package.json deps include expo");
      } else if (engines.vscode || Object.values(scripts).some((s) => /\bvsce\b/.test(s))) {
        id = "vscode-extension";
        confidence = "high";
        signals.push("package.json has engines.vscode or vsce script");
      } else if (pkg.bin && pkg.files) {
        id = "npm-package";
        confidence = "medium";
        signals.push("package.json has bin and files (likely npm package)");
      }
    }
  }

  // Docker fallback: only useful when nothing else matched
  if (!id && existsSync(join(repoPath, "Dockerfile"))) {
    id = "docker-deploy";
    confidence = "low";
    signals.push("Dockerfile present, no JS/Py framework detected");
  }

  if (!id) signals.push("no matching signal");

  return {
    id,
    confidence,
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
