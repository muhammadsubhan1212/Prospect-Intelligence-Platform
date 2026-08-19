/**
 * Client-side deliverability helpers (mirror of engine deliverability rules).
 * Wording alone cannot guarantee inbox placement.
 */

const SPAMMY_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/act\s*now/gi, "when you have a moment"],
  [/limited\s*time/gi, ""],
  [/100\s*%/gi, ""],
  [/guaranteed?/gi, ""],
  [/risk[\s-]*free/gi, "low-effort"],
  [/no\s*obligation/gi, "optional"],
  [/click\s*here/gi, "have a look"],
  [/buy\s*now/gi, ""],
  [/make\s*money/gi, ""],
  [/double\s*your/gi, "improve"],
  [/\$\$\$+/g, ""],
  [/!!!+/g, "."],
  [/worth more leads/gi, "quick thought on the site"],
  [/booked conversations/gi, "replies"],
  [/turning your traffic into/gi, "a thought on"],
  [/no\s*strings\s*attached/gi, "optional"],
  [/urgent(ly)?/gi, ""],
  [/asap/gi, "soon"],
];

const SPAMMY_SUBJECT_HARD_FAIL = /free|guarantee|urgent|!!!|\$\$|click|winner|congrat|limited time|act now|100%/i;

function collapseSpace(s: string) {
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function scrubEmailText(raw: string): string {
  let s = String(raw || "");
  s = s.replace(/https?:\/\/\S+/gi, "").replace(/www\.\S+/gi, "");
  s = s.replace(/\b([A-Z]{4,})\b/g, (m) => m.charAt(0) + m.slice(1).toLowerCase());
  for (const [re, rep] of SPAMMY_PHRASE_REPLACEMENTS) {
    s = s.replace(re, rep);
  }
  s = s.replace(/\s+([,.!?])/g, "$1");
  return collapseSpace(s);
}

export function scrubEmailSubject(raw: string, company?: string): string {
  let s = scrubEmailText(raw);
  if (!s || SPAMMY_SUBJECT_HARD_FAIL.test(s) || s.length > 70) {
    s = `Quick note on ${company || "your site"}`;
  }
  return s.replace(/[!?]{2,}/g, "?").replace(/^\W+|\W+$/g, "").slice(0, 70);
}

export function assessEmailDeliverability(subject: string, body: string): {
  ok: boolean;
  issues: string[];
  tip: string;
} {
  const issues: string[] = [];
  if (SPAMMY_SUBJECT_HARD_FAIL.test(subject)) issues.push("Subject still looks salesy — keep it plain.");
  if (/https?:\/\//i.test(body) || /www\./i.test(body)) issues.push("Remove links from the first email.");
  if (/!{2,}/.test(subject + body)) issues.push("Avoid multiple exclamation marks.");
  if (body.length > 1200) issues.push("Body is long — shorter emails land better.");
  if (/\b(free|guarantee|urgent|click here|act now)\b/i.test(body)) {
    issues.push("Avoid hype words (free / guarantee / urgent / click here).");
  }
  if (/\[Your Name\]/i.test(body)) issues.push("Replace [Your Name] before sending.");
  return {
    ok: issues.length === 0,
    issues,
    tip: "Safer wording helps filters, but inbox placement also depends on your mailbox reputation and domain auth. No copy can guarantee 100% delivery.",
  };
}
