import { jsonError, jsonOk } from "@/server/ops/http";
import { createLead, listMasterLeads } from "@/server/ops/service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const result = await listMasterLeads({
      q: url.searchParams.get("q") || undefined,
      status: url.searchParams.get("status") || undefined,
      assignedTo: url.searchParams.get("assignedTo") || undefined,
      importId: url.searchParams.get("importId") || undefined,
      available: url.searchParams.get("available") === "1",
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 50),
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      company?: string;
      title?: string;
      email?: string;
      phone?: string;
      website?: string;
      location?: string;
      importId?: string;
    };
    const lead = await createLead(body);
    return jsonOk(lead);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
