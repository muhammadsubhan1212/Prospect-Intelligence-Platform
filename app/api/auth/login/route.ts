import { NextResponse } from "next/server";
import {
  ADMIN_EMAIL,
  createSessionToken,
  credentialsMatch,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
} from "@/lib/platform-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!credentialsMatch(body.email || "", body.password || "")) {
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true, email: ADMIN_EMAIL });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
