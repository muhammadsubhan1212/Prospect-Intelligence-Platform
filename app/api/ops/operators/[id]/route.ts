import { jsonError, jsonOk } from "@/server/ops/http";
import { getOperatorDashboard, setOperatorActive } from "@/server/ops/service";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const dash = await getOperatorDashboard(id);
    if (!dash) return jsonError("Operator not found", 404);
    return jsonOk(dash);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { active?: boolean };
    if (typeof body.active !== "boolean") return jsonError("active boolean required");
    const op = await setOperatorActive(id, body.active);
    return jsonOk(op);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
