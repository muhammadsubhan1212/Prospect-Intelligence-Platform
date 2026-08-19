/** Hardcoded admin gate for the main platform. Operator /operator/:id links stay public. */

export const ADMIN_EMAIL = "Admin@gmail.com";
export const ADMIN_PASSWORD = "Power1bad2@";
export const SESSION_COOKIE = "oa_admin_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

const SESSION_SECRET = "oa-admin-session-v1-Power1bad2@";

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toHex(sig);
}

export function credentialsMatch(email: string, password: string) {
  const e = String(email || "").trim().toLowerCase();
  const p = String(password || "");
  return timingSafeEqual(e, ADMIN_EMAIL.toLowerCase()) && timingSafeEqual(p, ADMIN_PASSWORD);
}

export async function createSessionToken() {
  const exp = Date.now() + SESSION_MAX_AGE_SEC * 1000;
  const payload = `admin.${exp}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function sessionTokenValid(token?: string | null) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, expRaw, sig] = parts;
  if (role !== "admin") return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmac(`${role}.${expRaw}`);
  return timingSafeEqual(sig, expected);
}

export function isPublicPath(pathname: string, method = "GET") {
  const path = pathname.replace(/\/+$/, "") || "/";
  const m = method.toUpperCase();

  if (path === "/login") return true;
  if (path === "/api/auth/login") return true;
  if (path === "/api/auth/logout") return true;
  if (path.startsWith("/operator/")) return true;

  if (m === "GET" && /^\/api\/ops\/operators\/[^/]+$/.test(path)) return true;
  if (m === "GET" && /^\/api\/ops\/leads\/[^/]+$/.test(path)) return true;
  if (m === "POST" && /^\/api\/ops\/leads\/[^/]+\/(action|research|audit)$/.test(path)) return true;
  if (m === "GET" && /^\/api\/ops\/audits\/[^/]+(\/(pdf|docx))?$/.test(path)) return true;

  return false;
}
