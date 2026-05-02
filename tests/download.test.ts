import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DownloadError, fetchTarball, isSafeTarEntry } from "../src/download.ts";

function makeResponse(status: number, body: Uint8Array, contentLength?: number): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  });
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return new Response(stream, { status, headers });
}

describe("fetchTarball", () => {
  it("returns the buffered body on 200", async () => {
    const payload = new TextEncoder().encode("hello");
    const fakeFetch = (async () =>
      makeResponse(200, payload, payload.byteLength)) as unknown as typeof fetch;

    const buf = await fetchTarball("https://example.test/tarball", {
      fetchImpl: fakeFetch,
    });
    assert.equal(buf.toString("utf-8"), "hello");
  });

  it("throws DownloadError with HTTP_ERROR on 4xx and does not retry", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return makeResponse(404, new Uint8Array(0));
    }) as unknown as typeof fetch;

    await assert.rejects(
      fetchTarball("https://example.test/missing", {
        fetchImpl: fakeFetch,
        maxRetries: 5,
      }),
      (err) =>
        err instanceof DownloadError && err.code === "HTTP_ERROR",
    );
    assert.equal(calls, 1, "HTTP errors must not retry");
  });

  it("retries transient network errors up to maxRetries", async () => {
    let calls = 0;
    const payload = new TextEncoder().encode("ok");
    const fakeFetch = (async () => {
      calls++;
      if (calls < 3) throw new Error("ECONNRESET");
      return makeResponse(200, payload, payload.byteLength);
    }) as unknown as typeof fetch;

    const buf = await fetchTarball("https://example.test/flaky", {
      fetchImpl: fakeFetch,
      maxRetries: 3,
    });
    assert.equal(buf.toString("utf-8"), "ok");
    assert.equal(calls, 3);
  });

  it("rejects SIZE_EXCEEDED when declared content-length is over the cap", async () => {
    const fakeFetch = (async () =>
      makeResponse(200, new Uint8Array(0), 100)) as unknown as typeof fetch;

    await assert.rejects(
      fetchTarball("https://example.test/huge", {
        fetchImpl: fakeFetch,
        maxSizeBytes: 50,
      }),
      (err) =>
        err instanceof DownloadError && err.code === "SIZE_EXCEEDED",
    );
  });

  it("rejects SIZE_EXCEEDED when streamed bytes exceed the cap", async () => {
    const payload = new Uint8Array(200);
    // Intentionally omit content-length so the size check runs in the stream loop.
    const fakeFetch = (async () =>
      makeResponse(200, payload)) as unknown as typeof fetch;

    await assert.rejects(
      fetchTarball("https://example.test/stream-huge", {
        fetchImpl: fakeFetch,
        maxSizeBytes: 50,
      }),
      (err) =>
        err instanceof DownloadError && err.code === "SIZE_EXCEEDED",
    );
  });

  it("times out when fetch never resolves", async () => {
    const fakeFetch = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;

    await assert.rejects(
      fetchTarball("https://example.test/slow", {
        fetchImpl: fakeFetch,
        timeoutMs: 50,
        maxRetries: 1,
      }),
      (err) =>
        err instanceof DownloadError && err.code === "TIMEOUT",
    );
  });
});

describe("isSafeTarEntry (zip-slip / path-traversal guard)", () => {
  const safe = [
    "package.json",
    "src/index.ts",
    "deeply/nested/file.txt",
    "with-dashes/and_underscores.md",
    "trailing/slash/", // tar can emit directory entries
  ];
  const unsafe = [
    "",
    "/etc/passwd",
    "/absolute/path",
    "../escape",
    "ok/then/../../../escape", // collapses to ../escape — escapes cwd
    "C:windows", // Windows drive letter
    "C:\\Users\\Public",
    "..",
    "../",
    "../../",
  ];

  it("accepts paths that resolve back inside cwd even with .. mid-path", () => {
    // `ok/then/../../escape` → `escape` (still inside cwd) — safe.
    assert.equal(isSafeTarEntry("ok/then/../../escape"), true);
  });

  for (const p of safe) {
    it(`accepts ${JSON.stringify(p)}`, () => {
      assert.equal(isSafeTarEntry(p), true);
    });
  }
  for (const p of unsafe) {
    it(`rejects ${JSON.stringify(p)}`, () => {
      assert.equal(isSafeTarEntry(p), false);
    });
  }
});
