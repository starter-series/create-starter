import { dirname, relative, resolve, sep } from "node:path";
import type { InstructionDocument } from "./scan.js";
const SOURCES_SCHEMA_VERSION = 1;
interface SourceWarning { code: string; message: string; path: string; }

export type SourceRole = "canonical" | "import_alias" | "symlink_alias" | "verbatim_mirror" | "contextual_layer" | "local_override";
export type SourceStrategy = "standalone" | "single_source" | "mixed" | "unresolved";

export interface SourceImportReference {
  specifier: string;
  path: string;
  existsInScan: boolean;
}

export interface SourceFile {
  path: string;
  role: SourceRole;
  evidence: string;
  imports: SourceImportReference[];
  isSymlink: boolean;
  symlinkTarget: string | null;
  byteIdenticalTo: string | null;
  sha256: string;
}

export interface SourceReport {
  schemaVersion: typeof SOURCES_SCHEMA_VERSION;
  files: SourceFile[];
  canonicalPath: string | null;
  sourceStrategy: SourceStrategy;
  warnings: SourceWarning[];
}

type LoadedSource = InstructionDocument & { imports: SourceImportReference[] };

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function displayPath(path: string, root: string): string {
  const relativePath = normalizePath(relative(root, path));
  return relativePath.startsWith("..") ? normalizePath(path) : relativePath || ".";
}

function stripCodeRegions(text: string): string {
  const lines: string[] = [];
  let fenceMarker: string | null = null;
  for (const line of text.split(/\r?\n/u)) {
    const fence = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fenceMarker) {
      if (fence?.[1] && fence[1].startsWith(fenceMarker[0] ?? "") && fence[1].length >= fenceMarker.length) fenceMarker = null;
      lines.push("");
      continue;
    }
    if (fence?.[1]) {
      fenceMarker = fence[1];
      lines.push("");
      continue;
    }
    lines.push(line);
  }
  // Replace inline code spans with a non-whitespace placeholder so a stripped
  // span cannot fabricate the whitespace boundary the import syntax requires.
  return lines.join("\n").replace(/``[^\n]*?``|`[^`\n]*`/gu, "\u0000");
}

function importReferences(text: string, filePath: string, root: string, scannedPaths: Set<string>): SourceImportReference[] {
  const references: SourceImportReference[] = [];
  const seen = new Set<string>();
  const pattern = /(?<=^|\s)@([^\s"'<>()[\]{}]+?\.(?:md|txt))/gimu;
  for (const match of stripCodeRegions(text).matchAll(pattern)) {
    const rawSpecifier = match[1];
    if (!rawSpecifier) continue;
    const specifier = rawSpecifier.replace(/[.,;:]+$/u, "");
    const absolute = resolve(dirname(filePath), specifier);
    const path = displayPath(absolute, root);
    const key = `${specifier}\0${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ specifier, path, existsInScan: scannedPaths.has(path) });
  }
  return references;
}

const contextualDirectoryPattern = /(?:^|\/)(?:\.claude\/(?:rules|skills)\/|\.agents\/(?:rules|skills|workflows)\/|\.cursor\/rules\/|\.github\/instructions\/)/u;
const contextualBasenames = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);

function isContextualLayerPath(path: string): boolean {
  if (contextualDirectoryPattern.test(path)) return true;
  const name = path.split("/").at(-1) ?? path;
  if (name === "CLAUDE.local.md") return true;
  if (!path.includes("/")) return false;
  // Memory files directly under .claude/ or .agents/ are alternate root
  // locations for the same memory, not per-directory layers.
  const directory = path.slice(0, path.lastIndexOf("/"));
  if (directory === ".claude" || directory === ".agents") return false;
  return contextualBasenames.has(name);
}

