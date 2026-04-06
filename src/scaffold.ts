import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Template } from "./templates.js";

async function downloadAndExtract(repo: string, dest: string): Promise<void> {
  const url = `https://github.com/${repo}/archive/refs/heads/main.tar.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);

  const tmpTar = join(dest, ".._template.tar.gz");
  mkdirSync(dest, { recursive: true });
  const { Readable } = await import("node:stream");
  await pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    createWriteStream(tmpTar),
  );

  execSync(`tar -xzf "${tmpTar}" --strip-components=1 -C "${dest}"`, {
    stdio: "ignore",
  });
  rmSync(tmpTar);
}

const TEXT_EXTS = new Set([
  ".json", ".ts", ".js", ".mjs", ".cjs",
  ".py", ".toml", ".cfg", ".ini",
  ".md", ".txt", ".yml", ".yaml",
  ".html", ".css",
  ".sh", ".bash", ".zsh",
  ".xml", ".plist",
]);

function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === "" || TEXT_EXTS.has(ext);
}

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

function applyReplacements(
  dir: string,
  replacements: Record<string, string>,
): number {
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

  await downloadAndExtract(opts.template.repo, dest);

  const replacements: Record<string, string> = {};
  const defaultName = opts.template.defaults.name;

  if (opts.projectName !== defaultName) {
    replacements[defaultName] = opts.projectName;
    replacements[defaultName.replaceAll("-", "_")] =
      opts.projectName.replaceAll("-", "_");
  }

  if (opts.description) {
    replacements[opts.template.defaults.description] = opts.description;
  }

  const filesReplaced = applyReplacements(dest, replacements);

  if (opts.projectName !== defaultName) {
    const pyDir = join(dest, "src", defaultName.replaceAll("-", "_"));
    const pyDirNew = join(dest, "src", opts.projectName.replaceAll("-", "_"));
    if (existsSync(pyDir)) {
      execSync(`mv "${pyDir}" "${pyDirNew}"`);
    }
  }

  rmSync(join(dest, ".git"), { recursive: true, force: true });
  execSync("git init", { cwd: dest, stdio: "ignore" });

  return { path: dest, filesReplaced };
}
