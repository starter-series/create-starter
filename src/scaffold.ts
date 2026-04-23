import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Template } from "./templates.js";

async function downloadAndExtract(repo: string, dest: string): Promise<void> {
  const url = `https://github.com/${repo}/archive/refs/heads/main.tar.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);

  mkdirSync(dest, { recursive: true });
  const tmpTar = join(dest, "_template.tar.gz");
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
  if (Object.keys(replacements).length === 0) return 0;
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

// Allow only chars that are safe inside both JS identifiers (after - → _ swap),
// Python module names (after - → _), package.json "name", and pyproject names.
// Rejecting everything else avoids corrupting unrelated file content during
// plain-text substitution (e.g. regex metacharacters, quotes, path separators).
export const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

export function validateProjectName(name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `Invalid project name "${name}": only [A-Za-z0-9_-] are allowed ` +
        `(so placeholder substitution stays safe).`,
    );
  }
}

export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  validateProjectName(opts.projectName);

  const dest = resolve(opts.outputDir ?? opts.projectName);

  if (existsSync(dest) && readdirSync(dest).length > 0) {
    throw new Error(`Directory "${dest}" already exists and is not empty`);
  }

  await downloadAndExtract(opts.template.repo, dest);

  const replacements: Record<string, string> = {};
  const defaultName = opts.template.defaults.name;
  const defaultSnake = defaultName.replaceAll("-", "_");
  const projectSnake = opts.projectName.replaceAll("-", "_");

  if (opts.projectName !== defaultName) {
    replacements[defaultName] = opts.projectName;
    replacements[defaultSnake] = projectSnake;
  }

  if (opts.description) {
    replacements[opts.template.defaults.description] = opts.description;
  }

  const filesReplaced = applyReplacements(dest, replacements);

  if (opts.projectName !== defaultName) {
    const pyDir = join(dest, "src", defaultSnake);
    const pyDirNew = join(dest, "src", projectSnake);
    if (existsSync(pyDir)) {
      renameSync(pyDir, pyDirNew);
    }

    // The generic text replace already rewrites `my-mcp-server` and
    // `my_mcp_server` in pyproject.toml. But hatchling's wheel target can
    // declare `packages = ["src/my_mcp_server"]` explicitly, and the
    // `[project] name` line is the source of truth for PyPI. Do a second,
    // targeted pass so these stay consistent even if the template evolves.
    updatePyproject(join(dest, "pyproject.toml"), {
      defaultName,
      projectName: opts.projectName,
      defaultSnake,
      projectSnake,
    });
  }

  rmSync(join(dest, ".git"), { recursive: true, force: true });
  execSync("git init", { cwd: dest, stdio: "ignore" });

  return { path: dest, filesReplaced };
}

export function updatePyproject(
  path: string,
  names: {
    defaultName: string;
    projectName: string;
    defaultSnake: string;
    projectSnake: string;
  },
): void {
  if (!existsSync(path)) return;
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  const before = content;

  // [project] name = "..."
  content = content.replace(
    /^(\s*name\s*=\s*")([^"]+)(")/m,
    (_m, p1: string, cur: string, p3: string) =>
      cur === names.defaultName ? `${p1}${names.projectName}${p3}` : _m,
  );

  // [tool.hatch.build.targets.wheel] packages = [...] — rewrite any entry
  // referencing the old snake_case package dir.
  content = content.replaceAll(
    `"src/${names.defaultSnake}"`,
    `"src/${names.projectSnake}"`,
  );
  content = content.replaceAll(
    `'src/${names.defaultSnake}'`,
    `'src/${names.projectSnake}'`,
  );

  if (content !== before) {
    writeFileSync(path, content, "utf-8");
  }
}
