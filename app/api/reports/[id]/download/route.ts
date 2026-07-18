import { NextResponse } from "next/server";
import { getReportDocxBuffer } from "@/server/services/report-service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const file = await getReportDocxBuffer(id);
  if (!file) {
    return NextResponse.json({ error: "DOCX not available" }, { status: 404 });
  }
  const preview = new URL(req.url).searchParams.get("preview") === "1";
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": preview
        ? `inline; filename="${file.filename}"`
        : `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
