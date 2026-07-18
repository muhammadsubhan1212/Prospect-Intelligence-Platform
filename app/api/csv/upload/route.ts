import { NextResponse } from "next/server";
import { saveUploadedCsv, LARGE_CSV_ROW_THRESHOLD } from "@/server/services/csv-service";

export const runtime = "nodejs";
export const maxDuration = 60;
/** Allow large CSV bodies on this route (Vercel/Node). */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    // Soft guidance — actual limit is next.config experimental body size (100mb)
    if (contentLength > 95 * 1024 * 1024) {
      return NextResponse.json(
        {
          error:
            "CSV is larger than ~95MB. Choose “Load first 1,000 rows” on New Report, or split the file.",
        },
        { status: 413 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing CSV file" }, { status: 400 });
    }
    if (!/\.csv$/i.test(file.name)) {
      return NextResponse.json({ error: "Only .csv files are supported" }, { status: 400 });
    }

    const maxRowsRaw = form.get("maxRows");
    let maxRows: number | undefined;
    if (maxRowsRaw != null && String(maxRowsRaw).trim() !== "") {
      const n = parseInt(String(maxRowsRaw), 10);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json({ error: "maxRows must be a positive number" }, { status: 400 });
      }
      maxRows = n;
    }

    const result = await saveUploadedCsv(file, { maxRows });
    return NextResponse.json({
      ...result,
      largeCsvThreshold: LARGE_CSV_ROW_THRESHOLD,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("CSV upload failed:", err);
    return NextResponse.json(
      {
        error:
          message.includes("Unexpected end") || message.includes("FormData")
            ? "Upload was truncated or corrupted (file too large for the server buffer). Use “Load first 1,000 rows” or raise the body size limit / split the CSV."
            : message,
      },
      { status: 500 }
    );
  }
}
