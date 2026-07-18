import { NextResponse } from "next/server";
import { deleteUpload, getUpload } from "@/server/services/csv-service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const upload = await getUpload(id);
  if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  return NextResponse.json({ upload });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deleteUpload(id);
  if (!ok) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
