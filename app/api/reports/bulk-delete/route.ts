import { NextResponse } from "next/server";
import { deleteReports } from "@/server/services/report-service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    if (!ids.length) {
      return NextResponse.json({ error: "ids[] required" }, { status: 400 });
    }
    const result = await deleteReports(ids);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
