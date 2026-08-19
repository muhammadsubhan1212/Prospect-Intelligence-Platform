/** Shared identity normalizers for master-lead dedupe. */

export function normalizeEmail(raw?: string | null): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function normalizePhone(raw?: string | null): string {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.length < 7) return "";
  // Keep last 10 when a country code is present (US/UK-ish).
  if (digits.length > 11) return digits.slice(-10);
  return digits;
}

export function normalizeDomain(raw?: string | null): string {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  s = s.replace(/:\d+$/, "");
  return s;
}

export function normalizeCompany(raw?: string | null): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[.,'"()]/g, "")
    .replace(/\b(ltd|limited|llc|inc|plc|co|company|llp)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeName(raw?: string | null): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function locationFrom(parts: { city?: string; state?: string; country?: string; address?: string }) {
  return [parts.city, parts.state, parts.country].filter(Boolean).join(", ") || parts.address || "";
}
