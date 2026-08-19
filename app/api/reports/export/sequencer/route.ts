import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSequencerCsv } from "@/server/services/report-service";
import { assertBlobOnVercel } from "@/server/services/durable-store";

export const runtime = "nodejs";

const PostBody = z.object({
  reportIds: z.array(z.string()).optional(),
  batchId: z.string().optional(),
  decisions: z.array(z.enum(["CONTACT", "NURTURE", "SKIP"])).optional(),
  includeSkip: z.boolean().optional(),
  format: z.enum(["csv", "json"]).optional(),
});

export async function GET(req: Request) {
  try {
    assertBlobOnVercel("sequencer export");
    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get("batchId") || undefined;
    const decision = searchParams.get("decision");
    const includeSkip = searchParams.get("includeSkip") === "true";
    const format = searchParams.get("format") === "json" ? "json" : "csv";
    const decisions = decision
      ? (decision
          .split(",")
          .map((d) => d.trim().toUpperCase())
          .filter(Boolean) as Array<"CONTACT" | "NURTURE" | "SKIP">)
      : includeSkip
        ? (["CONTACT", "NURTURE", "SKIP"] as const)
        : undefined;

    const result = await buildSequencerCsv({
      batchId,
      decisions: decisions ? [...decisions] : undefined,
      includeSkip,
    });

    if (format === "json") {
      return NextResponse.json({
        filename: result.filename.replace(/\.csv$/, "_actionCards.json"),
        rowCount: result.rowCount,
        actionCards: result.actionCards,
      });
    }

    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Row-Count": String(result.rowCount),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    assertBlobOnVercel("sequencer export");
    const raw = await req.json();
    const body = PostBody.parse(raw);
    const result = await buildSequencerCsv({
      batchId: body.batchId,
      reportIds: body.reportIds,
      decisions: body.decisions,
      includeSkip: body.includeSkip,
    });

    if (body.format === "json") {
      return NextResponse.json({
        filename: result.filename.replace(/\.csv$/, "_actionCards.json"),
        rowCount: result.rowCount,
        actionCards: result.actionCards,
      });
    }

    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Row-Count": String(result.rowCount),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
