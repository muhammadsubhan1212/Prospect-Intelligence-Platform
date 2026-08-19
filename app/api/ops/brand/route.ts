import { jsonError, jsonOk } from "@/server/ops/http";
import { deleteOperatorBrand, listBrandOwners, loadBrand, saveBrand, type PitchBrand } from "@/server/ops/brand";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const operatorId = new URL(req.url).searchParams.get("operatorId") || undefined;
    const brand = await loadBrand(operatorId);
    const owners = await listBrandOwners();
    return jsonOk({
      brand,
      scope: operatorId && owners.operatorIds.includes(operatorId) ? "operator" : "default",
      customOperatorIds: owners.operatorIds,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Partial<PitchBrand> & { operatorId?: string | null };
    const operatorId = body.operatorId || undefined;
    const { operatorId: _drop, ...patch } = body;
    const brand = await saveBrand(patch, operatorId);
    return jsonOk({ brand, scope: operatorId ? "operator" : "default" });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}

export async function DELETE(req: Request) {
  try {
    const operatorId = new URL(req.url).searchParams.get("operatorId");
    if (!operatorId) return jsonError("operatorId is required");
    const brand = await deleteOperatorBrand(operatorId);
    return jsonOk({ brand, scope: "default" });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
