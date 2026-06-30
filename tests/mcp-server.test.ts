import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Contract test: spawn the built binary, drive it over MCP stdio, and verify
// every registered tool returns a response that the SDK's outputSchema
// validator accepts. This catches the AirMCP `feedback_test_blind_spot`
// pattern — registration metadata being correct while the actual runtime
// payload diverges from the declared schema.
//
// If audit*.ts adds or renames a field that mcp-schemas.ts doesn't mirror,
// the SDK emits an "Output validation error" text block on tools/call.
// This test asserts that no such error appears for the runtime-validated tools.

const BIN = resolve(import.meta.dirname, "..", "dist", "index.js");
const PROTOCOL_VERSION = "2025-03-26";

interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content?: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    tools?: { name: string; outputSchema?: unknown }[];
  };
  error?: { code: number; message: string };
}

class StdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = "";
  private responses = new Map<number, RpcResponse>();
  private waiters = new Map<number, (r: RpcResponse) => void>();

  constructor(binPath: string) {
    this.proc = spawn("node", [binPath], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on("data", () => {
      /* server logs to stderr; ignore for tests */
    });
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString("utf-8");
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RpcResponse;
        if (typeof msg.id === "number") {
          this.responses.set(msg.id, msg);
          const waiter = this.waiters.get(msg.id);
          if (waiter) {
            this.waiters.delete(msg.id);
            waiter(msg);
          }
        }
      } catch {
        /* non-JSON line; ignore */
      }
    }
  }

  async send(req: RpcRequest): Promise<RpcResponse> {
    if (this.responses.has(req.id)) return this.responses.get(req.id)!;
    const promise = new Promise<RpcResponse>((resolveResponse, reject) => {
      this.waiters.set(req.id, resolveResponse);
      setTimeout(() => {
        if (this.waiters.has(req.id)) {
          this.waiters.delete(req.id);
          reject(new Error(`Timeout waiting for response id=${req.id}`));
        }
      }, 15_000);
    });
    this.proc.stdin.write(JSON.stringify(req) + "\n");
    return promise;
  }

  close(): void {
    this.proc.kill();
  }
}

function assertNoValidationError(res: RpcResponse, toolName: string): void {
  assert.ok(res.result, `${toolName}: missing result. error=${JSON.stringify(res.error)}`);
  const text = res.result.content?.[0]?.text ?? "";
  // The SDK surfaces output-schema validation failures by replacing the
  // tool's normal payload with an "Output validation error" text block.
  // Any occurrence here means structuredContent did not match outputSchema.
  assert.ok(
    !text.includes("Output validation error"),
    `${toolName}: SDK reported output-schema validation failure:\n${text.slice(0, 400)}`,
  );
  assert.ok(
    !text.includes("Invalid structured content"),
    `${toolName}: SDK reported invalid structured content:\n${text.slice(0, 400)}`,
  );
}

