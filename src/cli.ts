import { parseArgs } from "node:util";
import { stderrLogger } from "./log.js";
import { formatScaffoldReport, scaffold } from "./scaffold.js";
import { getTemplate, templates } from "./templates.js";
import { auditRelease, formatAuditReport } from "./audit.js";
import { auditCd, formatAuditCdReport } from "./audit-cd.js";
import { auditSecurity, formatAuditSecurityReport } from "./audit-security.js";
import {
  seedSecurityGuidance,
  formatSeedSecurityGuidanceReport,
} from "./seed-security-guidance.js";
import { readVersion } from "./version.js";

const HELP = `create-starter — scaffold and audit Starter Series projects.

Usage
  create-starter <name> --template <id> [options]
  create-starter audit [path]
  create-starter audit-cd [path]
  create-starter audit-security [path]
  create-starter --list
  create-starter --help

Arguments
  <name>                   Project name ([A-Za-z0-9_-], must start with alnum)
  audit [path]             Audit release-readiness (CHANGELOG, version, workflow)
  audit-cd [path]          Audit deploy destinations (npm, PyPI, AMO, Open VSX,
                           VS Marketplace, GitHub Releases) for publish drift
  audit-security [path]    Audit CI security hygiene (gitleaks, CodeQL, audit,
                           --ignore-scripts, Dependabot, etc.)
  seed-security-guidance [path] [--force]
                           Generate a starter claude-security-guidance.md
                           tailored to the detected Starter Series template
                           (path defaults to the current directory)

Options
  -t, --template <id>      Template ID (see --list)
  -d, --description <text> One-line project description
  -o, --output-dir <path>  Output directory (default: ./<name>)
      --no-git             Skip "git init" after scaffold
      --list               List available templates and exit
  -h, --help               Show this message and exit
  -v, --version            Print version and exit

Environment
  CREATE_STARTER_DEBUG=1   Emit verbose stderr logs

Examples
  create-starter my-bot --template discord-bot
  create-starter my-api --template mcp-server --description "My coding agent"
  create-starter audit
  create-starter audit /path/to/repo
  create-starter audit-cd
  create-starter --list
`;

interface Parsed {
  positionals: string[];
  values: {
    template?: string;
    description?: string;
    "output-dir"?: string;
    help?: boolean;
    list?: boolean;
    version?: boolean;
    "no-git"?: boolean;
  };
}

export function parseCliArgs(argv: string[]): Parsed {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      template: { type: "string", short: "t" },
      description: { type: "string", short: "d" },
      "output-dir": { type: "string", short: "o" },
      "no-git": { type: "boolean" },
      list: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  return { positionals, values } as Parsed;
}

function printTemplates(): void {
  const rows = templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    stack: t.stack.join(", "),
  }));
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    category: Math.max(8, ...rows.map((r) => r.category.length)),
  };
  const header = `${"id".padEnd(widths.id)}  ${"name".padEnd(widths.name)}  ${"category".padEnd(widths.category)}  stack`;
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");
  for (const r of rows) {
    process.stdout.write(
      `${r.id.padEnd(widths.id)}  ${r.name.padEnd(widths.name)}  ${r.category.padEnd(widths.category)}  ${r.stack}\n`,
    );
  }
}

// Exit-code contract (documented so callers/CI can branch on it):
//   0 — success / clean verdict
//   1 — RESULT failure: the audit ran fine but the repo is not OK
//       (BLOCKED ship verdict, needs-publish CD drift, soft security posture)
//   2 — OPERATIONAL failure: bad usage, unknown flag, or the audit could not
//       run at all (e.g. path is not a directory). Distinguishing these lets a
//       caller tell "your repo needs work" (1) from "the tool couldn't run" (2).
const EXIT_OK = 0;
const EXIT_RESULT_FAILURE = 1;
const EXIT_OP_FAILURE = 2;

/**
 * Partition a subcommand's argv into positionals and flags, rejecting any flag
 * not in `allowedFlags`. Returns an error string for the caller to print, or
 * the parsed shape. Strict: a typo like `--forrce` errors instead of being
 * silently dropped (the old `startsWith('-')` filter swallowed unknowns).
 */
