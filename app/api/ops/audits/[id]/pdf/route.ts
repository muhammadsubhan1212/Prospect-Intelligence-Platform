import { jsonError } from "@/server/ops/http";
import { getAudit, markAuditDownloaded } from "@/server/ops/service";
import { renderAuditPdf } from "@/server/ops/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const found = await getAudit(id);
    if (!found?.html) return jsonError("Audit not found", 404);
    const url = new URL(req.url);
    await markAuditDownloaded(id, url.searchParams.get("operatorId") || undefined, "pdf");
    const pdf = await renderAuditPdf(found.html);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${(found.record.company || "audit").replace(/[^\w.-]+/g, "_")}-review.pdf"`,
      },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
