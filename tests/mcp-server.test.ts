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
// This test asserts that no such error appears for any of the 5 tools.

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
      ["audit_cd", "audit_release", "audit_security", "create_project", "list_templates"],
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

  it("audit_security on this repo returns 8/8 HARDENED via structuredContent", async () => {
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
        }
      | undefined;
    assert.ok(sc, "audit_security: missing structuredContent");
    // README + CLAUDE.md claim 8/8 HARDENED. This test pins the claim.
    assert.equal(
      sc.overall!.verdict,
      "hardened",
      `audit_security: this repo regressed below HARDENED (verdict=${sc.overall!.verdict})`,
    );
    assert.equal(
      sc.summary!.present,
      8,
      `audit_security: expected 8 present checks, got ${sc.summary!.present}`,
    );
    assert.equal(
      sc.summary!.missing,
      0,
      `audit_security: expected 0 missing checks, got ${sc.summary!.missing}`,
    );
  });

  it("invalid input is rejected with isError, not crash", async () => {
    const res = await client.send({
      jsonrpc: "2.0",
      id: 7,
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
