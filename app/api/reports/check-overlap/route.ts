import { NextResponse } from "next/server";
import { resolveUploadCsvPath, saveUploadedCsv } from "@/server/services/csv-service";
import { previewAnalysisOverlaps, type GenerateOptions } from "@/server/services/report-service";
import { assertBlobOnVercel } from "@/server/services/durable-store";

export const runtime = "nodejs";

async function resolveCsvAndOptions(req: Request): Promise<{
  csvPath: string;
  filename: string;
  options: GenerateOptions;
}> {
  const contentType = req.headers.get("content-type") || "";
  let options: GenerateOptions = { saveJson: true, timeout: 12000 };
  let csvPath: string;
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
    let uploadId = String(form.get("uploadId") || "") || undefined;
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
      throw new Error("file or uploadId required");
    }
  } else {
    const body = (await req.json()) as { uploadId: string; options?: GenerateOptions };
    if (!body.uploadId) throw new Error("uploadId required");
    options = { ...options, ...(body.options || {}) };
    const resolved = await resolveUploadCsvPath(body.uploadId);
    csvPath = resolved.csvPath;
    filename = resolved.upload.filename;
  }

  return { csvPath, filename, options };
}

/** Preview whether selected leads were already analyzed / sent. */
export async function POST(req: Request) {
  try {
    assertBlobOnVercel("overlap check");
    const { csvPath, filename, options } = await resolveCsvAndOptions(req);
    const preview = await previewAnalysisOverlaps({ csvPath, options, filename });
    return NextResponse.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
