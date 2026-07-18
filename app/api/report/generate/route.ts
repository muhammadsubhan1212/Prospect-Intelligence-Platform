import { NextResponse } from "next/server";
import { after } from "next/server";
import { resolveUploadCsvPath, saveUploadedCsv } from "@/server/services/csv-service";
import { createBatchJob, runBatch, type GenerateOptions } from "@/server/services/report-service";
import { blobEnabled } from "@/server/services/durable-store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
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
        csvPath = saved.upload.path;
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

    const { batch, reports } = await createBatchJob({
      csvUploadId: uploadId!,
      filename,
      csvPath: csvPath!,
      options,
    });

    // On Vercel without Blob, /tmp is not shared — finish the batch in this same invocation
    // so the client gets a completed result without polling another instance.
    const runInline = process.env.VERCEL === "1" && !blobEnabled();

    if (runInline) {
      await runBatch(batch.id);
      const { getBatch, listReports } = await import("@/server/services/report-service");
      const done = await getBatch(batch.id);
      const { items } = await listReports({ pageSize: 500 });
      const finished = items.filter((r) => r.batchId === batch.id);
      return NextResponse.json({ batch: done, reports: finished, inline: true });
    }

    after(async () => {
      try {
        await runBatch(batch.id);
      } catch (e) {
        console.error("Batch worker failed", e);
      }
    });

    return NextResponse.json({
      batch,
      reports,
      blobStorage: blobEnabled(),
      warning: !blobEnabled()
        ? "BLOB_READ_WRITE_TOKEN is not set. On Vercel, connect Blob storage so uploads/reports persist across instances."
        : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
