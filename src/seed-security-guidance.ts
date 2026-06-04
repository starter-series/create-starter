import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { extractStarterSignals, type StarterId } from "./starter-detect.js";

export interface SeedSecurityGuidanceOptions {
  /** Defaults to process.cwd(). */
  repoPath?: string;
  /** Overwrite an existing claude-security-guidance.md. Default false. */
  force?: boolean;
}

export interface SeedSecurityGuidanceResult {
  repoPath: string;
  filePath: string;
  matchedStarter: StarterId | null;
  status: "created" | "exists" | "overwritten";
  bytesWritten: number;
  /** Relative path from repoPath, for display. */
  relativePath: string;
}

const UNIVERSAL_SECTION = `## Universal rules

These apply to every file in this repo regardless of starter type.

- Never log secrets, API keys, OAuth tokens, or session cookies — redact before any logging call.
- Never use \`eval\`, \`Function()\`, dynamic \`import()\` of untrusted strings, or string-concatenated SQL/shell.
- Validate all external input (HTTP body, env var, CLI arg, file content) with a schema validator (Zod / Pydantic) before processing.
- Prefer \`path.join\` / \`path.resolve\` over string concatenation for paths. Reject inputs that resolve outside the working directory.
- Never commit \`.env*\` files. They must be in \`.gitignore\` and \`.env.example\` is the canonical placeholder source.
- HTTP fetches must have an explicit timeout (5–30 s) and AbortController; no unbounded waits.
- Use OIDC trusted publishing for npm / PyPI / GHCR. Reject any long-lived registry token in CI workflows.`;

const SECTIONS_BY_STARTER: Partial<Record<StarterId, string>> = {
  "mcp-server": `## MCP server (TypeScript) specifics

- Every tool registered via \`server.registerTool\` must declare an \`inputSchema\` (and \`outputSchema\` when emitting structured content). Untyped tool inputs are a server-side injection vector.
- Reject any \`path\` argument that escapes the MCP server's working directory after \`path.resolve\`. Refuse symlinks pointing outside.
- Annotate destructive tools with \`destructiveHint: true\` so the host can request confirmation. Never delete user files without explicit confirmation.
- Rate-limit outbound network calls per tool. The MCP transport is stateless — each call is independent and easy to amplify.`,
  "mcp-server-python": `## MCP server (Python / FastMCP) specifics

- Every tool decorator must declare typed parameters via Pydantic or \`@dataclass\`. Reject string \`**kwargs\` patterns.
- Reject any \`path\` argument that escapes \`pathlib.Path.resolve()\` outside the server's working directory.
- Pin transitive dependencies via \`uv.lock\` or \`requirements.txt\` + hash. Update via \`uv lock --upgrade-package\`.
- Mark destructive tools with explicit naming (\`delete_*\`, \`drop_*\`) and require a confirmation argument from the caller.`,
  "npm-package": `## npm package specifics

- Public APIs must export from a single \`src/index.ts\` re-export barrel. Any internal helper imported across files must be re-exported, not deep-imported (breaks tree-shaking and stable surface).
- Add \`"sideEffects": false\` to package.json when no side effects exist (lets bundlers tree-shake).
- Use OIDC trusted publishing (\`id-token: write\` in publish.yml). Never publish from a local machine.
- Pin every \`@types/*\` to the minor matching the runtime dep.`,
  "discord-bot": `## Discord bot specifics

- Sanitize all user-supplied strings before logging or re-emitting (Discord injection via embed/markdown). Strip backticks, mentions \`@everyone\`/\`@here\`, and \`@\` role references.
- Rate-limit slash commands per user (Discord.js \`@discordjs/collection\` Map keyed by userId).
- Validate webhook signatures (\`X-Signature-Ed25519\` + \`X-Signature-Timestamp\`) before processing incoming interactions.
- Never log message content. Log only message IDs.`,
  "telegram-bot": `## Telegram bot specifics

- Validate webhook secret token (\`X-Telegram-Bot-Api-Secret-Token\`) on every incoming POST.
- Rate-limit per chat ID and per user ID — Telegram bots are easy DDoS targets.
- Sanitize user input before forwarding to other chats. Strip HTML/Markdown special chars when echoing.
- Use long-polling fallback only in dev. Production must use webhooks with TLS.`,
  "browser-extension": `## Browser extension (Manifest V3) specifics

- \`host_permissions\` must be minimal and justified per-host. Avoid \`<all_urls>\`.
- Never use \`innerHTML\` with user-supplied or remote content. Use \`textContent\` or DOM APIs.
- CSP \`extension_pages\` must include \`"script-src 'self'"\` and \`"object-src 'self'"\`. No \`unsafe-eval\`.
- \`web_accessible_resources\` must list only the resources actually needed by the host page.
- Refresh tokens stored in \`chrome.storage.local\` should be encrypted with a key derived from a passphrase the user supplies on each session.`,
  "vscode-extension": `## VS Code extension specifics

- Never read \`workspace.fs\` paths derived from untrusted webview messages without validating they stay inside the workspace root.
- Webview HTML must use a strict CSP (\`default-src 'none'; script-src 'nonce-...'\`). Generate a fresh nonce per webview.
- Telemetry must respect \`telemetry.telemetryLevel\` — never send before checking.
- Activation events must be specific (\`onCommand:...\`, \`onLanguage:...\`) — never \`*\` (slows startup).`,
  "electron-app": `## Electron app specifics

- \`nodeIntegration: false\` and \`contextIsolation: true\` in every BrowserWindow. Expose APIs via \`preload.js\` + \`contextBridge\`.
- \`webPreferences.sandbox: true\` for renderers loading remote content.
- \`session.setPermissionRequestHandler\` must deny all permissions by default and allow only what the app declares.
- Validate auto-update URLs against a hard-coded hostname. Sign the update channel with a code-signing cert.
- Never use \`shell.openExternal\` with an unvalidated URL — protocol-whitelist (\`http\`, \`https\`, \`mailto\` only).`,
  "react-native": `## React Native (Expo) specifics

- Never store auth tokens in \`AsyncStorage\` — use \`expo-secure-store\` (Keychain / Keystore).
- Validate every URL passed to \`Linking.openURL\` — deep links are an injection vector.
- Pin native module versions via \`expo install\` (resolves to the matching SDK version).
- Code signing via EAS Build only; never ship locally-signed builds.`,
  "cloudflare-pages": `## Cloudflare Pages specifics

- \`_headers\` must declare CSP, HSTS, X-Content-Type-Options. Validate via the existing \`tests/headers.test.js\`.
- \`functions/\` (Pages Functions) input must be Zod-validated before any KV write or external fetch.
- KV namespace bindings are environment-scoped — never share dev and prod namespaces.
- Secrets via \`wrangler secret put\`; never in \`wrangler.toml\`.`,
  "docker-deploy": `## Docker deploy specifics

- Base images pinned by SHA256 digest, not tag. Bump via Dependabot Docker ecosystem.
- Run as non-root user (\`USER 1000:1000\` after build steps).
- \`HEALTHCHECK\` declared in Dockerfile and validated by the deploy workflow (rollback on healthcheck failure for 60 s).
- \`docker compose\` files use \`secrets:\` directives or external secret managers — never inline env values.
- SSH deploy: host key checked against \`known_hosts\` (no \`StrictHostKeyChecking=no\`).`,
};

