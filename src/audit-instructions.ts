import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export type InstructionVerdict = "clean" | "advisory" | "attention";
export type InstructionRecommendation = "remove_duplicate" | "review_duplicate" | "keep_explicit";
export type InstructionRiskLabel =
  | "identity"
  | "pii"
  | "approval_required"
  | "test_required"
  | "strategy_requires_ratification"
  | "logs_or_errors"
  | "security_policy";

export interface InstructionOccurrence {
  path: string;
  line: number;
}

export interface InstructionExample {
  text: string;
  occurrences: InstructionOccurrence[];
  risks: InstructionRiskLabel[];
}

export interface InstructionDuplicate {
  id: string;
  text: string;
  path: string;
  repeats: number;
  occurrences: InstructionOccurrence[];
  risks: InstructionRiskLabel[];
  recommendation: Extract<InstructionRecommendation, "remove_duplicate" | "keep_explicit">;
}

export interface InstructionSurfaceOverlap {
  id: string;
  paths: string[];
  duplicateTexts: number;
  occurrences: number;
  risks: InstructionRiskLabel[];
  recommendation: Extract<InstructionRecommendation, "review_duplicate" | "keep_explicit">;
  examples: InstructionExample[];
}

export interface InstructionRiskSummary {
  id: string;
  risk: InstructionRiskLabel;
  findings: number;
  occurrences: number;
  paths: string[];
  examples: InstructionExample[];
}

export interface AuditInstructionsReport {
  repoPath: string;
  files: string[];
  duplicates: InstructionDuplicate[];
  surfaceOverlaps: InstructionSurfaceOverlap[];
  riskSummaries: InstructionRiskSummary[];
  overall: {
    verdict: InstructionVerdict;
    warnings: string[];
  };
}

interface Segment {
  text: string;
  line: number;
}

