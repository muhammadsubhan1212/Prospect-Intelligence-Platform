import { jsonError, jsonOk } from "@/server/ops/http";
import { deleteImport, updateImport } from "@/server/ops/service";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { filename?: string };
    return jsonOk(await updateImport(id, body));
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const deleteLeads = url.searchParams.get("deleteLeads") === "1";
    return jsonOk(await deleteImport(id, { deleteLeads }));
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
