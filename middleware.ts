import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge-safe auth gate for pages only.
 * API routes are intentionally excluded so large CSV uploads are not
 * buffered/truncated by middleware (default 10MB). Each /api route
 * already enforces auth via getSession().
 */
const COOKIE = "prospect_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login";
  const token = req.cookies.get(COOKIE)?.value;
  const ok = Boolean(token);

  if (!ok && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (ok && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/reports/:path*", "/login"],
};
