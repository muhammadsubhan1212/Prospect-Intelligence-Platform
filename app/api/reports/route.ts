import { NextResponse } from "next/server";
import { getBatch, getDashboardStats, listReports } from "@/server/services/report-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId") || undefined;

  const wantsList =
    searchParams.has("page") ||
    searchParams.has("decision") ||
    searchParams.has("outcome") ||
    searchParams.has("offer") ||
    searchParams.has("sendQueueStatus") ||
    searchParams.has("q") ||
    searchParams.get("reviewOnly") === "1" ||
    searchParams.get("reviewOnly") === "true" ||
    searchParams.get("list") === "1";

  if (batchId && !wantsList) {
    const batch = await getBatch(batchId);
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    const { items } = await listReports({ pageSize: 500, batchId });
    return NextResponse.json({ batch, reports: items });
  }

  return NextResponse.json({
    stats: await getDashboardStats(),
    ...(await listReports({
      q: searchParams.get("q") || undefined,
      page: parseInt(searchParams.get("page") || "1", 10),
      pageSize: parseInt(searchParams.get("pageSize") || "20", 10),
      decision: searchParams.get("decision") || undefined,
      reviewOnly: searchParams.get("reviewOnly") === "1" || searchParams.get("reviewOnly") === "true",
      batchId,
      outcome: searchParams.get("outcome") || undefined,
      sendQueueStatus: searchParams.get("sendQueueStatus") || undefined,
      offer: searchParams.get("offer") || undefined,
    })),
  });
}
