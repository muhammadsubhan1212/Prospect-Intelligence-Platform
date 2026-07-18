/**
 * Shared storage for local disk + Vercel Blob.
 * On Vercel, /tmp is per-instance — without Blob, upload then preview hits another machine.
 * Set BLOB_READ_WRITE_TOKEN (Vercel Storage → Blob → Connect) for durable files.
 *
 * Matches store access mode: private stores require access: "private" (default here).
 * Set BLOB_ACCESS=public only if your Blob store was created as public.
 */

import { put, list, del, get } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { storageRoot, ensureDirs } from "./paths";

export function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

type BlobAccess = "public" | "private";

function blobAccess(): BlobAccess {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

function abs(rel: string) {
  return path.join(storageRoot(), rel.replace(/\\/g, "/"));
}

function blobKey(rel: string) {
  return `prospect-storage/${rel.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

export function toRelPath(absoluteOrRel: string): string {
  const root = storageRoot().replace(/\\/g, "/");
  const normalized = absoluteOrRel.replace(/\\/g, "/");
  if (normalized.startsWith(root)) {
    return normalized.slice(root.length).replace(/^\/+/, "");
  }
  if (normalized.startsWith("/tmp/prospect-platform-storage/")) {
    return normalized.slice("/tmp/prospect-platform-storage/".length);
  }
  return absoluteOrRel.replace(/^\/+/, "");
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export async function durableWriteFile(
  rel: string,
  data: Buffer | string,
  contentType?: string
): Promise<string> {
  ensureDirs();
  const full = abs(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);

  if (blobEnabled()) {
    await put(blobKey(rel), data, {
      access: blobAccess(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType:
        contentType ||
        (typeof data === "string" ? "text/plain; charset=utf-8" : "application/octet-stream"),
    });
  }
  return full;
}

async function readFromBlob(rel: string): Promise<Buffer | null> {
  const key = blobKey(rel);
  const access = blobAccess();
  // Always bypass CDN for shared mutable state (index.json) and fresh DOCX.
  const getOpts = { access, useCache: false as const };

  try {
    const result = await get(key, getOpts);
    if (result?.statusCode === 200 && result.stream) {
      return streamToBuffer(result.stream);
    }
  } catch {
    /* fall through */
  }

  const { blobs } = await list({ prefix: key, limit: 20 });
  const hit = blobs.find((b) => b.pathname === key);
  if (!hit) return null;

  if (access === "private") {
    try {
      const result = await get(hit.url, getOpts);
      if (result?.statusCode === 200 && result.stream) {
        return streamToBuffer(result.stream);
      }
    } catch {
      return null;
    }
    return null;
  }

  const res = await fetch(hit.url, { cache: "no-store" });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

function cacheLocal(rel: string, buf: Buffer) {
  const full = abs(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return full;
}

export async function durableReadFile(rel: string): Promise<Buffer | null> {
  const full = abs(rel);

  // When Blob is enabled it is the source of truth. Preferring /tmp first caused
  // stale per-instance index.json to overwrite Blob and drop new reports from the UI
  // even though the .docx files were still in Blob.
  if (blobEnabled()) {
    const fromBlob = await readFromBlob(rel);
    if (fromBlob) {
      cacheLocal(rel, fromBlob);
      return fromBlob;
    }
  }

  if (fs.existsSync(full)) return fs.readFileSync(full);
  return null;
}

/** On Vercel, /tmp is per-instance — Blob is required or the next request 404s. */
export function assertBlobOnVercel(action = "this operation") {
  const onVercel = process.env.VERCEL === "1" || !!process.env.VERCEL_ENV;
  if (onVercel && !blobEnabled()) {
    throw new Error(
      `Vercel Blob is not connected — ${action} cannot persist across serverless instances. ` +
        `In Vercel: Storage → Blob → Create → Connect to this project (sets BLOB_READ_WRITE_TOKEN), then redeploy.`
    );
  }
}

export async function durableReadJson<T>(rel: string, fallback: T): Promise<T> {
  const buf = await durableReadFile(rel);
  if (!buf) return fallback;
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function durableWriteJson(rel: string, data: unknown): Promise<void> {
  await durableWriteFile(rel, JSON.stringify(data, null, 2), "application/json; charset=utf-8");
}

export async function durableEnsureLocal(relOrAbs: string): Promise<string | null> {
  const rel = toRelPath(relOrAbs);
  const full = abs(rel);
  // Always go through durableReadFile so Blob wins over stale /tmp when enabled.
  const buf = await durableReadFile(rel);
  return buf ? full : null;
}

export async function durableDelete(relOrAbs: string): Promise<void> {
  const rel = toRelPath(relOrAbs);
  const full = abs(rel);
  if (fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
  if (!blobEnabled()) return;
  try {
    const key = blobKey(rel);
    const { blobs } = await list({ prefix: key, limit: 5 });
    const hit = blobs.find((b) => b.pathname === key);
    if (hit) await del(hit.url);
  } catch {
    /* ignore */
  }
}

export async function durableListRelPaths(prefix: string): Promise<string[]> {
  if (!blobEnabled()) return [];
  const keyPrefix = blobKey(prefix);
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: keyPrefix, limit: 200, cursor });
    for (const b of result.blobs) {
      out.push(b.pathname.replace(/^prospect-storage\//, ""));
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return out;
}

export function localAbs(rel: string) {
  return abs(rel);
}
