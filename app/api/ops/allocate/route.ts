import { jsonError, jsonOk } from "@/server/ops/http";
import { allocateLeads, previewAllocation } from "@/server/ops/service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const count = Number(url.searchParams.get("count") || 0);
    const importId = url.searchParams.get("importId") || undefined;
    return jsonOk(await previewAllocation(count, importId));
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      operatorId?: string;
      count?: number;
      leadIds?: string[];
      dailyTarget?: number;
      reassign?: boolean;
      importId?: string;
    };
    if (!body.operatorId) return jsonError("operatorId is required");
    const result = await allocateLeads({
      operatorId: body.operatorId,
      count: body.count,
      leadIds: body.leadIds,
      dailyTarget: body.dailyTarget,
      reassign: body.reassign,
      importId: body.importId,
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
