import { jsonError, jsonOk } from "@/server/ops/http";
import { recordLeadAction } from "@/server/ops/service";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      operatorId?: string;
      action?: string;
      note?: string;
      message?: { to?: string; subject?: string; body?: string };
    };
    if (!body.operatorId || !body.action) return jsonError("operatorId and action are required");
    const result = await recordLeadAction({
      leadId: id,
      operatorId: body.operatorId,
      action: body.action,
      note: body.note,
      message: body.message,
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
