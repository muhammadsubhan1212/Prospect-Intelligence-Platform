import { NextResponse } from "next/server";
import { login, logout, getSession } from "@/server/services/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ authenticated: !!session, user: session?.sub || null });
}

export async function POST(req: Request) {
  const body = await req.json();
  const result = await login(String(body.username || ""), String(body.password || ""));
  if (!result.ok) return NextResponse.json(result, { status: 401 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await logout();
  return NextResponse.json({ ok: true });
}
