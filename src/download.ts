import { mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract } from "tar";
import type { Logger } from "./log.js";

export type DownloadErrorCode =
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "SIZE_EXCEEDED"
  | "NETWORK"
  | "ABORTED"
  | "UNSAFE_ENTRY";

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;

  constructor(message: string, code: DownloadErrorCode) {
    super(message);
    this.name = "DownloadError";
    this.code = code;
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  maxSizeBytes?: number;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

export async function fetchTarball(url: string, opts: FetchOptions = {}): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Treat a non-positive maxRetries as "one attempt" rather than zero. With the
  // raw value the `for` loop never runs and we throw a NETWORK error although
  // fetch was never called — a confusing config result. Clamp to >= 1 so a
  // single real attempt always happens.
  const requestedRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxRetries = Number.isFinite(requestedRetries) && requestedRetries >= 1
    ? Math.floor(requestedRetries)
    : 1;
  const maxSizeBytes = opts.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const logger = opts.logger;

  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchOnce({ url, timeoutMs, maxSizeBytes, fetchImpl, logger });
    } catch (err) {
      lastErr = err as Error;
      if (
        err instanceof DownloadError &&
        (err.code === "HTTP_ERROR" || err.code === "SIZE_EXCEEDED")
      ) {
        throw err;
      }
      if (attempt < maxRetries) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        logger?.warn(
          `download attempt ${attempt}/${maxRetries} failed: ${(err as Error).message}; retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
      }
    }
  }
  throw lastErr ?? new DownloadError("download failed without a specific error", "NETWORK");
}

interface FetchOnceArgs {
  url: string;
  timeoutMs: number;
  maxSizeBytes: number;
  fetchImpl: typeof fetch;
  logger?: Logger;
}

async function fetchOnce(args: FetchOnceArgs): Promise<Buffer> {
  const { url, timeoutMs, maxSizeBytes, fetchImpl, logger } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    logger?.debug(`GET ${url}`);
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "follow" });

    if (!res.ok) {
      throw new DownloadError(`HTTP ${res.status} ${res.statusText}: ${url}`, "HTTP_ERROR");
    }

    const contentLengthHeader = res.headers.get("content-length");
    const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : 0;
    if (declaredSize > maxSizeBytes) {
      throw new DownloadError(
        `declared size ${declaredSize} exceeds limit ${maxSizeBytes}`,
        "SIZE_EXCEEDED",
      );
    }

    const body = res.body;
    if (!body) throw new DownloadError("response body is missing", "NETWORK");

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let lastReportedPct = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxSizeBytes) {
        // Tear down the underlying fetch/socket the same way the timeout path
        // does, so the response body isn't left undrained (fd/socket leak) on
        // this DoS-defense branch.
        controller.abort();
        throw new DownloadError(
          `download exceeded limit ${maxSizeBytes} bytes`,
          "SIZE_EXCEEDED",
        );
      }
      chunks.push(value);
      if (declaredSize > 0) {
        const pct = Math.floor((total / declaredSize) * 100);
        if (pct >= lastReportedPct + 10) {
          logger?.info(
            `  → ${formatBytes(total)} / ${formatBytes(declaredSize)} (${pct}%)`,
          );
          lastReportedPct = pct;
        }
      }
    }
    logger?.debug(`downloaded ${formatBytes(total)}`);
    return Buffer.concat(chunks);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new DownloadError(`download timed out after ${timeoutMs}ms`, "TIMEOUT");
    }
    if (err instanceof DownloadError) throw err;
    throw new DownloadError(`network error: ${(err as Error).message}`, "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reject tar entries that would escape `destDir` (zip-slip / path-traversal).
 *
 * node-tar invokes the user `filter` on the RAW entry path — BEFORE the
 * `strip: 1` that peels the leading "<repo>-<sha>/" segment off GitHub
 * archives is applied. So this guard must replicate `strip: 1` itself: it
 * drops the first raw segment, then resolves the remainder against `destDir`
 * and requires the result to stay strictly inside `destDir`. Doing so on the
 * post-strip path is what node-tar will actually extract to, and resolving
 * against `destDir` is robust regardless of `..`, absolute paths, or Windows
 * drive letters.
 *
 * IMPORTANT: the first raw segment is dropped BEFORE any normalization —
 * normalizing first would let `repo/../../escape` collapse to `../escape` and
 * then falsely drop `..` as the "first segment".
 *
 * `tar.extract` also rejects symlinks/hardlinks that target outside cwd by
 * default; we keep that behavior and add an explicit path check on top.
 */
export function isSafeTarEntry(rawPath: string, destDir: string): boolean {
  if (!rawPath) return false;
  // Replicate node-tar's `strip: 1` on the RAW path first (drop the leading
  // "<repo>-<sha>/" segment).
  const stripped = stripTopLevelTarSegment(rawPath);
  // Entry was just the top-level directory itself — nothing to extract.
  if (!stripped) return false;
  // Resolve against destDir and require the result to stay strictly inside it.
  // Using `resolvedDest + sep` (not a bare prefix) prevents a sibling like
  // "/dest-evil" from matching "/dest".
  const resolvedDest = resolve(destDir);
  const target = resolve(resolvedDest, stripped);
  return target === resolvedDest || target.startsWith(resolvedDest + sep);
}

function stripTopLevelTarSegment(rawPath: string): string {
  const parts = rawPath.replace(/\\/g, "/").split("/");
  parts.shift();
  return parts.join("/");
}

export async function extractTarball(
  tarball: Buffer,
  destDir: string,
  logger?: Logger,
): Promise<number> {
  await mkdir(destDir, { recursive: true });
  let fileCount = 0;
  let rejected: string | null = null;
  await pipeline(
    Readable.from(tarball),
    extract({
      cwd: destDir,
      strip: 1,
      filter: (path) => {
        if (!stripTopLevelTarSegment(path)) {
          return false;
        }
        if (!isSafeTarEntry(path, destDir)) {
          // Capture the first offender so we can surface it in the error
          // instead of silently skipping (which is what `filter` does).
          rejected ??= path;
          return false;
        }
        return true;
      },
      onentry: () => {
        fileCount++;
      },
    }),
  );
  if (rejected !== null) {
    throw new DownloadError(
      `tarball contains unsafe entry "${rejected}" (absolute path or directory traversal)`,
      "UNSAFE_ENTRY",
    );
  }
  logger?.debug(`extracted ${fileCount} entries to ${destDir}`);
  return fileCount;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