function partitionSubcommandArgs(
  argv: string[],
  allowedFlags: Set<string>,
): { positionals: string[]; flags: Set<string> } | { error: string } {
  const positionals: string[] = [];
  const flags = new Set<string>();
  for (const a of argv) {
    if (a.startsWith("-")) {
      // Support `--flag=value` form by checking the flag name before `=`.
      const flagName = a.split("=", 1)[0];
      if (!allowedFlags.has(flagName)) {
        return { error: `unknown option '${a}'` };
      }
      flags.add(flagName);
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/**
 * Shared shell for every `audit*` subcommand: parses the single optional
 * positional path, defers to the audit function, prints the formatted report,
 * and maps the verdict to an exit code. Each subcommand is a one-liner around
 * this helper.
 */
async function runAuditSubcommand<R>(
  argv: string[],
  name: string,
  fn: (path: string) => Promise<R>,
  format: (report: R) => string,
  isFailure: (report: R) => boolean,
): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return EXIT_OK;
  }
  const parsed = partitionSubcommandArgs(argv, new Set(["-h", "--help"]));
  if ("error" in parsed) {
    process.stderr.write(`error: ${parsed.error} (run '${name} --help')\n`);
    return EXIT_OP_FAILURE;
  }
  if (parsed.positionals.length > 1) {
    process.stderr.write(
      `error: '${name}' accepts at most one path, got: ${parsed.positionals.join(" ")}\n`,
    );
    return EXIT_OP_FAILURE;
  }
  const path = parsed.positionals[0] ?? process.cwd();
  let report: R;
  try {
    report = await fn(path);
  } catch (err) {
    // The audit could not RUN (e.g. path is not a directory) — operational
    // failure, distinct from a clean run that returns a BLOCKED verdict.
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return EXIT_OP_FAILURE;
  }
  process.stdout.write(format(report));
  return isFailure(report) ? EXIT_RESULT_FAILURE : EXIT_OK;
}

/**
 * Standalone helper for `seed-security-guidance` because it accepts an
 * additional `--force` flag — different shape from the audit family.
 */
function runSeedSecurityGuidance(argv: string[]): number {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return EXIT_OK;
  }
  const parsed = partitionSubcommandArgs(
    argv,
    new Set(["-h", "--help", "-f", "--force"]),
  );
  if ("error" in parsed) {
    process.stderr.write(
      `error: ${parsed.error} (run 'seed-security-guidance --help')\n`,
    );
    return EXIT_OP_FAILURE;
  }
  const force = parsed.flags.has("--force") || parsed.flags.has("-f");
  if (parsed.positionals.length > 1) {
    process.stderr.write(
      `error: 'seed-security-guidance' accepts at most one path, got: ${parsed.positionals.join(" ")}\n`,
    );
    return EXIT_OP_FAILURE;
  }
  const path = parsed.positionals[0] ?? process.cwd();
  try {
    const report = seedSecurityGuidance({ repoPath: path, force });
    process.stdout.write(formatSeedSecurityGuidanceReport(report));
    // "exists" without --force is informational, not a failure.
    return EXIT_OK;
  } catch (err) {
    // Could not run (e.g. path is not a directory) — operational failure.
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return EXIT_OP_FAILURE;
  }
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv[0] === "audit") {
    return runAuditSubcommand(
      argv.slice(1),
      "audit",
      auditRelease,
      formatAuditReport,
      (r) => r.shipReady.verdict === "no",
    );
  }
  if (argv[0] === "audit-cd") {
    return runAuditSubcommand(
      argv.slice(1),
      "audit-cd",
      (p) => auditCd(p),
      formatAuditCdReport,
      (r) => r.overall.verdict === "needs-publish",
    );
  }
  if (argv[0] === "audit-security") {
    return runAuditSubcommand(
      argv.slice(1),
      "audit-security",
      auditSecurity,
      formatAuditSecurityReport,
      (r) => r.overall.verdict === "soft",
    );
  }
  if (argv[0] === "seed-security-guidance") {
    return runSeedSecurityGuidance(argv.slice(1));
  }

  let parsed: Parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n\n`);
    process.stderr.write(HELP);
    return 2;
  }

  if (parsed.values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (parsed.values.version) {
    process.stdout.write(`create-starter ${readVersion()}\n`);
    return 0;
  }

  if (parsed.values.list) {
    printTemplates();
    return 0;
  }

  if (parsed.positionals.length === 0) {
    process.stderr.write("error: missing project <name>\n\n");
    process.stderr.write(HELP);
    return 2;
  }
  if (parsed.positionals.length > 1) {
    process.stderr.write(
      `error: unexpected extra positional arguments: ${parsed.positionals.slice(1).join(" ")}\n\n`,
    );
    process.stderr.write(HELP);
    return 2;
  }
  const [name] = parsed.positionals;
  const templateId = parsed.values.template;
  if (!templateId) {
    process.stderr.write("error: --template <id> is required\n\n");
    process.stderr.write(HELP);
    return 2;
  }
  const template = getTemplate(templateId);
  if (!template) {
    process.stderr.write(`error: unknown template "${templateId}" (run --list to see options)\n`);
    return 2;
  }

  try {
    const result = await scaffold({
      template,
      projectName: name,
      description: parsed.values.description,
      outputDir: parsed.values["output-dir"],
      initGit: !parsed.values["no-git"],
      logger: stderrLogger,
    });
    process.stdout.write(`\n${formatScaffoldReport(name, template, result)}\n\n`);
    return EXIT_OK;
  } catch (err) {
    // Scaffolding failed to complete (download / extract / fs error) — this is
    // an operational failure, not a "result", so use the op-failure code.
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return EXIT_OP_FAILURE;
  }
}
