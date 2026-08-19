import { jsonError, jsonOk } from "@/server/ops/http";
import { createFreeAudit } from "@/server/ops/service";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { operatorId?: string };
    const result = await createFreeAudit(id, body.operatorId);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
