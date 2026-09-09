import { readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, relative, resolve, sep } from "node:path";
export interface InstructionDocument {
  path: string; absolutePath: string; text: string; sha256: string;
  isSymlink: boolean; symlinkTarget: string | null;
}
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "fixtures",
  "node_modules",
  "out",
  "test",
  "tests",
  "tmp",
  "worktrees",
]);

const DOC_NAMES = new Set([
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "GEMINI.md",
  "copilot-instructions.md",
]);


const normalize = (path: string) => path.split(sep).join("/");
function instructionPath(path: string): boolean {
  if (DOC_NAMES.has(basename(path)) || basename(path) === 'CLAUDE.local.md') return true;
  return path === '.cursorrules' || path === '.agents/agents.md' ||
    /(?:^|\/)(?:\.claude\/(?:rules|skills)|\.agents\/(?:rules|skills|workflows)|\.cursor\/rules)\/.+\.(?:md|mdc)$/.test(path) ||
    /(?:^|\/)\.github\/instructions\/.+\.instructions\.md$/.test(path);
}
export function scanInstructions(root: string): InstructionDocument[] {
  const documents: InstructionDocument[] = [];
  const contents = new Map<string, string>();
  const realRoot = realpathSync(root);
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      const absolutePath = resolve(directory,entry.name);
      if (entry.isDirectory()) { if (!IGNORED_DIRS.has(entry.name) && entry.name !== '.starter-series') walk(absolutePath); continue; }
      const path = normalize(relative(root,absolutePath));
      if ((!entry.isFile() && !entry.isSymbolicLink()) || !instructionPath(path)) continue;
      const isSymlink = entry.isSymbolicLink();
      const symlinkTarget = isSymlink ? normalize(relative(root,resolve(dirname(absolutePath),readlinkSync(absolutePath)))) : null;
      const real = realpathSync(absolutePath);
      const rel = relative(realRoot,real);
      const outside = rel === '..' || rel.startsWith('..'+sep);
      if (!outside && !statSync(real).isFile()) continue;
      if (!outside && !contents.has(real)) contents.set(real,readFileSync(real,'utf8'));
      const text = outside ? '' : contents.get(real)!;
      documents.push({path,absolutePath,text,isSymlink,symlinkTarget,sha256:createHash('sha256').update(text).digest('hex')});
    }
  }
  walk(root);
  return documents.sort((a,b)=>a.path.localeCompare(b.path));
}