interface SegmentGroup {
  text: string;
  occurrences: InstructionOccurrence[];
  risks: InstructionRiskLabel[];
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

const RISK_INVENTORY_TERMS = [
  /\bidentity\b/i,
  /\bPII\b/i,
  /\bapproval\b/i,
  /\btests?\b/i,
  /\blogs?\b/i,
  /\berrors?\b/i,
  /\bsecurity\b/i,
  /\bstrategy ratification\b/i,
];

const RISK_RULES: { label: InstructionRiskLabel; patterns: RegExp[] }[] = [
  {
    label: "identity",
    patterns: [
      /\bpublic identity\b/i,
      /\bidentity\s+(?:rule|rules|policy|must|should|is|only|surface|surfaces)\b/i,
      /\bHeznpc\b.*\b(?:only|public|identity|author|external)\b/i,
      /\bcommit author\b/i,
      /\bsole author\b/i,
      /\bCo-Authored-By\b/i,
      /\bexternal surface\b/i,
      /정체성|실명|공개\s*이름|커밋\s*작성자/u,
    ],
  },
  {
    label: "pii",
    patterns: [
      /\bPII\b/i,
      /\bemail\s+(?:address|account|header|recipient)\b/i,
      /\bAPI key\b/i,
      /\b(?:api|access|auth|bearer|secret)\s+token\b/i,
      /\baccount identifier\b/i,
      /\breference number\b/i,
      /개인정보|이메일\s*(?:주소|계정)|계정\s*식별자|API\s*키|비밀\s*키|시크릿|(?:토큰|식별자).*(?:노출|공개|저장|포함|금지|마스킹|redact)/u,
    ],
  },
  {
    label: "approval_required",
    patterns: [
      /\bexplicit approval\b/i,
      /\bHITL approval\b/i,
      /\bper-call approval\b/i,
      /\bapproval\s+(?:gate|gated|required|requirement|each invocation)\b/i,
      /\bask before\b/i,
      /\bforce push\b/i,
      /\bhard reset\b/i,
      /\bbranch -D\b/i,
      /\bbroad scan\b/i,
      /승인|묻고|물어보고|광범위\s*스캔|강제\s*푸시|하드\s*리셋/u,
    ],
  },
  {
    label: "test_required",
    patterns: [
      /\bnpm\s+test\b/i,
      /\bpytest\b/i,
      /\b(?:actually\s+run|run|rerun|execute)\s+(?:the\s+)?(?:unit\s+|integration\s+|e2e\s+)?tests?\b/i,
      /\brun\s+(?:the\s+)?(?:full\s+|complete\s+|entire\s+)?test\s+suite\b/i,
      /\btest\s+suite\s+in\s+(?:CI|continuous integration)\b/i,
      /\b(?:CI|continuous integration)\s+(?:gate|check|status|workflow|run|pass|green)\b/i,
      /\bverification command\b/i,
      /(?:테스트|검증)\s*(?:명령|실행|통과|완료|결과|게이트|CI)|(?:실행|돌리|확인).{0,12}테스트/u,
    ],
  },
  {
    label: "strategy_requires_ratification",
    patterns: [
      /\bratification\b/i,
      /\bowner stated\b/i,
      /\bnew strategy\b/i,
      /\bstrategy\s+(?:text|choice|constraint|requires|enters)\b/i,
      /\bpositioning\b/i,
      /\bKPI\b/i,
      /\bconstraint\s+text\b/i,
      /전략|포지셔닝|제약|소유자|확정/u,
    ],
  },
  {
    label: "logs_or_errors",
    patterns: [
      /\b(?:logs?|errors?)\b.*\b(?:compress|redact|report|excerpt|output|stack trace|stderr|stdout|build output)\b/i,
      /\b(?:compress|redact|report)\b.*\b(?:logs?|errors?)\b/i,
      /\berror\s+(?:message|log|output|trace|handling|report|excerpt)s?\b/i,
      /\btraceback\b/i,
      /\bstack trace\b/i,
      /\bstderr\b/i,
      /\bstdout\b/i,
      /\bbuild output\b/i,
      /로그|에러|오류|스택\s*트레이스|빌드\s*출력/u,
    ],
  },
  {
    label: "security_policy",
    patterns: [
      /\bsecurity\s+(?:policy|advisory|review|gate|rule|rules|permission|permissions|boundary|requirement|requirements|note|notes)\b/i,
      /\bCVE\b/i,
      /\bvulnerability\b/i,
      /\bsecrets?\b/i,
      /\b(?:validate|sanitize|escape)\s+(?:and\s+)?(?:sanitize\s+)?(?:all\s+)?user\s+input\b/i,
      /\b(?:user\s+)?input\b.*\b(?:injection|xss|sql injection)\b/i,
      /\b(?:prevent|avoid|block)\s+(?:path[-\s]?|sql\s+|command\s+|prompt\s+)?injection\b/i,
      /\b(?:HMAC[-\s]chained\s+)?audit\s+(?:log|chain|entries?)\b/i,
      /\bbypass(?:es|ing)?\s+(?:the\s+)?audit\s+chain\b/i,
      /\b(?:sandbox|filesystem|network|approval)\s+permissions?\b/i,
      /보안\s*(?:정책|검토|게이트|규칙|요구사항)|취약점|권한\s*(?:정책|승인|상승)|시크릿|인젝션|입력\s*(?:검증|정제|필터링)/u,
    ],
  },
];

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function isInstructionFile(path: string): boolean {
  const name = basename(path);
  if (DOC_NAMES.has(name)) return true;
  const normalized = normalizePath(path);
  return normalized.includes("/.github/instructions/") && name.endsWith(".instructions.md");
}

function discoverInstructionFiles(root: string): string[] {
  const found: string[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(path);
      } else if (entry.isFile() && isInstructionFile(path)) {
        found.push(normalizePath(relative(root, path)));
      }
    }
  }
  walk(root);
  return found.sort((left, right) => left.localeCompare(right));
}

function normalizeSegment(text: string): string {
  return text
    .trim()
    .replace(/^\s{0,4}(?:[-*+]|\d+[.)])\s+/u, "")
    .replace(/\s+/gu, " ");
}

