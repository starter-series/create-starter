/**
 * add_component — lift a starter's CI/CD layer into an EXISTING repo without
 * re-scaffolding.
 *
 * This is the remediation half of the audit loop: `audit_security` /
 * `audit_release` diagnose what's missing against the Starter Series bar;
 * `add_component` installs those files from the matching starter. It writes
 * ONLY the well-known pipeline files listed in COMPONENT_GROUPS — never
 * application code, never secrets-bearing CD workflows.
 *
 * Safety posture (mutating a repo we don't own):
 *   - dry-run by default — returns a plan, writes nothing
 *   - refuses to apply onto a dirty git tree unless `force`
 *   - existing-but-different files are skipped unless `force` (reported as
 *     `skip-exists`, so the dry-run doubles as a drift report against the
 *     starter — the v1 answer to "update_component")
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getTemplate, archiveUrl, templates } from "./templates.js";
import { fetchTarball, extractTarball, type FetchOptions } from "./download.js";
import { extractStarterSignals } from "./starter-detect.js";
import { tryGit } from "./audit-helpers.js";

export type ComponentGroup = "ci" | "security" | "dependabot" | "maintenance" | "all";

/**
 * What each group lifts (paths relative to the repo root). Deliberately
 * EXCLUDED: cd*.yml (needs per-repo secrets — that's `deploy-setup`'s job),
 * setup.yml (template-onboarding checklist), update-changelog.yml (opinionated
 * release tooling), PULL_REQUEST_TEMPLATE.md (org-voice), capture.yml
 * (browser-extension-specific).
 */
export const COMPONENT_GROUPS: Record<Exclude<ComponentGroup, "all">, string[]> = {
  ci: [".github/workflows/ci.yml"],
  security: [".github/workflows/codeql.yml", "SECURITY.md"],
  dependabot: [".github/dependabot.yml", ".github/workflows/dependabot-auto-merge.yml"],
  maintenance: [".github/workflows/maintenance.yml", ".github/workflows/stale.yml"],
};

export type PlanAction = "create" | "overwrite" | "skip-exists" | "identical" | "absent-in-starter";

export interface AddComponentPlanEntry {
  path: string;
  action: PlanAction;
}

export interface AddComponentReport {
  repoPath: string;
  starter: string;
  starterSource: "explicit" | "detected";
  component: ComponentGroup;
  dryRun: boolean;
  plan: AddComponentPlanEntry[];
  written: string[];
  warnings: string[];
}

export interface AddComponentOptions {
  component?: ComponentGroup;
  /** Template id to lift from; auto-detected from the repo when omitted. */
  starter?: string;
  /** Preview only (default true). */
  dryRun?: boolean;
  /** Overwrite differing files AND allow applying onto a dirty git tree. */
  force?: boolean;
  /** Test seam, forwarded to fetchTarball. */
  fetchOptions?: FetchOptions;
}

function filesForComponent(component: ComponentGroup): string[] {
  if (component === "all") {
    return Object.values(COMPONENT_GROUPS).flat();
  }
  return COMPONENT_GROUPS[component];
}

