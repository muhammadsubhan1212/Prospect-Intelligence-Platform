import mammoth from "mammoth";
import { getReport, getReportDocxBuffer } from "./report-service";

/**
 * Convert the generated .docx into HTML for an in-browser Word/PDF-like preview.
 * Uses the real DOCX bytes — same document someone would open in MS Word.
 */
export async function renderReportDocxAsHtml(reportId: string): Promise<{
  html: string;
  messages: string[];
  filename: string;
}> {
  const report = await getReport(reportId);
  if (!report) throw new Error("Report not found");
  const file = await getReportDocxBuffer(reportId);
  if (!file) {
    throw new Error("DOCX not available for this report — generate or re-run first.");
  }

  const result = await mammoth.convertToHtml(
    { buffer: file.buffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1.doc-h1:fresh",
        "p[style-name='Heading 2'] => h2.doc-h2:fresh",
        "r[style-name='Strong'] => strong",
      ],
    }
  );

  return {
    html: result.value,
    messages: (result.messages || []).map((m) => m.message),
    filename: file.filename,
  };
}
