import { execSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { archiveUrl, type Template } from "./templates.js";
import { extractTarball, fetchTarball, type FetchOptions } from "./download.js";
import { silentLogger, type Logger } from "./log.js";

export interface ScaffoldOptions {
  template: Template;
  projectName: string;
  description?: string;
  outputDir?: string;
  cwd?: string;
  logger?: Logger;
  initGit?: boolean;
  fetchOptions?: Omit<FetchOptions, "logger">;
}

export interface ScaffoldResult {
  path: string;
  filesExtracted: number;
  filesReplaced: number;
  gitInitialized: boolean;
}

// Allow only chars that are safe inside JS identifiers, Python module names,
// package.json "name", and pyproject names — after kebab-case is swapped to
// snake_case. Rejecting everything else avoids corrupting unrelated file
// content during plain-text substitution.
export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function validateProjectName(name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `Invalid project name "${name}": must start with [A-Za-z0-9] and contain only [A-Za-z0-9_-] (so placeholder substitution stays safe).`,
    );
  }
}

export function validateOutputDir(
  outputDir: string | undefined,
  projectName: string,
  cwd: string,
): string {
  if (!outputDir) {
    return resolve(cwd, projectName);
  }
  const resolved = resolve(cwd, outputDir);
  if (!isAbsolute(outputDir)) {
    const rel = relative(cwd, resolved);
    if (rel.split(sep).some((seg) => seg === "..")) {
      throw new Error(
        `Relative output directory "${outputDir}" escapes the working directory`,
      );
    }
  }
  return resolved;
}

const TEXT_EXTS = new Set([
  ".json", ".ts", ".js", ".mjs", ".cjs", ".tsx", ".jsx",
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
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (stat.isFile()) {
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

  content = content.replace(
    /^(\s*name\s*=\s*")([^"]+)(")/m,
    (match, p1: string, cur: string, p3: string) =>
      cur === names.defaultName ? `${p1}${names.projectName}${p3}` : match,
  );

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

function tryGitInit(cwd: string, logger: Logger): boolean {
  try {
    execSync("git init", { cwd, stdio: "ignore" });
    return true;
  } catch (err) {
    logger.warn(
      `git init failed (${(err as Error).message}); skipping. Run "git init" manually if needed.`,
    );
    return false;
  }
}

export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const logger = opts.logger ?? silentLogger;
  const cwd = opts.cwd ?? process.cwd();
  const initGit = opts.initGit ?? true;

  validateProjectName(opts.projectName);
  const finalDest = validateOutputDir(opts.outputDir, opts.projectName, cwd);

  if (existsSync(finalDest) && readdirSync(finalDest).length > 0) {
    throw new Error(`Directory "${finalDest}" already exists and is not empty`);
  }

  const parentDir = dirname(finalDest);
  await mkdir(parentDir, { recursive: true });

  // Work in a sibling tmp dir so the final rename stays on the same filesystem
  // (atomic on POSIX) and cleanup is bounded to a single path.
  const tmpSuffix = `-incomplete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDest = join(parentDir, `.${basename(finalDest)}${tmpSuffix}`);

  try {
    const url = archiveUrl(opts.template);
    const ref = opts.template.ref ?? "main";
    logger.info(`downloading ${opts.template.repo} (ref: ${ref})...`);
    const tarball = await fetchTarball(url, { ...opts.fetchOptions, logger });

    logger.info(`extracting...`);
    const filesExtracted = await extractTarball(tarball, workDest, logger);

    const replacements: Record<string, string> = {};
    const defaultName = opts.template.defaults.name;
    const defaultSnake = defaultName.replaceAll("-", "_");
    const projectSnake = opts.projectName.replaceAll("-", "_");

    if (opts.projectName !== defaultName) {
      replacements[defaultName] = opts.projectName;
      if (defaultSnake !== defaultName) {
        replacements[defaultSnake] = projectSnake;
      }
    }

    if (opts.description) {
      replacements[opts.template.defaults.description] = opts.description;
    }

    logger.info(`customizing project files...`);
    const filesReplaced = applyReplacements(workDest, replacements);

    if (opts.projectName !== defaultName) {
      const pyDir = join(workDest, "src", defaultSnake);
      const pyDirNew = join(workDest, "src", projectSnake);
      if (existsSync(pyDir)) {
        renameSync(pyDir, pyDirNew);
      }
      updatePyproject(join(workDest, "pyproject.toml"), {
        defaultName,
        projectName: opts.projectName,
        defaultSnake,
        projectSnake,
      });
    }

    // GitHub archive tarballs don't carry .git metadata, so the rm is a
    // defensive no-op, but kept for safety if a future mirror does.
    await rm(join(workDest, ".git"), { recursive: true, force: true });

    const gitInitialized = initGit ? tryGitInit(workDest, logger) : false;

    if (existsSync(finalDest)) {
      // Empty dir — remove so rename can take its place on POSIX.
      await rm(finalDest, { recursive: true, force: true });
    }
    await rename(workDest, finalDest);

    logger.info(`done: ${finalDest}`);
    return {
      path: finalDest,
      filesExtracted,
      filesReplaced,
      gitInitialized,
    };
  } catch (err) {
    await rm(workDest, { recursive: true, force: true }).catch(() => {
      /* cleanup best effort */
    });
    throw err;
  }
}