export async function addComponent(
  repoPath: string,
  opts: AddComponentOptions = {},
): Promise<AddComponentReport> {
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    throw new Error(`not a directory: ${repoPath}`);
  }
  const component = opts.component ?? "all";
  if (component !== "all" && !(component in COMPONENT_GROUPS)) {
    throw new Error(
      `unknown component '${component}' (expected: ${[...Object.keys(COMPONENT_GROUPS), "all"].join(", ")})`,
    );
  }
  const dryRun = opts.dryRun ?? true;
  const force = opts.force ?? false;
  const warnings: string[] = [];

  // 1. Resolve the starter to lift from.
  let starterId: string;
  let starterSource: "explicit" | "detected";
  if (opts.starter) {
    if (!getTemplate(opts.starter)) {
      throw new Error(
        `unknown starter '${opts.starter}' (known: ${templates.map((t) => t.id).join(", ")})`,
      );
    }
    starterId = opts.starter;
    starterSource = "explicit";
  } else {
    const signals = extractStarterSignals(repoPath);
    if (!signals.id || signals.confidence === "none") {
      throw new Error(
        "couldn't tell what this repo ships as. Re-run with the starter that fits:\n" +
          "  • web app or static site   → --starter cloudflare-pages\n" +
          "  • containerized service/API → --starter docker-deploy\n" +
          "  • publishable npm library   → --starter npm-package\n" +
          `  full list: ${templates.map((t) => t.id).join(", ")}`,
      );
    }
    starterId = signals.id;
    starterSource = "detected";
    if (signals.confidence !== "high") {
      // Surface WHY we guessed, so a low-confidence detection reads as a
      // helpful suggestion the user can correct — not a silent wrong turn.
      const reason = signals.signals[signals.signals.length - 1];
      warnings.push(
        `detected '${starterId}' (${signals.confidence} confidence)` +
          (reason ? ` — ${reason}` : "") +
          `; pass \`--starter <id>\` to override if that's wrong.`,
      );
    }
  }
  const template = getTemplate(starterId)!;

  // 2. Dirty-tree guard — only when actually writing.
  const porcelain = tryGit(repoPath, ["status", "--porcelain"]);
  if (porcelain === null) {
    warnings.push("target is not a git repo — no dirty-tree protection, no easy undo");
  } else if (porcelain !== "" && !dryRun && !force) {
    throw new Error(
      "working tree is dirty — commit/stash first so the change is reviewable (or pass force)",
    );
  }

  // 3. Download + extract the starter into a temp dir.
  const tarball = await fetchTarball(archiveUrl(template), opts.fetchOptions);
  const starterDir = mkdtempSync(join(tmpdir(), "add-component-"));
  try {
    await extractTarball(tarball, starterDir);

    // 4. Plan: compare each component file in the starter against the target.
    const plan: AddComponentPlanEntry[] = [];
    for (const rel of filesForComponent(component)) {
      const src = join(starterDir, rel);
      if (!existsSync(src)) {
        plan.push({ path: rel, action: "absent-in-starter" });
        continue;
      }
      const dest = join(repoPath, rel);
      if (!existsSync(dest)) {
        plan.push({ path: rel, action: "create" });
      } else if (readFileSync(src).equals(readFileSync(dest))) {
        plan.push({ path: rel, action: "identical" });
      } else {
        plan.push({ path: rel, action: force ? "overwrite" : "skip-exists" });
      }
    }

    // 5. Apply (unless dry-run).
    const written: string[] = [];
    if (!dryRun) {
      for (const entry of plan) {
        if (entry.action !== "create" && entry.action !== "overwrite") continue;
        const src = join(starterDir, entry.path);
        const dest = join(repoPath, entry.path);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(src));
        written.push(entry.path);
      }
    }

    return { repoPath, starter: starterId, starterSource, component, dryRun, plan, written, warnings };
  } finally {
    rmSync(starterDir, { recursive: true, force: true });
  }
}

export function formatAddComponentReport(r: AddComponentReport): string {
  const lines: string[] = [];
  lines.push(
    `add-component — ${r.component} from '${r.starter}' (${r.starterSource}) → ${r.repoPath}`,
  );
  lines.push(r.dryRun ? "mode: DRY-RUN (no files written)" : "mode: APPLY");
  lines.push("");
  const width = Math.max(...r.plan.map((p) => p.path.length), 4);
  for (const p of r.plan) {
    lines.push(`  ${p.path.padEnd(width)}  ${p.action}`);
  }
  if (r.written.length > 0) {
    lines.push("");
    lines.push(`wrote ${r.written.length} file(s).`);
  }
  const skipped = r.plan.filter((p) => p.action === "skip-exists");
  if (skipped.length > 0) {
    lines.push("");
    lines.push(
      `${skipped.length} file(s) differ from the starter and were ${r.dryRun ? "marked" : "left"} as skip-exists — rerun with force to overwrite (review the diff first).`,
    );
  }
  if (r.dryRun) {
    lines.push("");
    if (r.plan.some((p) => p.action === "create")) {
      lines.push("review the plan above, then apply with: starter-series add-component [path] --apply");
    } else if (skipped.length === 0) {
      lines.push("nothing to do — target already matches the starter.");
    }
  }
  for (const w of r.warnings) {
    lines.push(`warning: ${w}`);
  }
  return lines.join("\n") + "\n";
}
