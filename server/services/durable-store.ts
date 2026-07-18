/**
 * Shared storage for local disk + Vercel Blob.
 * On Vercel, /tmp is per-instance — without Blob, upload then preview hits another machine.
 * Set BLOB_READ_WRITE_TOKEN (Vercel Storage → Blob → Connect) for durable files.
 */

import { put, list, del } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { storageRoot, ensureDirs } from "./paths";

export function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType:
        contentType ||
        (typeof data === "string" ? "text/plain; charset=utf-8" : "application/octet-stream"),
    });
  }
  return full;
}

export async function durableReadFile(rel: string): Promise<Buffer | null> {
  const full = abs(rel);
  if (fs.existsSync(full)) return fs.readFileSync(full);

  if (!blobEnabled()) return null;

  const key = blobKey(rel);
  const { blobs } = await list({ prefix: key, limit: 20 });
  const hit = blobs.find((b) => b.pathname === key);
  if (!hit) return null;

  const res = await fetch(hit.url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return buf;
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
  if (fs.existsSync(full)) return full;
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

export function localAbs(rel: string) {
  return abs(rel);
}
