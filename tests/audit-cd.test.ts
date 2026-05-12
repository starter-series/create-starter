import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCd, formatAuditCdReport } from "../src/audit-cd.ts";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "audit-cd-test-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

/** Build a deterministic fetch mock for a single URL→payload map. */
function mockFetch(map: Record<string, { status?: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const hit = Object.entries(map).find(([prefix]) => url.startsWith(prefix));
    if (!hit) {
      return new Response(JSON.stringify({ error: "no mock" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const { status = 200, body } = hit[1];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("auditCd — npm registry", () => {
  it("flags needs-publish when local > published", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "@test/foo",
          version: "1.2.3",
          dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
        }),
      );
      const f = mockFetch({
        "https://registry.npmjs.org/": {
          body: {
            "dist-tags": { latest: "1.2.0" },
            time: { "1.2.0": "2026-04-01T00:00:00Z" },
          },
        },
      });
      const r = await auditCd(dir, { fetch: f });
      assert.equal(r.matchedStarter.id, "mcp-server");
      assert.equal(r.localVersion, "1.2.3");
      const npm = r.destinations.find((d) => d.name === "npm");
      assert.ok(npm, "should probe npm");
      assert.equal(npm!.status, "needs-publish");
      assert.equal(npm!.publishedVersion, "1.2.0");
      assert.equal(r.overall.verdict, "needs-publish");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports in-sync when local == published", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "@test/foo",
          version: "1.0.0",
          bin: { foo: "./bin/foo.js" },
          files: ["dist"],
        }),
      );
      const f = mockFetch({
        "https://registry.npmjs.org/": { body: { "dist-tags": { latest: "1.0.0" }, time: {} } },
      });
      const r = await auditCd(dir, { fetch: f });
      assert.equal(r.matchedStarter.id, "npm-package");
      const npm = r.destinations.find((d) => d.name === "npm");
      assert.equal(npm!.status, "in-sync");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports not-found when 404", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "@test/never-published",
          version: "0.1.0",
          dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
        }),
      );
      const f = mockFetch({
        "https://registry.npmjs.org/": { status: 404, body: { error: "not found" } },
      });
      const r = await auditCd(dir, { fetch: f });
      const npm = r.destinations.find((d) => d.name === "npm");
      assert.equal(npm!.status, "not-found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditCd — PyPI", () => {
  it("classifies pypi drift correctly", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "pyproject.toml"),
        `[project]\nname = "my-mcp"\nversion = "0.5.0"\ndependencies = ["fastmcp>=2.0"]\n`,
      );
      const f = mockFetch({
        "https://pypi.org/pypi/": { body: { info: { version: "0.3.0" } } },
      });
      const r = await auditCd(dir, { fetch: f });
      assert.equal(r.matchedStarter.id, "mcp-server-python");
      const py = r.destinations.find((d) => d.name === "pypi");
      assert.equal(py!.status, "needs-publish");
      assert.equal(py!.publishedVersion, "0.3.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditCd — Open VSX + VS Marketplace", () => {
  it("probes both Open VSX and VS Marketplace for vscode-extension", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "my-ext",
          publisher: "acme",
          version: "1.0.0",
          engines: { vscode: "^1.80.0" },
        }),
      );
      const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith("https://open-vsx.org/")) {
          return new Response(JSON.stringify({ version: "0.9.0" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (
          url.startsWith("https://marketplace.visualstudio.com/") &&
          init?.method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  extensions: [
                    {
                      versions: [{ version: "1.0.0", lastUpdated: "2026-05-10T00:00:00Z" }],
                    },
                  ],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch;
      const r = await auditCd(dir, { fetch: f });
      const ov = r.destinations.find((d) => d.name === "open-vsx");
      const vsm = r.destinations.find((d) => d.name === "vs-marketplace");
      // Open VSX behind (1.0.0 local > 0.9.0 published) → needs-publish
      assert.equal(ov!.status, "needs-publish");
      // VS Marketplace in-sync
      assert.equal(vsm!.status, "in-sync");
      assert.equal(vsm!.identifier, "acme.my-ext");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("VS Marketplace returns not-found when no results", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "my-ext",
          publisher: "acme",
          version: "1.0.0",
          engines: { vscode: "^1.80.0" },
        }),
      );
      const f = (async () =>
        new Response(JSON.stringify({ results: [{ extensions: [] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
      const r = await auditCd(dir, { fetch: f });
      const vsm = r.destinations.find((d) => d.name === "vs-marketplace");
      assert.equal(vsm!.status, "not-found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects local-stale on Open VSX when remote ahead", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "my-ext",
          publisher: "acme",
          version: "1.0.0",
          engines: { vscode: "^1.80.0" },
        }),
      );
      const f = mockFetch({
        "https://open-vsx.org/api/acme/my-ext": {
          body: { version: "1.1.0", timestamp: "2026-05-01T00:00:00Z" },
        },
      });
      const r = await auditCd(dir, { fetch: f });
      assert.equal(r.matchedStarter.id, "vscode-extension");
      const ov = r.destinations.find((d) => d.name === "open-vsx");
      assert.equal(ov!.status, "local-stale");
      assert.equal(r.overall.verdict, "drift");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports unsupported when publisher missing", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "my-ext",
          version: "1.0.0",
          engines: { vscode: "^1.80.0" },
        }),
      );
      const f = mockFetch({});
      const r = await auditCd(dir, { fetch: f });
      const ov = r.destinations.find((d) => d.name === "open-vsx");
      assert.equal(ov!.status, "unsupported");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditCd — AMO (browser-extension)", () => {
  it("uses gecko.id from manifest to probe AMO", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "x",
          version: "2.5.0",
          browser_specific_settings: { gecko: { id: "ext@example.com" } },
        }),
      );
      const f = mockFetch({
        "https://addons.mozilla.org/api/v5/addons/addon/ext%40example.com/": {
          body: { current_version: { version: "2.5.0" } },
        },
      });
      const r = await auditCd(dir, { fetch: f });
      assert.equal(r.matchedStarter.id, "browser-extension");
      const amo = r.destinations.find((d) => d.name === "amo");
      assert.equal(amo!.status, "in-sync");
      assert.equal(amo!.identifier, "ext@example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports unsupported when gecko.id missing", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({ manifest_version: 3, name: "x", version: "1.0.0" }),
      );
      const f = mockFetch({});
      const r = await auditCd(dir, { fetch: f });
      const amo = r.destinations.find((d) => d.name === "amo");
      assert.equal(amo!.status, "unsupported");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auditCd — formatting and edge cases", () => {
  it("returns unknown when no destinations detected", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "README.md"), "# nothing");
      const r = await auditCd(dir, { fetch: mockFetch({}) });
      assert.equal(r.matchedStarter.id, null);
      assert.equal(r.overall.verdict, "unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formats a multi-destination report", async () => {
    const dir = makeRepo();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "@test/foo",
          version: "1.2.3",
          dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
        }),
      );
      const f = mockFetch({
        "https://registry.npmjs.org/": {
          body: { "dist-tags": { latest: "1.2.0" }, time: {} },
        },
      });
      const r = await auditCd(dir, { fetch: f });
      const text = formatAuditCdReport(r);
      assert.match(text, /Overall: NEEDS-PUBLISH/);
      assert.match(text, /npm \(@test\/foo\)/);
      assert.match(text, /status: needs-publish/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
