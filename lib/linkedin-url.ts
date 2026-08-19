/** Turn whatever Apollo/CSV stored into a paste-ready LinkedIn URL. */
export function toLinkedinUrl(raw?: string | null): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^['"]+|['"]+$/g, "").trim();
  if (/^(none|n\/a|na|null|-)$/i.test(s)) return "";
  if (s.startsWith("//")) s = `https:${s}`;
  if (!/^https?:\/\//i.test(s)) {
    if (/^(www\.)?linkedin\.com\//i.test(s)) s = `https://${s.replace(/^www\./i, "www.")}`;
    else if (/^\/?(in|pub|company|school)\//i.test(s)) s = `https://www.linkedin.com/${s.replace(/^\//, "")}`;
    else if (/^[a-z0-9][a-z0-9\-_%]+$/i.test(s)) s = `https://www.linkedin.com/in/${s}`;
    else return s;
  }
  try {
    const u = new URL(s);
    if (!u.hostname.toLowerCase().includes("linkedin.com")) return s;
    u.protocol = "https:";
    if (u.hostname.replace(/^www\./i, "") === "linkedin.com") u.hostname = "www.linkedin.com";
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return s;
  }
}
