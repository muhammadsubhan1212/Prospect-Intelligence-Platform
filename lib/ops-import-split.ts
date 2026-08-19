import { parseCsvText } from "@/lib/csv-workspace";

/** Stay under Vercel ~4.5MB function payload after JSON encoding. */
export const OPS_PART_MAX_BYTES = 3 * 1024 * 1024;

export type FilePart = {
  id: string;
  label: string;
  index: number;
  rowFrom: number;
  rowTo: number;
  records: Record<string, string>[];
  bytes: number;
  uploaded: boolean;
};

export type SplitPlan = {
  filename: string;
  headers: string[];
  totalRows: number;
  parts: FilePart[];
};

export function splitCsvIntoParts(filename: string, text: string, maxBytes = OPS_PART_MAX_BYTES): SplitPlan {
  const parsed = parseCsvText(text);
  const headers = parsed.headers;
  const records = parsed.records;
  const headerBytes = JSON.stringify(headers).length;
  const parts: FilePart[] = [];
  let bucket: Record<string, string>[] = [];
  let bucketBytes = headerBytes + 80;
  let start = 1;

  function flush() {
    if (!bucket.length) return;
    const index = parts.length;
    const rowFrom = start;
    const rowTo = start + bucket.length - 1;
    parts.push({
      id: `L${index + 1}`,
      label: `L${index + 1}`,
      index,
      rowFrom,
      rowTo,
      records: bucket,
      bytes: bucketBytes,
      uploaded: false,
    });
    start = rowTo + 1;
    bucket = [];
    bucketBytes = headerBytes + 80;
  }

  for (const rec of records) {
    const extra = JSON.stringify(rec).length + 2;
    if (bucket.length && bucketBytes + extra > maxBytes) flush();
    bucket.push(rec);
    bucketBytes += extra;
  }
  flush();

  return { filename, headers, totalRows: records.length, parts };
}
