import { NextResponse } from "next/server";
import { z } from "zod";
import { updateSendQueueStatus } from "@/server/services/report-service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  status: z.enum(["pending", "opened_gmail", "sent", "skipped", "failed"]),
  lastSendError: z.string().max(500).optional(),
  allowSoftOvershoot: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = Body.parse(await req.json());
    const result = await updateSendQueueStatus(id, body);
    if (!result.report) {
      return NextResponse.json({ error: result.error || "Not found" }, { status: 404 });
    }
    if (result.error) {
      return NextResponse.json(
        { error: result.error, report: result.report, sendsToday: result.sendsToday },
        { status: 429 }
      );
    }
    return NextResponse.json({
      report: result.report,
      sendQueueStatus: result.report.sendQueueStatus,
      sentAt: result.report.sentAt,
      outreachOutcome: result.report.outreachOutcome,
      sendsToday: result.sendsToday,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
