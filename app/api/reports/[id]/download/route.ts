import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getReport } from "@/server/services/report-service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const report = getReport(id);
  if (!report?.docxPath || !fs.existsSync(report.docxPath)) {
    return NextResponse.json({ error: "DOCX not available" }, { status: 404 });
  }
  const buf = fs.readFileSync(report.docxPath);
  const filename = path.basename(report.docxPath);
  const preview = new URL(req.url).searchParams.get("preview") === "1";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": preview
        ? `inline; filename="${filename}"`
        : `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
