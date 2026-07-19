import { NextResponse } from "next/server";
import { getReportsDocxZip } from "@/server/services/report-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    if (!ids.length) {
      return NextResponse.json({ error: "ids[] required" }, { status: 400 });
    }
    const zip = await getReportsDocxZip(ids);
    if (!zip) {
      return NextResponse.json({ error: "None of the selected reports have a DOCX available yet." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(zip.buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zip.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Included-Count": String(zip.included.length),
        "X-Missing-Count": String(zip.missing.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