const FALLBACK_SECTION = `## Project-specific section

Add your own org / project rules below. Examples to consider:

- Auth/session handling rules
- Logging/redaction rules
- External-service allowlist
- Database access patterns
- CI/CD secret naming conventions`;

function buildContent(matchedId: StarterId | null): string {
  const starterSection = matchedId
    ? (SECTIONS_BY_STARTER[matchedId] ?? FALLBACK_SECTION)
    : FALLBACK_SECTION;
  const today = new Date().toISOString().slice(0, 10);
  return `# Security guidance

This file is read by Anthropic's Claude Code Security Guidance Plugin
(released 2026-05-26) as an **in-session guard** while Claude writes code.
It complements — does not replace — the post-PR \`claude-code-security-review\`
GitHub Action and the repo-level \`audit_security\` check.

> Generated by \`@starter-series/create seed-security-guidance\` on ${today}${matchedId ? ` for the **${matchedId}** starter` : ""}.
> Edit freely — the plugin re-reads this file on every session.

${UNIVERSAL_SECTION}

${starterSection}

## How this file gets used

1. **Anthropic Claude Code Security Guidance Plugin** (in-session): scans this file at session start and applies the rules as a pre-tool-call guard.
2. **\`audit_security\` MCP tool**: detects the file's presence and reports the \`claude-security-guidance\` check as PRESENT.
3. **PR review (\`claude-code-security-review\` Action)**: applies the same rules to PR diffs as a post-write check.

If you change a rule, ship the change in a normal PR — the \`claude-code-security-review\` Action will re-evaluate older PRs in flight against the new rule set.
`;
}

export function seedSecurityGuidance(
  options: SeedSecurityGuidanceOptions = {},
): SeedSecurityGuidanceResult {
  const repoPath = options.repoPath ?? process.cwd();
  const abs = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }

  const filePath = join(abs, "claude-security-guidance.md");
  const exists = existsSync(filePath);

  // Detect the starter up front so the "exists" branch can report which starter
  // the repo matched too (previously hardcoded null, which made an existing-file
  // report misleadingly say "no starter matched").
  const sig = extractStarterSignals(abs);

  if (exists && !options.force) {
    return {
      repoPath: abs,
      filePath,
      matchedStarter: sig.id,
      status: "exists",
      bytesWritten: 0,
      relativePath: relative(abs, filePath),
    };
  }

  const content = buildContent(sig.id);
  writeFileSync(filePath, content, "utf-8");

  return {
    repoPath: abs,
    filePath,
    matchedStarter: sig.id,
    status: exists ? "overwritten" : "created",
    bytesWritten: Buffer.byteLength(content, "utf-8"),
    relativePath: relative(abs, filePath),
  };
}

export function formatSeedSecurityGuidanceReport(r: SeedSecurityGuidanceResult): string {
  const lines: string[] = [];
  lines.push(`seed_security_guidance — ${r.repoPath}`);
  lines.push("");
  if (r.status === "exists") {
    lines.push(`Status: EXISTS (no change)`);
    lines.push(`  - ${r.relativePath} already present.`);
    lines.push(`  - Matched starter: ${r.matchedStarter ?? "(none — fallback section used)"}`);
    lines.push(`  - Re-run with --force to overwrite with the latest template.`);
    return lines.join("\n") + "\n";
  }
  const verb = r.status === "created" ? "Created" : "Overwrote";
  lines.push(`Status: ${r.status.toUpperCase()}`);
  lines.push(`  - ${verb} ${r.relativePath} (${r.bytesWritten} bytes)`);
  lines.push(`  - Matched starter: ${r.matchedStarter ?? "(none — fallback section used)"}`);
  lines.push("");
  lines.push(`Next:`);
  lines.push(`  1. Read the file and edit any org-specific rules.`);
  lines.push(`  2. Commit it: git add ${r.relativePath} && git commit -m "chore(security): seed claude-security-guidance.md"`);
  lines.push(`  3. Re-run audit_security to see the check flip to PRESENT.`);
  return lines.join("\n") + "\n";
}
