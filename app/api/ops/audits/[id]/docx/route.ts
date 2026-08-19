import { jsonError } from "@/server/ops/http";
import { getAudit, markAuditDownloaded } from "@/server/ops/service";
import { buildAuditDocx } from "@/server/ops/audit";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const found = await getAudit(id);
    if (!found?.document) return jsonError("Audit not found", 404);
    const url = new URL(req.url);
    await markAuditDownloaded(id, url.searchParams.get("operatorId") || undefined, "docx");
    const buf = await buildAuditDocx(found.document);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${(found.record.company || "audit").replace(/[^\w.-]+/g, "_")}-review.docx"`,
      },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
