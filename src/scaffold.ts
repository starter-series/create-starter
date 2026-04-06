import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Template } from "./templates.js";

// ── tar extraction without node:tar (pure Node.js) ───────────────

async function downloadAndExtract(repo: string, dest: string): Promise<void> {
  const url = `https://github.com/${repo}/archive/refs/heads/main.tar.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);

  // Write tarball to temp file
  const tmpTar = join(dest, ".._template.tar.gz");
  mkdirSync(dest, { recursive: true });
  const fileStream = createWriteStream(tmpTar);
  await pipeline(res.body as any, fileStream);

  // Extract using tar CLI (available on all platforms)
  execSync(`tar -xzf "${tmpTar}" --strip-components=1 -C "${dest}"`, {
    stdio: "ignore",
  });
  rmSync(tmpTar);
}

// ── Variable replacement ─────────────────────────────────────────

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

/** Text file extensions worth scanning for variable replacement */
const TEXT_EXTS = new Set([
  ".json", ".ts", ".js", ".mjs", ".cjs",
  ".py", ".toml", ".cfg", ".ini",
  ".md", ".txt", ".yml", ".yaml",
  ".html", ".css", ".env", ".env.example",
  ".sh", ".bash", ".zsh",
  ".xml", ".plist",
  "",  // extensionless files (Dockerfile, Makefile, etc.)
]);

function isTextFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (path.endsWith("Dockerfile") || path.endsWith("Makefile")) return true;
  return TEXT_EXTS.has(ext);
}

interface Replacements {
  [placeholder: string]: string;
}

function applyReplacements(dir: string, replacements: Replacements): number {
  let filesChanged = 0;
  for (const file of walkFiles(dir)) {
    if (!isTextFile(file)) continue;
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    let changed = false;
    for (const [from, to] of Object.entries(replacements)) {
      if (content.includes(from)) {
        content = content.replaceAll(from, to);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(file, content, "utf-8");
      filesChanged++;
    }
  }
  return filesChanged;
}

// ── Public API ───────────────────────────────────────────────────

export interface ScaffoldOptions {
  template: Template;
  projectName: string;
  description?: string;
  outputDir?: string;
}

export interface ScaffoldResult {
  path: string;
  filesReplaced: number;
}

export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const dest = resolve(opts.outputDir ?? opts.projectName);

  if (existsSync(dest) && readdirSync(dest).length > 0) {
    throw new Error(`Directory "${dest}" already exists and is not empty`);
  }

  // 1. Download template
  await downloadAndExtract(opts.template.repo, dest);

  // 2. Build replacement map from template defaults → user values
  const replacements: Replacements = {};

  // Replace default project name with user's name
  const defaultName = opts.template.variables.find(
    (v) => v.key === "project_name",
  )?.default;
  if (defaultName && opts.projectName !== defaultName) {
    replacements[defaultName] = opts.projectName;
    // Also replace underscore variant (Python packages)
    replacements[defaultName.replaceAll("-", "_")] = opts.projectName.replaceAll("-", "_");
  }

  // Replace default description
  if (opts.description) {
    const defaultDesc = opts.template.variables.find(
      (v) => v.key === "project_description",
    )?.default;
    if (defaultDesc) {
      replacements[defaultDesc] = opts.description;
    }
  }

  // 3. Apply replacements
  const filesReplaced = applyReplacements(dest, replacements);

  // 4. Rename Python package directory if applicable
  if (defaultName && opts.projectName !== defaultName) {
    const pyDir = join(dest, "src", defaultName.replaceAll("-", "_"));
    const pyDirNew = join(dest, "src", opts.projectName.replaceAll("-", "_"));
    if (existsSync(pyDir)) {
      execSync(`mv "${pyDir}" "${pyDirNew}"`);
    }
  }

  // 5. Re-init git
  rmSync(join(dest, ".git"), { recursive: true, force: true });
  execSync("git init", { cwd: dest, stdio: "ignore" });

  return { path: dest, filesReplaced };
}
