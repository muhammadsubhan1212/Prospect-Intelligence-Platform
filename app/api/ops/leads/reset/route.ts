import { jsonError, jsonOk } from "@/server/ops/http";
import { resetMasterLeads } from "@/server/ops/service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      leadIds?: string[];
      allMatching?: boolean;
      q?: string;
      status?: string;
      assignedTo?: string;
      available?: boolean;
      importId?: string;
      operatorId?: string;
      batchId?: string;
      allForOperator?: boolean;
    };
    const result = await resetMasterLeads(body);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
