/** Client session key for the New Report workspace (survives navigation in this tab). */
export const NEW_REPORT_SESSION_KEY = "prospect_new_report_session_v1";

export const LARGE_CSV_ROW_THRESHOLD = 1000;
/** Files at/above this size are treated as potentially large even before row count. */
export const LARGE_CSV_SIZE_BYTES = 512 * 1024;
/**
 * Vercel Functions reject request bodies over ~4.5MB (hard platform limit).
 * Stay under this before multipart overhead so uploads don't get a naked 413.
 */
export const VERCEL_SAFE_UPLOAD_BYTES = 4 * 1024 * 1024;

export type NewReportSession = {
  uploadId: string;
  filename: string;
  size: number;
  rowCount: number;
  headers: string[];
  truncated?: boolean;
  originalRowCount?: number;
  mode: "row" | "range" | "all" | "email" | "company";
  row: string;
  rowFrom: string;
  rowTo: string;
  limit: string;
  email: string;
  company: string;
  timeoutMs: string;
  savedAt: string;
};

export function loadNewReportSession(): NewReportSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(NEW_REPORT_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NewReportSession;
  } catch {
    return null;
  }
}

export function saveNewReportSession(session: NewReportSession) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(NEW_REPORT_SESSION_KEY, JSON.stringify(session));
}

export function clearNewReportSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(NEW_REPORT_SESSION_KEY);
}

/** Rough data-row estimate from CSV text (header excluded). */
export async function estimateCsvRows(file: File): Promise<number> {
  // Very large: avoid reading entire file into memory — rough byte estimate
  if (file.size > 25 * 1024 * 1024) {
    return Math.max(LARGE_CSV_ROW_THRESHOLD + 1, Math.floor(file.size / 180));
  }
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

/**
 * Build a smaller File with only the header + first `maxRows` data lines
 * so Vercel never sees the full multi‑MB CSV body.
 */
export async function truncateCsvFile(file: File, maxRows: number): Promise<File> {
  if (maxRows <= 0) return file;

  const lines: string[] = [];
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (lines.length < maxRows + 1) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.length) {
          const last = buffer.replace(/\r$/, "");
          if (last.trim().length > 0 || lines.length === 0) lines.push(last);
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim().length === 0 && lines.length > 0) continue;
        lines.push(part);
        if (lines.length >= maxRows + 1) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const body = lines.join("\n") + "\n";
  return new File([body], file.name, { type: file.type || "text/csv" });
}

/** Parse upload API responses that may be plain text (e.g. Vercel 413 HTML/text). */
export async function readUploadError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { error?: string };
    if (json.error) return json.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 413 || /payload too large|request entity|FUNCTION_PAYLOAD/i.test(text)) {
    return `File is too large for Vercel (max ~4.5MB per upload). Use “Load first ${LARGE_CSV_ROW_THRESHOLD.toLocaleString()} rows”, or split the CSV.`;
  }
  return text.trim().slice(0, 240) || `Upload failed (${res.status})`;
}
