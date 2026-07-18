import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE = "prospect_session";

function secret() {
  const s = process.env.AUTH_SECRET || "dev-prospect-platform-secret-change-me";
  return new TextEncoder().encode(s);
}

export function getAdminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "admin123",
  };
}

export async function createSessionToken(username: string) {
  return new SignJWT({ sub: username, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as { sub?: string; role?: string };
  } catch {
    return null;
  }
}

export async function login(username: string, password: string) {
  const creds = getAdminCredentials();
  if (username !== creds.username || password !== creds.password) {
    return { ok: false as const, error: "Invalid username or password" };
  }
  const token = await createSessionToken(username);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return { ok: true as const };
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export { COOKIE };
