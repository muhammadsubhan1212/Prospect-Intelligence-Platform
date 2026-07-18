/**
 * Path helpers for durable local storage.
 * On Vercel, filesystem under /tmp is used (ephemeral per instance).
 * For production durable files, swap these helpers for Vercel Blob / S3.
 */

import fs from "fs";
import path from "path";

function isVercel() {
  return process.env.VERCEL === "1" || !!process.env.VERCEL_ENV;
}

export function storageRoot(): string {
  if (process.env.STORAGE_ROOT) return path.resolve(process.env.STORAGE_ROOT);
  if (isVercel()) return path.join("/tmp", "prospect-platform-storage");
  return path.join(process.cwd(), "storage");
}

export const PATHS = {
  uploads: () => path.join(storageRoot(), "uploads"),
  reports: () => path.join(storageRoot(), "reports"),
  json: () => path.join(storageRoot(), "json"),
  logs: () => path.join(storageRoot(), "logs"),
  jobs: () => path.join(storageRoot(), "jobs"),
  batches: () => path.join(storageRoot(), "batches"),
  index: () => path.join(storageRoot(), "index.json"),
};

export function ensureDirs() {
  for (const dir of [
    PATHS.uploads(),
    PATHS.reports(),
    PATHS.json(),
    PATHS.logs(),
    PATHS.jobs(),
    PATHS.batches(),
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export function appendLog(name: string, line: string) {
  ensureDirs();
  const file = path.join(PATHS.logs(), `${name}.log`);
  const stamp = new Date().toISOString();
  fs.appendFileSync(file, `[${stamp}] ${line}\n`, "utf8");
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, data: unknown) {
  ensureDirs();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
