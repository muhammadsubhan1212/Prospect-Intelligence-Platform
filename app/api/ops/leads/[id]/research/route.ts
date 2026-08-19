import { jsonError, jsonOk } from "@/server/ops/http";
import { generateResearchForLead } from "@/server/ops/service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { operatorId?: string };
    const result = await generateResearchForLead(id, body.operatorId);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