function extractSegments(source: string): Segment[] {
  const segments: Segment[] = [];
  let paragraph: string[] = [];
  let paragraphStart = 1;
  let listItem: string[] = [];
  let listItemStart = 1;
  let inFence = false;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = normalizeSegment(paragraph.join(" "));
    if (text.length > 0) segments.push({ text, line: paragraphStart });
    paragraph = [];
  };
  const flushListItem = (): void => {
    if (listItem.length === 0) return;
    const text = normalizeSegment(listItem.join(" "));
    if (text.length > 0) segments.push({ text, line: listItemStart });
    listItem = [];
  };
  const flush = (): void => {
    flushParagraph();
    flushListItem();
  };

  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";
    const stripped = line.trim();
    const isListMarker = /^\s{0,4}(?:[-*+]|\d+[.)])\s+/u.test(line);

    if (/^(```|~~~)/u.test(stripped)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (stripped.length === 0 || stripped.startsWith("#") || stripped.startsWith(">")) {
      flush();
      continue;
    }
    if (/^\|.*\|$/u.test(stripped)) {
      flush();
      continue;
    }
    if (/^(?: {4}|\t)/u.test(line) && listItem.length === 0) {
      flush();
      continue;
    }
    if (isListMarker) {
      flush();
      listItemStart = lineNumber;
      listItem = [line];
      continue;
    }
    if (listItem.length > 0) {
      listItem.push(stripped);
      continue;
    }
    if (paragraph.length === 0) paragraphStart = lineNumber;
    paragraph.push(stripped);
  }
  flush();
  return segments;
}

function isRiskCategoryInventory(text: string): boolean {
  if (!/\b(?:risk labels?|risk categories|high-risk rules?|high-risk labels?|risk rules?)\b/i.test(text)) return false;
  if (!/\b(?:mention|mentions|include|includes|category|categories|label|labels|listed)\b/i.test(text)) return false;
  return RISK_INVENTORY_TERMS.filter((pattern) => pattern.test(text)).length >= 4;
}

function classifyRisks(text: string): InstructionRiskLabel[] {
  if (isRiskCategoryInventory(text)) return [];
  const labels: InstructionRiskLabel[] = [];
  for (const rule of RISK_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) labels.push(rule.label);
  }
  return [...new Set(labels)].sort((left, right) => left.localeCompare(right));
}

function isHighRisk(labels: InstructionRiskLabel[]): boolean {
  return labels.length > 0;
}

function pathsFor(occurrences: InstructionOccurrence[]): string[] {
  return [...new Set(occurrences.map((occurrence) => occurrence.path))].sort((left, right) => left.localeCompare(right));
}

function hasSameFileRepeat(occurrences: InstructionOccurrence[]): boolean {
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) counts.set(occurrence.path, (counts.get(occurrence.path) ?? 0) + 1);
  return [...counts.values()].some((count) => count > 1);
}

function sameFileRepeatPath(occurrences: InstructionOccurrence[]): string | null {
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) counts.set(occurrence.path, (counts.get(occurrence.path) ?? 0) + 1);
  return [...counts.entries()].find(([, count]) => count > 1)?.[0] ?? null;
}

function groupSegments(root: string, files: string[]): SegmentGroup[] {
  const grouped = new Map<string, InstructionOccurrence[]>();
  for (const file of files) {
    const text = readFileSync(resolve(root, file), "utf8");
    for (const segment of extractSegments(text)) {
      const occurrences = grouped.get(segment.text) ?? [];
      occurrences.push({ path: file, line: segment.line });
      grouped.set(segment.text, occurrences);
    }
  }
  return [...grouped.entries()]
    .map(([text, occurrences]) => ({ text, occurrences, risks: classifyRisks(text) }))
    .sort((left, right) => left.text.localeCompare(right.text));
}

function findDuplicates(groups: SegmentGroup[], minChars: number): InstructionDuplicate[] {
  return groups
    .filter((group) => group.text.length >= minChars && hasSameFileRepeat(group.occurrences))
    .map((group, index) => {
      const path = sameFileRepeatPath(group.occurrences) ?? group.occurrences[0]?.path ?? "";
      const occurrences = group.occurrences.filter((occurrence) => occurrence.path === path);
      return {
        id: `DUP_${String(index + 1).padStart(2, "0")}`,
        text: group.text,
        path,
        repeats: occurrences.length,
        occurrences,
        risks: group.risks,
        recommendation: isHighRisk(group.risks) ? "keep_explicit" : "remove_duplicate",
      };
    });
}

function findSurfaceOverlaps(groups: SegmentGroup[], minChars: number): InstructionSurfaceOverlap[] {
  const byPathSet = new Map<string, InstructionSurfaceOverlap>();
  for (const group of groups) {
    const paths = pathsFor(group.occurrences);
    if (group.text.length < minChars || paths.length < 2) continue;
    const key = paths.join("\0");
    const existing = byPathSet.get(key) ?? {
      id: "",
      paths,
      duplicateTexts: 0,
      occurrences: 0,
      risks: [],
      recommendation: "review_duplicate" as const,
      examples: [],
    };
    existing.duplicateTexts += 1;
    existing.occurrences += group.occurrences.length;
    existing.risks = [...new Set([...existing.risks, ...group.risks])].sort((left, right) => left.localeCompare(right));
    existing.recommendation = isHighRisk(existing.risks) ? "keep_explicit" : "review_duplicate";
    existing.examples.push({ text: group.text, occurrences: group.occurrences, risks: group.risks });
    byPathSet.set(key, existing);
  }
  return [...byPathSet.values()]
    .sort((left, right) => right.duplicateTexts - left.duplicateTexts || left.paths.join("\0").localeCompare(right.paths.join("\0")))
    .map((overlap, index) => ({ ...overlap, id: `SURF_${String(index + 1).padStart(2, "0")}` }));
}

function findRiskSummaries(groups: SegmentGroup[]): InstructionRiskSummary[] {
  const byRisk = new Map<InstructionRiskLabel, InstructionExample[]>();
  for (const group of groups) {
    for (const risk of group.risks) {
      const examples = byRisk.get(risk) ?? [];
      examples.push({ text: group.text, occurrences: group.occurrences, risks: group.risks });
      byRisk.set(risk, examples);
    }
  }
  return [...byRisk.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([risk, examples], index) => {
      const occurrences = examples.flatMap((example) => example.occurrences);
      return {
        id: `RISK_${String(index + 1).padStart(2, "0")}`,
        risk,
        findings: examples.length,
        occurrences: occurrences.length,
        paths: pathsFor(occurrences),
        examples,
      };
    });
}

export async function auditInstructions(repoPath = process.cwd()): Promise<AuditInstructionsReport> {
  const root = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  const files = discoverInstructionFiles(root);
  const groups = groupSegments(root, files);
  const duplicates = findDuplicates(groups, 40);
  const surfaceOverlaps = findSurfaceOverlaps(groups, 40);
  const riskSummaries = findRiskSummaries(groups);
  const warnings: string[] = [];
  if (files.length === 0) warnings.push("No agent instruction files found.");
  const hasReviewFindings = duplicates.length > 0 || surfaceOverlaps.length > 0;
  const hasAdvisoryFindings = riskSummaries.length > 0;
  return {
    repoPath: root,
    files,
    duplicates,
    surfaceOverlaps,
    riskSummaries,
    overall: {
      verdict: hasReviewFindings ? "attention" : hasAdvisoryFindings ? "advisory" : "clean",
      warnings,
    },
  };
}

function formatLocations(occurrences: InstructionOccurrence[]): string {
  return occurrences.map((occurrence) => `${occurrence.path}:${occurrence.line}`).join(", ");
}

function firstExample(examples: InstructionExample[]): string {
  return examples[0]?.text ?? "";
}

export function formatAuditInstructionsReport(report: AuditInstructionsReport): string {
  const out = [
    "Instruction Audit",
    `repo: ${report.repoPath}`,
    `files: ${report.files.length}`,
    `duplicate candidates: ${report.duplicates.length}`,
    `surface overlaps: ${report.surfaceOverlaps.length}`,
    `risk summaries: ${report.riskSummaries.length}`,
    `verdict: ${report.overall.verdict}`,
    "",
  ];
  if (report.overall.warnings.length > 0) {
    out.push("Warnings:");
    for (const warning of report.overall.warnings) out.push(`- ${warning}`);
    out.push("");
  }
  if (report.duplicates.length > 0) {
    out.push("Duplicate candidates:");
    for (const duplicate of report.duplicates) {
      out.push(`- ${duplicate.id} ${duplicate.recommendation} ${formatLocations(duplicate.occurrences)}`);
      out.push(`  ${duplicate.text}`);
    }
    out.push("");
  }
  if (report.surfaceOverlaps.length > 0) {
    out.push("Surface overlaps:");
    for (const overlap of report.surfaceOverlaps) {
      out.push(`- ${overlap.id} ${overlap.recommendation} paths=${overlap.paths.join(", ")}`);
      out.push(`  ${firstExample(overlap.examples)}`);
    }
    out.push("");
  }
  if (report.riskSummaries.length > 0) {
    out.push("Advisory risk summaries:");
    out.push("- Keyword-based reminders only; not exhaustive safety or semantic drift detection.");
    for (const summary of report.riskSummaries) {
      out.push(`- ${summary.id} ${summary.risk} findings=${summary.findings} paths=${summary.paths.join(", ")}`);
      out.push(`  ${firstExample(summary.examples)}`);
    }
    out.push("");
  }
  return `${out.join("\n")}\n`;
}
