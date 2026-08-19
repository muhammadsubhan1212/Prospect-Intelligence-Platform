import { jsonError, jsonOk } from "@/server/ops/http";
import { createOperator, listOperators } from "@/server/ops/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonOk({ operators: await listOperators() });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { name?: string; email?: string; phone?: string };
    const op = await createOperator({ name: body.name || "", email: body.email, phone: body.phone });
    return jsonOk(op);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
