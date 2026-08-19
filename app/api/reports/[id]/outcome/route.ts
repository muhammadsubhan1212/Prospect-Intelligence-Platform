import { NextResponse } from "next/server";
import { z } from "zod";
import { updateOutreachOutcome } from "@/server/services/report-service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  status: z.enum(["not_sent", "sent", "replied", "meeting", "not_interested", "bounced"]),
  note: z.string().max(500).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const raw = await req.json();
    const body = Body.parse(raw);
    const report = await updateOutreachOutcome(id, body);
    if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ report, outreachOutcome: report.outreachOutcome });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
