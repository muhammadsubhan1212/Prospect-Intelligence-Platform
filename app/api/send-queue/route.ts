import { NextResponse } from "next/server";
import { getSendQueue } from "@/server/services/report-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId") || undefined;
  const status = searchParams.get("status") || undefined;
  const includeNurture = searchParams.get("includeNurture") === "1";
  const enrichEmail = searchParams.get("enrich") !== "0";
  const idsRaw = searchParams.get("ids") || "";
  const reportIds = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!batchId && reportIds.length === 0) {
    return NextResponse.json({ error: "batchId or ids required" }, { status: 400 });
  }

  const queue = await getSendQueue({
    batchId,
    reportIds: reportIds.length ? reportIds : undefined,
    status,
    includeNurture,
    enrichEmail,
  });

  return NextResponse.json(queue, { headers: { "Cache-Control": "no-store" } });
}
