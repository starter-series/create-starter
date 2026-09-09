import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parse, stringify } from "yaml";

export interface WorkflowSource { file: string; content: string }
export type PolicyLoader = (path: string, ref: string) => Promise<string>;
const owner = "starter-series/.github";
async function loadPolicy(path: string, ref: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${encodeURIComponent(ref)}/${path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new Error("Policy file exceeds 1 MiB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Inspect referenced fleet policy definitions, never execute remote code. */
export async function expandSecurityWorkflows(local: WorkflowSource[], loader: PolicyLoader = loadPolicy): Promise<{ sources: WorkflowSource[]; unresolved: string[] }> {
  const sources: WorkflowSource[] = [];
  const unresolved: string[] = [];
  const fetched = new Map<string, Promise<string>>();
  const visited = new Set<string>();
  const object = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
  async function visit(source: WorkflowSource, context?: { path: string; ref: string }, inputs: Record<string, any> = {}, depth = 0): Promise<void> {
    if (depth > 8) { unresolved.push(`${source.file}: policy nesting exceeds 8`); return; }
    let doc: Record<string, any>;
    try { doc = object(parse(source.content)); }
    catch { unresolved.push(`${source.file}: invalid workflow YAML`); return; }
    const defaults = object(object(object(doc.on).workflow_call).inputs);
    const values = { ...Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, object(v).default])), ...inputs };
    const active = (entry: Record<string, any>): boolean => {
      if (entry.if === false || /^(?:\$\{\{\s*)?false(?:\s*\}\})?$/.test(String(entry.if))) return false;
      const match = String(entry.if).match(/^(?:\$\{\{\s*)?inputs\.(\w+)\s*==\s*['"]([^'"]+)['"](?:\s*\}\})?$/);
      return !match || values[match[1]] === undefined || values[match[1]] === match[2];
    };
    const requests: Promise<void>[] = [];
    const follow = (path: string, ref: string, args: Record<string, any> = {}) => {
      if (path.includes("..") || !/^(?:\.github\/(?:workflows|actions)\/|scripts\/)/.test(path)) { unresolved.push(`${source.file}: unsupported policy path ${path}`); return; }
      const key = `${path}@${ref}`;
      const traversal = key + JSON.stringify(args);
      if (visited.has(traversal)) return;
      visited.add(traversal);
      if (visited.size > 32) { unresolved.push("Policy graph exceeds 32 files"); return; }
      requests.push((async () => {
        try {
          if (!fetched.has(key)) fetched.set(key, loader(path, ref));
          const content = await fetched.get(key)!;
          const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
          const remote = { file: `${owner}/${key} (sha256:${hash})`, content };
          if (/\.[cm]?js$/.test(path)) sources.push(remote);
          else await visit(remote, { path, ref }, args, depth + 1);
        } catch (error) { unresolved.push(`${owner}/${key}: ${(error as Error).message}`); }
      })());
    };
    const inspect = (entry: Record<string, any>, job = false) => {
      const uses = typeof entry.uses === "string" ? entry.uses : "";
      const args = Object.fromEntries(Object.entries(object(entry.with)).map(([k,v]) => {
        const match = typeof v === "string" && v.match(/^\$\{\{\s*inputs\.(\w+)\s*\}\}$/);
        return [k, match ? values[match[1]] : v];
      }));
      const remote = uses.match(/^starter-series\/\.github\/(\.github\/(?:workflows|actions)\/[^@]+)@([^\s]+)$/);
      if (remote) follow(/\.ya?ml$/.test(remote[1]) ? remote[1] : `${remote[1]}/action.yml`, remote[2], args);
      else if (job && uses.startsWith("./.github/workflows/")) {
        if (context) follow(uses.slice(2), context.ref, args);
        else {
          const target = local.find(s => s.file === uses.split("/").at(-1));
          const key = uses + JSON.stringify(args);
          if (target && !visited.has(key)) { visited.add(key); requests.push(visit(target, undefined, args, depth + 1)); }
          else if (!target) unresolved.push(`${source.file}: missing local workflow ${uses}`);
        }
      } else if (job && uses) unresolved.push(`${source.file}: unsupported reusable workflow ${uses}`);
      if (context && typeof entry.run === "string") {
        for (const match of entry.run.matchAll(/\$GITHUB_ACTION_PATH\/([.\/\w-]+\.[cm]?js)/g)) {
          follow(posix.normalize(posix.join(posix.dirname(context.path), match[1])), context.ref);
        }
      }
    };
    const jobs = Object.values(object(doc.jobs)).map(object).filter(active);
    const steps = [...jobs.flatMap(j => (Array.isArray(j.steps) ? j.steps : [])), ...(Array.isArray(doc.runs?.steps) ? doc.runs.steps : [])].map(object).filter(active);
    // Ignore comments and disabled jobs/steps rather than matching their raw YAML.
    sources.push({ file: source.file, content: stringify({ jobs: jobs.map(j => ({ ...j, steps: undefined })), steps }) });
    jobs.forEach(j => inspect(j, true));
    steps.forEach(s => inspect(s));
    await Promise.all(requests);
  }
  await Promise.all(local.map(source => visit(source)));
  return { sources: sources.sort((a,b) => a.file.localeCompare(b.file)), unresolved: [...new Set(unresolved)].sort() };
}
