import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract } from "tar";
import type { Logger } from "./log.js";

export type DownloadErrorCode =
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "SIZE_EXCEEDED"
  | "NETWORK"
  | "ABORTED";

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
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
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

export async function extractTarball(
  tarball: Buffer,
  destDir: string,
  logger?: Logger,
): Promise<number> {
  await mkdir(destDir, { recursive: true });
  let fileCount = 0;
  await pipeline(
    Readable.from(tarball),
    extract({
      cwd: destDir,
      strip: 1,
      onentry: () => {
        fileCount++;
      },
    }),
  );
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
