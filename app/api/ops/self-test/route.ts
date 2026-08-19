import { jsonError, jsonOk } from "@/server/ops/http";
import {
  allocateLeads,
  createOperator,
  importMasterCsv,
  listMasterLeads,
  previewAllocation,
} from "@/server/ops/service";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Internal proof for the allocation rule: re-import does not duplicate or recycle.
 * POST /api/ops/self-test
 */
export async function POST() {
  try {
    const csvPath = path.join(process.cwd(), "scripts", "ops-fixture.csv");
    const buf = fs.readFileSync(csvPath);
    const file = {
      name: "ops-fixture.csv",
      arrayBuffer: async () => Uint8Array.from(buf).buffer,
    };

    const first = await importMasterCsv(file);
    const a = await createOperator({ name: "Self Test A" });
    const b = await createOperator({ name: "Self Test B" });
    const c = await createOperator({ name: "Self Test C" });
    const allocA = await allocateLeads({ operatorId: a.id, count: 2 });
    const allocB = await allocateLeads({ operatorId: b.id, count: 2 });
    const second = await importMasterCsv(file);
    const preview = await previewAllocation(2);
    const allocC = await allocateLeads({ operatorId: c.id, count: 2 });
    const { total } = await listMasterLeads({ pageSize: 1 });

    const overlap = [allocA.leadIds, allocB.leadIds, allocC.leadIds].flat();
    const unique = new Set(overlap);

    return jsonOk({
      ok: unique.size === overlap.length && second.newLeads === 0 && total === first.newLeads + first.alreadyExisting,
      import1: first,
      import2: second,
      masterTotal: total,
      allocA,
      allocB,
      allocC,
      availableAfterAB: preview.available,
      noOverlap: unique.size === overlap.length,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
