/**
 * Shared, dependency-free helpers used by the additive scoring/signal layers
 * (Phases 1-6). Nothing here replaces existing helpers in research.js /
 * strategy.js — those stay untouched. This module exists so the new layers
 * don't duplicate logic and so every helper is defensively null-safe.
 *
 * Every function in this file is safe to call with undefined/null/garbage
 * input: it will never throw, and will return a neutral default instead.
 */

const clamp = (n, lo = 0, hi = 100) => {
    const num = Number(n);
    if (!isFinite(num)) return lo;
    return Math.max(lo, Math.min(hi, Math.round(num)));
};

/** Never throws. Returns fallback if the regex/text is bad in any way. */
function safeTest(re, text) {
    try {
        if (!re || text === undefined || text === null) return false;
        return re.test(String(text));
    } catch {
        return false;
    }
}

function safeMatch(re, text) {
    try {
        if (!re || text === undefined || text === null) return null;
        return String(text).match(re);
    } catch {
        return null;
    }
}

function safeMatchAll(re, text) {
    try {
        if (!re || text === undefined || text === null) return [];
        return [...String(text).matchAll(re)];
    } catch {
        return [];
    }
}

/** Wrap any function so it degrades to a default value instead of throwing. */
function safeCall(fn, fallback, ...args) {
    try {
        const out = fn(...args);
        return out === undefined ? fallback : out;
    } catch {
        return fallback;
    }
}

async function safeCallAsync(fn, fallback, ...args) {
    try {
        const out = await fn(...args);
        return out === undefined ? fallback : out;
    } catch {
        return fallback;
    }
}

function parseTeamSize(v) {
    if (v === undefined || v === null || v === "") return null;
    const m = String(v).match(/\d+/);
    if (!m) return null;
    const n = parseInt(m[0], 10);
    return isFinite(n) ? n : null;
}

/** Parses Apollo-style revenue strings: "$610,000 (estimated)", "1.2M", "610000.0", etc. */
function parseRevenue(v) {
    if (v === undefined || v === null || v === "") return null;
    const raw = String(v).trim();
    const mult = /b(illion)?\b/i.test(raw) ? 1_000_000_000 : /m(illion)?\b/i.test(raw) ? 1_000_000 : /k\b/i.test(raw) ? 1_000 : 1;
    const numMatch = raw.match(/[\d.,]+/);
    if (!numMatch) return null;
    const n = Number(numMatch[0].replace(/,/g, ""));
    if (!isFinite(n)) return null;
    return Math.round(n * mult);
}

/** Parses Apollo-style funding amount strings the same way as revenue. */
function parseFundingAmount(v) {
    return parseRevenue(v);
}

/** True if `date` is within `months` of "now" (defensive: bad dates => false, never throws). */
function isWithinMonths(date, months) {
    try {
        if (!date) return false;
        const d = date instanceof Date ? date : new Date(String(date));
        if (isNaN(d.getTime())) return false;
        const now = new Date();
        const diffMonths = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
        return diffMonths >= 0 && diffMonths <= months;
    } catch {
        return false;
    }
}

function monthsSince(date) {
    try {
        if (!date) return null;
        const d = date instanceof Date ? date : new Date(String(date));
        if (isNaN(d.getTime())) return null;
        const now = new Date();
        const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
        return diff >= 0 ? diff : null;
    } catch {
        return null;
    }
}

function lc(s) {
    return String(s === undefined || s === null ? "" : s).toLowerCase();
}

function cap(s) {
    const str = String(s || "");
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function rootDomain(website) {
    try {
        if (!website) return "";
        let u = String(website).trim();
        if (!/^https?:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
        const host = new URL(u).host.toLowerCase().replace(/^www\./, "");
        return host;
    } catch {
        return "";
    }
}

/**
 * Lightweight rule-firing logger for audit trails. Every scoring/offer
 * decision that fires a rule should push an entry here so reports stay
 * auditable (STRICT RULE #6). Call auditLog() to create a fresh logger
 * per lead (never share across leads).
 */
function createRuleLog() {
    const entries = [];
    return {
        fire(rule, points, reason) {
            try {
                entries.push({ rule: String(rule || "unknown"), points: Number(points) || 0, reason: String(reason || "") });
            } catch {
                /* never throw from logging */
            }
        },
        all() {
            return entries.slice();
        },
    };
}

// Very small, dependency-free timezone-by-region lookup used for the
// "recommended call window" heuristic (Phase 2.6). Not exhaustive — degrades
// to "unknown" instead of guessing wrong.
const REGION_TIMEZONES = [
    [/\b(california|los angeles|san francisco|seattle|washington state|oregon|nevada|portland)\b/i, "America/Los_Angeles", "Pacific Time (US)"],
    [/\b(colorado|arizona|utah|denver|phoenix)\b/i, "America/Denver", "Mountain Time (US)"],
    [/\b(texas|illinois|chicago|houston|dallas|austin|minnesota|missouri|wisconsin)\b/i, "America/Chicago", "Central Time (US)"],
    [/\b(new york|florida|georgia|carolina|virginia|massachusetts|boston|atlanta|miami|new jersey|pennsylvania|ohio|michigan)\b/i, "America/New_York", "Eastern Time (US)"],
    [/\b(london|england|united kingdom|\buk\b|scotland|wales)\b/i, "Europe/London", "UK Time"],
    [/\b(ireland|dublin)\b/i, "Europe/Dublin", "Irish Time"],
    [/\b(paris|france)\b/i, "Europe/Paris", "Central European Time"],
    [/\b(berlin|germany|munich|frankfurt)\b/i, "Europe/Berlin", "Central European Time"],
    [/\b(madrid|spain|barcelona)\b/i, "Europe/Madrid", "Central European Time"],
    [/\b(toronto|ontario|canada|vancouver|british columbia|montreal|quebec)\b/i, "America/Toronto", "Eastern Time (Canada)"],
    [/\b(sydney|australia|melbourne|brisbane)\b/i, "Australia/Sydney", "Australian Eastern Time"],
    [/\b(auckland|new zealand)\b/i, "Pacific/Auckland", "New Zealand Time"],
    [/\b(dubai|uae|united arab emirates)\b/i, "Asia/Dubai", "Gulf Standard Time"],
    [/\b(singapore)\b/i, "Asia/Singapore", "Singapore Time"],
    [/\b(mumbai|delhi|bangalore|india)\b/i, "Asia/Kolkata", "India Standard Time"],
    [/\b(johannesburg|south africa|cape town)\b/i, "Africa/Johannesburg", "South Africa Time"],
];

function guessTimezone(text) {
    try {
        if (!text) return null;
        const hay = String(text);
        for (const [re, tz, label] of REGION_TIMEZONES) {
            if (re.test(hay)) return { timezone: tz, label };
        }
        return null;
    } catch {
        return null;
    }
}

/** Minimal, dependency-free HTML->text stripper for the additive layers (Phase 5). */
function stripHtmlTags(s) {
    try {
        return String(s || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
            .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
            .replace(/\s+/g, " ")
            .trim();
    } catch {
        return "";
    }
}

function htmlToText(html) {
    try {
        return stripHtmlTags(String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
    } catch {
        return "";
    }
}

module.exports = {
    clamp,
    safeTest,
    safeMatch,
    safeMatchAll,
    safeCall,
    safeCallAsync,
    parseTeamSize,
    parseRevenue,
    parseFundingAmount,
    isWithinMonths,
    monthsSince,
    lc,
    cap,
    rootDomain,
    createRuleLog,
    guessTimezone,
    stripHtmlTags,
    htmlToText,
};
