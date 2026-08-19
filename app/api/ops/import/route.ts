import { jsonError, jsonOk } from "@/server/ops/http";
import { importMasterCsv, importMasterRecords } from "@/server/ops/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        filename?: string;
        headers?: string[];
        records?: Record<string, string>[];
        importId?: string;
        partLabel?: string;
      };
      if (!body.filename || !body.headers?.length || !body.records) {
        return jsonError("filename, headers, and records are required");
      }
      const result = await importMasterRecords({
        filename: body.filename,
        headers: body.headers,
        records: body.records,
        importId: body.importId,
        partLabel: body.partLabel,
      });
      return jsonOk(result);
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) return jsonError("CSV file is required");
    if (file.size > 3.5 * 1024 * 1024) {
      return jsonError(
        "This file is too large for a single Vercel upload. On Master leads, choose the file and upload L1, L2, L3… one part at a time."
      );
    }
    const result = await importMasterCsv(file);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
