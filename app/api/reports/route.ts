import { NextResponse } from "next/server";
import { getBatch, getDashboardStats, listReports } from "@/server/services/report-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");
  if (batchId) {
    const batch = getBatch(batchId);
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    const { items } = listReports({ pageSize: 500 });
    const reports = items.filter((r) => r.batchId === batchId);
    return NextResponse.json({ batch, reports });
  }

  return NextResponse.json({
    stats: getDashboardStats(),
    ...listReports({
      q: searchParams.get("q") || undefined,
      page: parseInt(searchParams.get("page") || "1", 10),
      pageSize: parseInt(searchParams.get("pageSize") || "20", 10),
    }),
  });
}
