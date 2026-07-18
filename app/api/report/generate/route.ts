import { NextResponse } from "next/server";
import { after } from "next/server";
import { getUpload } from "@/server/services/csv-service";
import { createBatchJob, runBatch, type GenerateOptions } from "@/server/services/report-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      uploadId: string;
      options?: GenerateOptions;
    };
    if (!body.uploadId) {
      return NextResponse.json({ error: "uploadId required" }, { status: 400 });
    }
    const upload = getUpload(body.uploadId);
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    const options: GenerateOptions = {
      saveJson: true,
      timeout: 12000,
      ...(body.options || {}),
    };

    const { batch, reports } = createBatchJob({
      csvUploadId: upload.id,
      filename: upload.filename,
      csvPath: upload.path,
      options,
    });

    // Background: do not block the HTTP response
    after(async () => {
      try {
        await runBatch(batch.id);
      } catch (e) {
        console.error("Batch worker failed", e);
      }
    });

    return NextResponse.json({ batch, reports });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
