import { jsonError, jsonOk } from "@/server/ops/http";
import { getOpsStats } from "@/server/ops/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonOk(await getOpsStats());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
