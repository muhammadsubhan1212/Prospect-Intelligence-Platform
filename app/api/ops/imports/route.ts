import { jsonError, jsonOk } from "@/server/ops/http";
import { listImports } from "@/server/ops/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonOk({ imports: await listImports() });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
