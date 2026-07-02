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
  // node-tar invokes `filter` on the RAW entry path (before `strip: 1`), so
  // every entry from a GitHub archive carries a leading "<repo>-<sha>/"
  // segment. isSafeTarEntry replicates strip:1 itself, then checks the result
  // stays inside destDir. Tests therefore use raw (pre-strip) paths + a destDir.
  const destDir = "/tmp/create-starter-dest";
  const safe = [
    "repo-abc/package.json",
    "repo-abc/src/index.ts",
    "repo-abc/deeply/nested/file.txt",
    "repo-abc/with-dashes/and_underscores.md",
    "repo-abc/trailing/slash/", // tar can emit directory entries
  ];
  const unsafe = [
    "",
    "repo-abc/../escape.txt", // after strip:1 → ../escape.txt — escapes destDir
    "repo-abc/../../escape.txt", // after strip:1 → ../../escape.txt
    "repo-abc/ok/then/../../../escape", // after strip:1 collapses to ../escape
    "repo-abc", // top-level dir only — nothing to extract after strip
    "repo-abc/", // ditto
    "repo-abc/..",
    "repo-abc/../",
  ];

  it("accepts raw paths that resolve back inside destDir even with .. mid-path", () => {
    // `repo-abc/ok/then/../../escape` → strip → `ok/then/../../escape`
    // → resolves to `escape` (still inside destDir) — safe.
    assert.equal(isSafeTarEntry("repo-abc/ok/then/../../escape", destDir), true);
  });

  it("strips the RAW first segment before normalizing (double-.. escape)", () => {
    // If it normalized first, `repo-abc/../../escape` would collapse to
    // `../escape`, then dropping `..` as the "first segment" would falsely
    // accept `escape`. Stripping the raw segment first correctly rejects it.
    assert.equal(isSafeTarEntry("repo-abc/../../escape", destDir), false);
  });

  for (const p of safe) {
    it(`accepts ${JSON.stringify(p)}`, () => {
      assert.equal(isSafeTarEntry(p, destDir), true);
    });
  }
  for (const p of unsafe) {
    it(`rejects ${JSON.stringify(p)}`, () => {
      assert.equal(isSafeTarEntry(p, destDir), false);
    });
  }
});

// End-to-end: build a malicious tarball in memory, run extractTarball
// against a tmp dir, assert the bad entry was rejected and produced a
// DownloadError UNSAFE_ENTRY.
//
// Crafting a tar header by hand is fragile (checksum / GNU ustar magic),
// so we keep this scaffold marked as a TODO and rely on `isSafeTarEntry`
// unit tests above to cover policy. A future improvement: use a fixture
// tarball checked into tests/fixtures/ instead of synthesizing here.
describe.skip("extractTarball — zip-slip end-to-end (TODO: fixture tarball)", () => {
  it("rejects an entry whose path resolves outside cwd", async () => {
    const { mkdtemp, rm, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { create } = await import("tar");
    const { extractTarball, DownloadError } = await import(
      "../src/download.ts"
    );

    // The starter's archives have a top-level <repo>-<sha>/ that strip:1
    // peels off; mimic that and sneak a `..` entry below it.
    const stage = await mkdtemp(join(tmpdir(), "tar-stage-"));
    const repoRoot = join(stage, "repo-abc");
    const innerDir = join(repoRoot, "inner");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(innerDir, { recursive: true });
    await writeFile(join(repoRoot, "ok.txt"), "fine\n");
    // node-tar follows symlinks during create; create a regular file with
    // a relative path that, after strip:1, resolves outside cwd.
    // We do this by creating the malicious file under a nested name and
    // then editing the tar manifest at create time via portable=false +
    // explicit entry name override is not directly exposed. Instead, we
    // construct the tarball as a Buffer with an entry name we control.

    // Build a tar.gz buffer using node-tar's filesystem mode. The
    // simplest portable trick: create a directory tree with a `..` link
    // is not allowed by the OS. Use the API form: tar.create accepts a
    // filter, but for a *malicious entry* we need to pack manually. The
    // most pragmatic approach is to write bytes representing a tar with
    // a known offending header.
    //
    // Use `tar.c` with `prefix: "../escape"` won't work either. Instead
    // we leverage the real-world threat: a tarball that includes
    // `repo-abc/../escape.txt` as an entry name. We build it by piping
    // through tar.Pack and feeding a header directly.
    const { Pack, Header } = (await import("tar")) as unknown as {
      Pack: new () => NodeJS.ReadWriteStream;
      Header: new (data: Record<string, unknown>) => {
        encode(): Buffer | null;
        block: Buffer;
      };
    };

    // Manually craft a 1024-byte tar entry with a traversal path.
    function craftTar(entryName: string, body: string): Buffer {
      const ENTRY_SIZE = 512;
      const header = Buffer.alloc(ENTRY_SIZE, 0);
      const nameBuf = Buffer.from(entryName, "utf-8");
      nameBuf.copy(header, 0, 0, Math.min(nameBuf.length, 100));
      header.write("0000644", 100, 7, "ascii"); // mode
      header.write("0000000", 108, 7, "ascii"); // uid
      header.write("0000000", 116, 7, "ascii"); // gid
      const sizeOctal = body.length.toString(8).padStart(11, "0");
      header.write(sizeOctal, 124, 11, "ascii");
      header.write("00000000000", 136, 11, "ascii"); // mtime
      header.write("        ", 148, 8, "ascii"); // checksum placeholder
      header[156] = 0x30; // typeflag '0' = regular file
      header.write("ustar  ", 257, 7, "ascii"); // magic + version (gnu-ish)
      // Compute checksum
      let sum = 0;
      for (let i = 0; i < ENTRY_SIZE; i++) sum += header[i];
      header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

      const payload = Buffer.alloc(Math.ceil(body.length / 512) * 512, 0);
      Buffer.from(body, "utf-8").copy(payload);

      const trailer = Buffer.alloc(1024, 0);
      return Buffer.concat([header, payload, trailer]);
    }

    // strip:1 will peel "repo-abc/" → entry path becomes "../escape.txt"
    const tarBuf = craftTar("repo-abc/../escape.txt", "owned\n");

    // gzip it (extractTarball expects gz)
    const { gzipSync } = await import("node:zlib");
    const tgz = gzipSync(tarBuf);

    const dest = await mkdtemp(join(tmpdir(), "tar-dest-"));
    let caught: DownloadError | null = null;
    try {
      await extractTarball(tgz, dest);
    } catch (err) {
      if (err instanceof DownloadError) caught = err;
      else throw err;
    }

    assert.ok(caught !== null, "expected DownloadError");
    assert.equal(caught!.code, "UNSAFE_ENTRY");
    // Confirm the dest dir does NOT contain the leaked file.
    const entries = await readdir(dest);
    assert.deepEqual(
      entries.filter((e) => e.includes("escape")),
      [],
    );

    await rm(stage, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });
});
