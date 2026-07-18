import { NextResponse } from "next/server";
import { resolveUploadCsvPath, saveUploadedCsv } from "@/server/services/csv-service";
import {
  createBatchJob,
  runBatch,
  getBatch,
  listReports,
  getReportJson,
  type GenerateOptions,
} from "@/server/services/report-service";
import { assertBlobOnVercel, blobEnabled } from "@/server/services/durable-store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    assertBlobOnVercel("report generation");
    const contentType = req.headers.get("content-type") || "";
    let uploadId: string | undefined;
    let options: GenerateOptions = { saveJson: true, timeout: 12000 };
    let csvPath: string | undefined;
    let filename = "upload.csv";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const optionsRaw = form.get("options");
      if (optionsRaw && typeof optionsRaw === "string") {
        try {
          options = { ...options, ...(JSON.parse(optionsRaw) as GenerateOptions) };
        } catch {
          /* ignore */
        }
      }
      uploadId = String(form.get("uploadId") || "") || undefined;

      if (file && file instanceof File) {
        const saved = await saveUploadedCsv(file);
        uploadId = saved.upload.id;
        filename = saved.upload.filename;
        const resolved = await resolveUploadCsvPath(uploadId);
        csvPath = resolved.csvPath;
      } else if (uploadId) {
        const resolved = await resolveUploadCsvPath(uploadId);
        csvPath = resolved.csvPath;
        filename = resolved.upload.filename;
      } else {
        return NextResponse.json({ error: "file or uploadId required" }, { status: 400 });
      }
    } else {
      const body = (await req.json()) as { uploadId: string; options?: GenerateOptions };
      if (!body.uploadId) {
        return NextResponse.json({ error: "uploadId required" }, { status: 400 });
      }
      uploadId = body.uploadId;
      options = { ...options, ...(body.options || {}) };
      const resolved = await resolveUploadCsvPath(uploadId);
      csvPath = resolved.csvPath;
      filename = resolved.upload.filename;
    }

    const { batch } = await createBatchJob({
      csvUploadId: uploadId!,
      filename,
      csvPath: csvPath!,
      options,
    });

    // Always process in this same request — no background queue.
    // Vercel `after()` left jobs stuck as "queued"; users expect immediate processing.
    await runBatch(batch.id);

    const done = await getBatch(batch.id);
    const { items } = await listReports({ pageSize: 500 });
    const finished = items.filter((r) => r.batchId === batch.id);
    // Include research JSON so the browser can open the report even if the next
    // serverless instance briefly can't see Blob index.json.
    const reports = await Promise.all(
      finished.map(async (r) => ({
        ...r,
        data: r.status === "completed" ? await getReportJson(r.id) : null,
      }))
    );

    return NextResponse.json({
      batch: done,
      reports,
      inline: true,
      blobStorage: blobEnabled(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
