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

export function formatScaffoldReport(
  projectName: string,
  template: Template,
  result: ScaffoldResult,
): string {
  const steps = [`cd ${projectName}`, ...template.postSteps];
  return [
    `Project "${projectName}" created from ${template.name}`,
    `  Path: ${result.path}`,
    `  Extracted: ${result.filesExtracted} entries`,
    `  Customized: ${result.filesReplaced} files`,
    result.gitInitialized ? "  Git: initialized" : "  Git: not initialized",
    "",
    "Next steps:",
    ...steps.map((s) => `  ${s}`),
  ].join("\n");
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Characters that, if adjacent to a replacement key, mean the match is part of a
// LONGER identifier and must be left alone. Project names are `[A-Za-z0-9_-]+`,
// so a key flanked by any of these on either side is a sub-token of a bigger
// name (e.g. replacing "my-application" inside "my-application-utils") and is
// skipped. This is the "word boundary" the project's naming scheme needs —
// stricter than `\b`, which treats `-`/`_` as boundaries.
const IDENT_CHAR = /[A-Za-z0-9_-]/;

/**
 * Build a single regex that matches any of `keys` only when it stands as a
 * whole identifier token (not flanked by other identifier chars). Keys are
 * alternated longest-first so a longer key wins over a shorter one that is its
 * prefix (regex alternation is leftmost-longest only within a position when
 * ordered this way).
 */
function buildReplacementRegex(keys: string[]): RegExp {
  const alternation = keys
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  // Lookbehind/lookahead enforce the token boundary without consuming the
  // surrounding chars (so adjacent matches still work).
  return new RegExp(`(?<![A-Za-z0-9_-])(?:${alternation})(?![A-Za-z0-9_-])`, "g");
}

function applyReplacements(
  dir: string,
  replacements: Record<string, string>,
): number {
  const keys = Object.keys(replacements);
  if (keys.length === 0) return 0;
  // Single pass per file with a token-boundary regex. A single combined regex
  // (instead of sequential replaceAll per key) means an already-substituted
  // value can never be re-matched by a later key, and longest-key-first
  // ordering means "my-application-utils" is not clobbered by a "my-application"
  // key. The boundary guards stop a short name (e.g. "app") from corrupting an
  // embedding word (e.g. a description containing "application").
  void IDENT_CHAR; // documented above; boundary is inlined in the regex
  const re = buildReplacementRegex(keys);
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
    const next = content.replace(re, (match) => {
      const to = replacements[match];
      if (to === undefined) return match; // not an exact key (shouldn't happen)
      changed = true;
      return to;
    });
    if (changed) {
      writeFileSync(file, next, "utf-8");
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

  try {
    if (readdirSync(finalDest).length > 0) {
      throw new Error(`Directory "${finalDest}" already exists and is not empty`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // ENOENT is the happy path — destination doesn't exist yet.
  }

  const parentDir = dirname(finalDest);
  await mkdir(parentDir, { recursive: true });

  // Work in a sibling tmp dir so the final rename stays on the same filesystem
  // (atomic on POSIX) and cleanup is bounded to a single path.
  const tmpSuffix = `-incomplete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDest = join(parentDir, `.${basename(finalDest)}${tmpSuffix}`);

  // Once the build (download → extract → customize) succeeds and we begin the
  // finalize step, a failure must NOT delete the built tree — we'd be throwing
  // away good work. Flip this true right before finalize so the catch knows to
  // preserve workDest instead of cleaning it up.
  let buildComplete = false;

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

    // The build is done; from here a failure preserves workDest.
    buildComplete = true;

    // Finalize: move the built tree into place. The start-of-run guard checked
    // finalDest was absent/empty, but that was BEFORE the (network-bound)
    // download — plenty of time for another process to create files there. So
    // re-check IMMEDIATELY before the destructive rm and only remove finalDest
    // when it is still absent or empty; never blindly `rm -rf` a path that now
    // has content. NOTE: this narrows but does not eliminate the race — the
    // check-then-rm-then-rename window is not truly atomic on any filesystem.
    let existingEntries: string[] | null;
    try {
      existingEntries = readdirSync(finalDest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        existingEntries = null; // absent — the happy path
      } else {
        throw e;
      }
    }
    if (existingEntries !== null && existingEntries.length > 0) {
      throw new Error(
        `Destination "${finalDest}" became non-empty during scaffold; refusing to overwrite. ` +
          `The built project is preserved at "${workDest}".`,
      );
    }
    // Safe: finalDest is absent or empty. force:true tolerates the absent case
    // and the empty-dir case (rm removes the empty dir so rename can recreate).
    await rm(finalDest, { recursive: true, force: true });

    try {
      await rename(workDest, finalDest);
    } catch (renameErr) {
      // Rename failed (e.g. cross-device, permissions, a racing creator). Do
      // NOT delete workDest — a successful build must survive a finalize hiccup.
      logger.warn(
        `finalize rename failed (${(renameErr as Error).message}); the built project is preserved at "${workDest}".`,
      );
      throw renameErr;
    }

    logger.info(`done: ${finalDest}`);
    return {
      path: finalDest,
      filesExtracted,
      filesReplaced,
      gitInitialized,
    };
  } catch (err) {
    // Only clean up the tmp build dir if the failure happened DURING the build
    // (download/extract/customize). If the build completed and finalize failed,
    // leave workDest in place so the user keeps their scaffolded project.
    if (!buildComplete) {
      await rm(workDest, { recursive: true, force: true }).catch(() => {
        /* cleanup best effort */
      });
    }
    throw err;
  }
}