function hasInstructionTextBeyondImports(text: string): boolean {
  const withoutImports = stripCodeRegions(text).replace(/(?<=^|\s)@[^\s"'<>()[\]{}]+/gmu, " ");
  for (const line of withoutImports.split(/\r?\n/u)) {
    const stripped = line.trim();
    if (stripped.length === 0 || stripped.startsWith("#")) continue;
    if (/[\p{L}\p{N}]/u.test(stripped.replace(/^(?:[-*+]|\d+[.)])\s*/u, ""))) return true;
  }
  return false;
}

function canonicalPreference(path: string): number {
  if (path === "AGENTS.md") return 0;
  if (path.endsWith("/AGENTS.md")) return 10;
  if (path === "CLAUDE.md") return 2;
  if (path === "GEMINI.md") return 3;
  if (path === ".github/copilot-instructions.md") return 4;
  if (path === ".agents/agents.md") return 5;
  return 10;
}

function chooseCanonical(files: LoadedSource[]): string | null {
  if (files.length === 0) return null;
  const scanned = new Set(files.map((file) => file.path));
  const inbound = new Map<string, number>();
  for (const file of files) {
    if (file.symlinkTarget && scanned.has(file.symlinkTarget)) {
      inbound.set(file.symlinkTarget, (inbound.get(file.symlinkTarget) ?? 0) + 2);
    }
    for (const reference of file.imports) {
      if (reference.existsInScan) inbound.set(reference.path, (inbound.get(reference.path) ?? 0) + 1);
    }
  }

  return [...files]
    .sort((left, right) => {
      const inboundDelta = (inbound.get(right.path) ?? 0) - (inbound.get(left.path) ?? 0);
      if (inboundDelta !== 0) return inboundDelta;
      const preferenceDelta = canonicalPreference(left.path) - canonicalPreference(right.path);
      if (preferenceDelta !== 0) return preferenceDelta;
      return left.path.localeCompare(right.path);
    })[0]?.path ?? null;
}

function roleFor(file: LoadedSource, canonical: LoadedSource | undefined, scannedPaths: Set<string>): Pick<SourceFile, "role" | "evidence" | "byteIdenticalTo"> {
  if (!canonical) return { role: "local_override", evidence: "no canonical file selected", byteIdenticalTo: null };
  if (file.path === canonical.path) return { role: "canonical", evidence: "selected source file", byteIdenticalTo: null };
  if (file.symlinkTarget === canonical.path) {
    return { role: "symlink_alias", evidence: `symlink to ${canonical.path}`, byteIdenticalTo: null };
  }
  const canonicalImport = file.imports.find((reference) => reference.path === canonical.path);
  const aliasEligible = !hasInstructionTextBeyondImports(file.text);
  if (canonicalImport && aliasEligible) {
    return { role: "import_alias", evidence: `imports @${canonicalImport.specifier}`, byteIdenticalTo: null };
  }
  if (file.sha256 === canonical.sha256) {
    return { role: "verbatim_mirror", evidence: `byte-identical to ${canonical.path}`, byteIdenticalTo: canonical.path };
  }
  if (isContextualLayerPath(file.path)) {
    return { role: "contextual_layer", evidence: `supplemental layer loaded alongside ${canonical.path}`, byteIdenticalTo: null };
  }
  if (file.isSymlink && file.symlinkTarget && !scannedPaths.has(file.symlinkTarget)) {
    return { role: "symlink_alias", evidence: `symlink target outside scan: ${file.symlinkTarget}`, byteIdenticalTo: null };
  }
  const scannedImport = file.imports.find((reference) => reference.existsInScan);
  if (scannedImport && aliasEligible) {
    return { role: "import_alias", evidence: `imports @${scannedImport.specifier}`, byteIdenticalTo: null };
  }
  if (canonicalImport) {
    return {
      role: "local_override",
      evidence: `imports @${canonicalImport.specifier} but adds instruction text beyond ${canonical.path}`,
      byteIdenticalTo: null,
    };
  }
  return { role: "local_override", evidence: `differs from ${canonical.path}`, byteIdenticalTo: null };
}

function sourceStrategy(files: SourceFile[], canonicalPath: string | null): SourceStrategy {
  if (files.length <= 1) return "standalone";
  const nonCanonical = files.filter((file) => file.role !== "canonical" && file.role !== "contextual_layer");
  if (nonCanonical.length === 0) return "standalone";
  if (
    canonicalPath &&
    nonCanonical.every(
      (file) =>
        (file.role === "symlink_alias" && file.symlinkTarget === canonicalPath) ||
        (file.role === "import_alias" && file.imports.some((reference) => reference.path === canonicalPath)),
    )
  ) {
    return "single_source";
  }
  if (files.some((file) => file.role === "canonical")) return "mixed";
  return "unresolved";
}

function sourceWarnings(files: SourceFile[], canonicalPath: string | null): SourceWarning[] {
  const warnings: SourceWarning[] = [];
  for (const file of files) {
    if (file.role === "verbatim_mirror") {
      warnings.push({
        path: file.path,
        code: "VERBATIM_MIRROR_NOT_LINKED",
        message: `${file.path} is byte-identical to ${file.byteIdenticalTo ?? canonicalPath} but is not symlink/import-backed`,
      });
    }
    if (file.role === "local_override" && canonicalPath) {
      warnings.push({
        path: file.path,
        code: "LOCAL_OVERRIDE",
        message: `${file.path} differs from ${canonicalPath}; confirm this override is intentional`,
      });
    }
    if (file.isSymlink && file.symlinkTarget && !files.some((candidate) => candidate.path === file.symlinkTarget)) {
      warnings.push({
        path: file.path,
        code: "SYMLINK_TARGET_OUTSIDE_SCAN",
        message: `${file.path} points to ${file.symlinkTarget}, which is outside the scanned instruction files`,
      });
    }
    for (const reference of file.imports) {
      if (!reference.existsInScan) {
        warnings.push({
        path: file.path,
          code: "IMPORT_TARGET_OUTSIDE_SCAN",
          message: `${file.path} imports @${reference.specifier}, which is outside the scanned instruction files`,
        });
      }
    }
  }
  return warnings;
}

export function analyzeInstructionSources(documents: InstructionDocument[], root: string, configuredCanonical?: string): SourceReport {
  const resolvedRoot = resolve(root);
  const scannedPaths = new Set(documents.map(file => file.path));
  const loaded: LoadedSource[] = documents.map((file) => ({
    ...file,
    imports: importReferences(file.text, file.absolutePath, resolvedRoot, scannedPaths),
  }));
  if (configuredCanonical && !scannedPaths.has(configuredCanonical)) throw new Error(`Canonical instruction file was not discovered: ${configuredCanonical}`);
  const canonicalPath = configuredCanonical ?? chooseCanonical(loaded);
  const canonical = loaded.find((file) => file.path === canonicalPath);

  const files: SourceFile[] = loaded
    .map((file) => {
      const role = roleFor(file, canonical, scannedPaths);
      return {
        path: file.path,
        role: role.role,
        evidence: role.evidence,
        imports: file.imports,
        isSymlink: file.isSymlink,
        symlinkTarget: file.symlinkTarget,
        byteIdenticalTo: role.byteIdenticalTo,
        sha256: file.sha256,
      };
    })
    .sort((left, right) => canonicalPreference(left.path) - canonicalPreference(right.path) || left.path.localeCompare(right.path));

  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    files,
    canonicalPath,
    sourceStrategy: sourceStrategy(files, canonicalPath),
    warnings: sourceWarnings(files, canonicalPath),
  };
}
