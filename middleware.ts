import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPublicPath, SESSION_COOKIE, sessionTokenValid } from "@/lib/platform-auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const signedIn = await sessionTokenValid(token);

  if (pathname === "/login" && signedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (isPublicPath(pathname, method)) return NextResponse.next();

  if (signedIn) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }

  const login = new URL("/login", req.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
