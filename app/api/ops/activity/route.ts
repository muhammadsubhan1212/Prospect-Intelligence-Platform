import { jsonError, jsonOk } from "@/server/ops/http";
import { listActivities, listActivityThreads } from "@/server/ops/service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const grouped = url.searchParams.get("grouped") !== "0";
    const opts = {
      userId: url.searchParams.get("userId") || undefined,
      type: url.searchParams.get("type") || undefined,
      q: url.searchParams.get("q") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 50),
    };
    return jsonOk(grouped ? await listActivityThreads(opts) : await listActivities(opts));
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