describe("MCP server — contract test (outputSchema ↔ structuredContent)", () => {
  let client: StdioClient;

  before(() => {
    assert.ok(
      existsSync(BIN),
      `dist/index.js missing — run 'npm run build' before this test (path=${BIN})`,
    );
    client = new StdioClient(BIN);
  });

  it("initialize succeeds", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "contract-test", version: "0" },
      },
    });
    assert.ok(res.result, `initialize failed: ${JSON.stringify(res.error)}`);
  });

  it("tools/list advertises outputSchema on every tool", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const tools = res.result?.tools ?? [];
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(
      names,
      [
        "add_component",
        "audit_cd",
        "audit_instructions",
        "audit_release",
        "audit_security",
        "create_project",
        "generate_launch_proof_report",
        "list_templates",
        "seed_security_guidance",
      ],
      "tools/list returned an unexpected set",
    );
    for (const t of tools) {
      assert.ok(
        t.outputSchema,
        `tool ${t.name} is missing outputSchema — would defeat structuredContent contract`,
      );
    }
  });

  it("list_templates returns structuredContent matching schema", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_templates", arguments: {} },
    });
    assertNoValidationError(res, "list_templates");
    const sc = res.result?.structuredContent as { templates?: unknown[] } | undefined;
    assert.ok(sc, "list_templates: missing structuredContent");
    assert.ok(Array.isArray(sc.templates), "list_templates: templates is not an array");
    assert.equal(sc.templates!.length, 11, "list_templates: expected 11 templates");
  });

  it("audit_release on this repo returns structuredContent matching schema", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "audit_release", arguments: { path: process.cwd() } },
    });
    assertNoValidationError(res, "audit_release");
    const sc = res.result?.structuredContent as
      | { shipReady?: { verdict?: string }; version?: { drift?: string } }
      | undefined;
    assert.ok(sc, "audit_release: missing structuredContent");
    assert.ok(sc.shipReady, "audit_release: shipReady missing in structuredContent");
    assert.ok(
      ["yes", "no", "needs-attention"].includes(sc.shipReady!.verdict!),
      `audit_release: unexpected shipReady.verdict = ${sc.shipReady!.verdict}`,
    );
  });

  it("audit_cd on this repo returns structuredContent matching schema", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "audit_cd", arguments: { path: process.cwd() } },
    });
    assertNoValidationError(res, "audit_cd");
    const sc = res.result?.structuredContent as
      | { overall?: { verdict?: string }; destinations?: unknown[] }
      | undefined;
    assert.ok(sc, "audit_cd: missing structuredContent");
    assert.ok(Array.isArray(sc.destinations), "audit_cd: destinations is not an array");
    assert.ok(
      ["in-sync", "needs-publish", "drift", "unknown"].includes(sc.overall!.verdict!),
      `audit_cd: unexpected overall.verdict = ${sc.overall!.verdict}`,
    );
  });

  it("audit_security on this repo: 7 non-env checks present + structured contract intact", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "audit_security", arguments: { path: process.cwd() } },
    });
    assertNoValidationError(res, "audit_security");
    const sc = res.result?.structuredContent as
      | {
          overall?: { verdict?: string };
          summary?: { present?: number; missing?: number; partial?: number };
          checks?: { name: string; status: string }[];
        }
      | undefined;
    assert.ok(sc, "audit_security: missing structuredContent");

    // The overall verdict must be a valid enum value (structure contract).
    assert.ok(
      ["hardened", "needs-attention", "soft"].includes(sc.overall!.verdict!),
      `audit_security: unexpected overall.verdict = ${sc.overall!.verdict}`,
    );

    // The README "8/8 HARDENED" claim has one environment-dependent check:
    // `secret-scanning` queries `gh api repos/<repo>` for security_and_analysis,
    // which is only visible to admins. Locally (dev gh creds) it returns
    // "enabled" → present. In CI the workflow's GITHUB_TOKEN has only the
    // permissions declared in ci.yml (`contents: read`), which can't see
    // security_and_analysis, so the detector falls back to partial/missing.
    // That's an environment limit, not a regression — so we don't pin
    // secret-scanning's status here, but every other check must be present.
    const ENV_DEPENDENT = new Set(["secret-scanning"]);
    const checksByName = new Map(sc.checks!.map((c) => [c.name, c.status]));
    const nonEnv = [
      "gitleaks",
      "codeql",
      "dep-audit",
      "license-check",
      "ignore-scripts",
      "dependabot",
      "claude-code-security-review",
    ];
    for (const name of nonEnv) {
      assert.equal(
        checksByName.get(name),
        "present",
        `audit_security: ${name} regressed (status=${checksByName.get(name)}); this repo claims 8/8 HARDENED in README`,
      );
    }
    // Also assert the env-dependent check at least *appears* in the report —
    // i.e., the detector ran. Otherwise we'd silently miss a removed check.
    for (const env of ENV_DEPENDENT) {
      assert.ok(
        checksByName.has(env),
        `audit_security: ${env} check did not run; detector may have been removed`,
      );
    }
  });

  it("audit_instructions on this repo returns structuredContent matching schema", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "audit_instructions", arguments: { path: process.cwd() } },
    });
    assertNoValidationError(res, "audit_instructions");
    const sc = res.result?.structuredContent as
      | { overall?: { verdict?: string }; files?: unknown[]; riskSummaries?: unknown[] }
      | undefined;
    assert.ok(sc, "audit_instructions: missing structuredContent");
    assert.ok(Array.isArray(sc.files), "audit_instructions: files is not an array");
    assert.ok(
      ["clean", "advisory", "attention"].includes(sc.overall!.verdict!),
      `audit_instructions: unexpected overall.verdict = ${sc.overall!.verdict}`,
    );
    assert.ok(Array.isArray(sc.riskSummaries), "audit_instructions: riskSummaries is not an array");
  });

  it("generate_launch_proof_report returns markdown plus structured summary", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "generate_launch_proof_report",
        arguments: { path: process.cwd(), write: false },
      },
    });
    assertNoValidationError(res, "generate_launch_proof_report");
    const sc = res.result?.structuredContent as
      | {
          markdown?: string;
          overall?: { verdict?: string };
          gates?: { name: string; status: string }[];
        }
      | undefined;
    assert.ok(sc, "generate_launch_proof_report: missing structuredContent");
    assert.ok(sc.markdown?.startsWith("# Launch Proof Report"));
    assert.ok(
      ["ready", "attention", "blocked"].includes(sc.overall!.verdict!),
      `generate_launch_proof_report: unexpected verdict = ${sc.overall!.verdict}`,
    );
    assert.deepEqual(
      sc.gates!.map((g) => g.name).sort(),
      ["cd", "instructions", "release", "security"],
    );
  });

  it("invalid input is rejected with isError, not crash", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "create_project",
        arguments: { template: "nonexistent-template", name: "x" },
      },
    });
    // Either: input schema rejects ("nonexistent-template" not in z.enum),
    //   or: handler hits Unknown template branch with isError=true.
    // Both are acceptable as long as it doesn't crash the server.
    const isError = res.result?.isError === true || !!res.error;
    assert.ok(
      isError,
      `create_project with invalid template should error, but got result without isError: ${JSON.stringify(res.result).slice(0, 300)}`,
    );
  });

  it("teardown", () => {
    client.close();
  });
});
