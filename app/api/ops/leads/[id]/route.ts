import { jsonError, jsonOk } from "@/server/ops/http";
import { deleteLead, getMasterLead, reassignLead, updateLead } from "@/server/ops/service";
import type { MasterLead } from "@/server/ops/types";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const detail = await getMasterLead(id);
    if (!detail) return jsonError("Lead not found", 404);
    return jsonOk(detail);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Partial<MasterLead> & { operatorId?: string };
    if (body.operatorId) {
      const result = await reassignLead(id, body.operatorId);
      return jsonOk(result);
    }
    const lead = await updateLead(id, body);
    return jsonOk({ lead });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await deleteLead(id));
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
