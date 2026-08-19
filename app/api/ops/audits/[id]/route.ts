import { jsonError } from "@/server/ops/http";
import { getAudit } from "@/server/ops/service";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const found = await getAudit(id);
    if (!found) return jsonError("Audit not found", 404);
    const url = new URL(req.url);
    if (url.searchParams.get("format") === "html") {
      return new Response(found.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return Response.json(found);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
