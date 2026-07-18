/** Client session key for the New Report workspace (survives navigation in this tab). */
export const NEW_REPORT_SESSION_KEY = "prospect_new_report_session_v1";

export const LARGE_CSV_ROW_THRESHOLD = 1000;
/** Files at/above this size are treated as potentially large even before row count. */
export const LARGE_CSV_SIZE_BYTES = 512 * 1024;

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
