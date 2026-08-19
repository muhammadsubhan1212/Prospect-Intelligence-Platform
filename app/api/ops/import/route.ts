import { jsonError, jsonOk } from "@/server/ops/http";
import { importMasterCsv } from "@/server/ops/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) return jsonError("CSV file is required");
    const result = await importMasterCsv(file);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
