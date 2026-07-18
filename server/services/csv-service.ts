import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { PATHS, ensureDirs, writeJsonFile, readJsonFile, appendLog } from "./paths";
import { engine, type Lead } from "./engine";

export type CsvUpload = {
  id: string;
  filename: string;
  size: number;
  rowCount: number;
  headers: string[];
  createdAt: string;
  path: string;
  /** True when the stored file was capped (e.g. first 1000 rows). */
  truncated?: boolean;
  /** Row count of the original file before truncation (if known). */
  originalRowCount?: number;
};

export type CsvPreview = {
  upload: CsvUpload;
  preview: Record<string, string>[];
  mappedPreview: Lead[];
};

export const LARGE_CSV_ROW_THRESHOLD = 1000;

const META_FILE = () => path.join(PATHS.uploads(), "uploads.json");

function loadUploads(): CsvUpload[] {
  return readJsonFile<CsvUpload[]>(META_FILE(), []);
}

function saveUploads(list: CsvUpload[]) {
  writeJsonFile(META_FILE(), list);
}

export function getUpload(id: string) {
  return loadUploads().find((u) => u.id === id) || null;
}

export function deleteUpload(id: string) {
  ensureDirs();
  const list = loadUploads();
  const upload = list.find((u) => u.id === id);
  if (!upload) return false;
  if (upload.path && fs.existsSync(upload.path)) {
    try {
      fs.unlinkSync(upload.path);
    } catch {
      /* ignore */
    }
  }
  saveUploads(list.filter((u) => u.id !== id));
  appendLog("uploads", `Deleted upload ${id}`);
  return true;
}

/**
 * Persist an uploaded CSV. Optional maxRows keeps only the first N data rows
 * (plus header) so huge files can be analysed without loading everything.
 */
export async function saveUploadedCsv(
  file: {
    name: string;
    size: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
  },
  opts?: { maxRows?: number }
): Promise<CsvPreview> {
  ensureDirs();
  const id = randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const dest = path.join(PATHS.uploads(), `${id}_${safeName}`);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(dest, buf);

  let { headers, records } = engine.readCSVObjects(dest);
  const originalRowCount = records.length;
  let truncated = false;

  const maxRows = opts?.maxRows && opts.maxRows > 0 ? opts.maxRows : undefined;
  if (maxRows && records.length > maxRows) {
    records = records.slice(0, maxRows);
    truncated = true;
    const escape = (v: string) => {
      const s = String(v ?? "");
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      headers.map(escape).join(","),
      ...records.map((row) => headers.map((h) => escape(row[h] ?? "")).join(",")),
    ];
    fs.writeFileSync(dest, lines.join("\n"), "utf8");
  }

  const upload: CsvUpload = {
    id,
    filename: file.name,
    size: truncated ? fs.statSync(dest).size : file.size || buf.length,
    rowCount: records.length,
    headers,
    createdAt: new Date().toISOString(),
    path: dest,
    truncated,
    originalRowCount: truncated ? originalRowCount : undefined,
  };

  const list = loadUploads();
  list.unshift(upload);
  saveUploads(list.slice(0, 200));
  appendLog(
    "uploads",
    `Saved ${file.name} as ${id} (${records.length} rows${truncated ? ` of ${originalRowCount}` : ""})`
  );

  const previewRows = records.slice(0, 20);
  const mappedPreview = previewRows.map((r) => engine.mapRecordToLead(r, headers));

  return { upload, preview: previewRows, mappedPreview };
}

export function previewCsv(
  uploadId: string,
  opts: { page?: number; pageSize?: number; limit?: number; q?: string } | number = 20
): CsvPreview & {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  q: string;
} {
  const upload = getUpload(uploadId);
  if (!upload) throw new Error("Upload not found");
  if (!fs.existsSync(upload.path)) throw new Error("CSV file missing on disk");
  const { headers, records } = engine.readCSVObjects(upload.path);

  // Back-compat: previewCsv(id, 20)
  const options =
    typeof opts === "number"
      ? { page: 1, pageSize: opts, q: "" }
      : {
          page: Math.max(1, opts.page || 1),
          pageSize: Math.min(500, Math.max(1, opts.pageSize || opts.limit || 20)),
          q: (opts.q || "").trim().toLowerCase(),
        };

  const mappedAll = records.map((r, i) => ({
    index: i + 1,
    lead: engine.mapRecordToLead(r, headers),
    raw: r,
  }));

  const filtered = options.q
    ? mappedAll.filter(({ lead, raw }) => {
        const hay = [
          lead.fullName,
          lead.company,
          lead.email,
          lead.title,
          lead.website,
          lead.phone,
          ...Object.values(raw),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(options.q);
      })
    : mappedAll;

  const totalRows = filtered.length;
  const pageSize = options.pageSize;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(options.page, totalPages);
  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  return {
    upload: {
      ...upload,
      rowCount: records.length,
      headers,
    },
    preview: slice.map((s) => s.raw),
    mappedPreview: slice.map((s) => ({ ...s.lead, _rowIndex: s.index } as Lead & { _rowIndex?: number })),
    page,
    pageSize,
    totalRows,
    totalPages,
    q: options.q,
  };
}
