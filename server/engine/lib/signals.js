/**
 * PHASE 2 — Signal Detection Layer.
 *
 * Multi-signal buying-intent (2.1), buying-timing / growth (2.2), urgency
 * (2.3), content-freshness (2.4), negative-signal disqualification (2.5),
 * and trust/geo/timezone (2.6) detectors.
 *
 * Every exported function is defensive: bad/missing input degrades to a
 * neutral, empty result rather than throwing (STRICT RULE #2).
 */

const { safeTest, safeMatch, clamp, isWithinMonths, guessTimezone } = require("./utils");

// ---------------------------------------------------------------------------
// 2.1 — Multi-signal buying-intent detection
// ---------------------------------------------------------------------------

/**
 * Detects buying-intent signals independent of website-quality/pain score:
 * careers/jobs + role types, hiring language, recent press/news, funding/
 * expansion language, and recently-added product/service pages.
 */
function detectIntentSignals(lead, research, combinedText) {
    const signals = [];
    let intentScore = 0;
    try {
        const R = research || {};
        const text = String(combinedText || "");
        const pages = R.pages || {};

        if (pages.careers) {
            const roles = safeMatch(/\b(sales|marketing|engineer|developer|support|customer service|operations|account manager|sdr|bdr)\b/gi, text) || [];
            signals.push({ signal: "Careers/jobs page found", detail: roles.length ? `Hiring roles mentioned: ${[...new Set(roles.map((r) => r.toLowerCase()))].slice(0, 4).join(", ")}` : "Careers page exists on the site", weight: 10 });
            intentScore += 10;
        }
        if (safeTest(/\bwe'?re hiring\b|\bjoin our team\b|\bwe are growing\b|\bopen positions?\b/i, text)) {
            signals.push({ signal: "Active hiring language", detail: "\"We're hiring\" / \"join our team\" style copy found on site", weight: 8 });
            intentScore += 8;
        }
        if (pages.blog || pages.news) {
            const postCount = (R.signals && R.signals.blogPostCount) || 0;
            if (postCount > 0) {
                signals.push({ signal: "Active press/news page", detail: `${postCount} post(s) detected on blog/news page`, weight: 6 });
                intentScore += 6;
            }
        }
        if (safeTest(/\bseries [a-e]\b|\bbacked by\b|\bnew location\b|\bnow open in\b|\braised \$?[\d.,]+\s*(million|m|k)?\b/i, text)) {
            signals.push({ signal: "Funding/expansion language", detail: "Site copy references funding round, backing, or new location/expansion", weight: 12 });
            intentScore += 12;
        }
        if (pages.products || pages.services) {
            if (safeTest(/\bnew(ly)?\s+(launched|added|introduc\w+)\b|\bcoming soon\b|\bjust launched\b/i, text)) {
                signals.push({ signal: "Recently-added product/service page", detail: "Product/services content references a new/recent launch", weight: 6 });
                intentScore += 6;
            }
        }
        if (lead && lead.latestFunding && isWithinMonths(lead.lastRaisedAt, 12)) {
            signals.push({ signal: "Recent Apollo-reported funding", detail: `${lead.latestFunding}${lead.latestFundingAmount ? " " + lead.latestFundingAmount : ""}`, weight: 10 });
            intentScore += 10;
        }
    } catch {
        // degrade to whatever was accumulated safely
    }
    return { signals, intentScore: clamp(intentScore, 0, 95) };
}

// ---------------------------------------------------------------------------
// 2.2 — Buying-timing signals / growth indicators
// ---------------------------------------------------------------------------

function formatDateSafe(v) {
    try {
        if (!v) return "";
        const s = String(v).trim();
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) {
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `${months[parseInt(iso[2], 10) - 1]} ${iso[1]}`;
        }
        return s;
    } catch {
        return "";
    }
}

/**
 * @param {object} lead
 * @param {object} research
 * @param {string} combinedText - all crawled page text concatenated
 */
function detectBuyingTimingSignals(lead, research, combinedText) {
    const signals = [];
    let timingScore = 0;
    try {
        const L = lead || {};
        const R = research || {};
        const text = String(combinedText || "");
        const stack = (R.tech && R.tech.stack) || [];
        const s = R.signals || {};

        if (L.lastRaisedAt && isWithinMonths(L.lastRaisedAt, 12)) {
            signals.push({
                signal: "Recently funded",
                detail: `${L.latestFunding || "Funding round"} ${L.latestFundingAmount || ""} in ${formatDateSafe(L.lastRaisedAt)}`.replace(/\s+/g, " ").trim(),
                weight: 15,
            });
            timingScore += 15;
        }
        if ((R.pages && R.pages.careers) || safeTest(/\bhiring\b|\bwe'?re growing\b|\bjoin our team\b|\bopen positions?\b/i, text)) {
            signals.push({ signal: "Actively hiring", detail: "Careers/hiring content detected on site", weight: 10 });
            timingScore += 10;
        }
        if ((s.blogPostCount || 0) > 5) {
            signals.push({ signal: "Active content marketing", detail: `${s.blogPostCount} blog posts`, weight: 5 });
            timingScore += 5;
        }
        const isNewSite = stack.some((t) => safeTest(/Next|Webflow|Framer/i, t)) && (s.wordCount || 0) < 500;
        if (isNewSite) {
            signals.push({ signal: "Website recently rebuilt", detail: "Modern stack with thin content suggests new launch", weight: 8 });
            timingScore += 8;
        }
        if (s.pricing) {
            signals.push({ signal: "Public pricing (growth-stage)", detail: "Active self-serve sales motion", weight: 5 });
            timingScore += 5;
        }
    } catch {
        // degrade to whatever was accumulated safely
    }
    return { signals, timingScore: clamp(timingScore, 0, 95) };
}

// ---------------------------------------------------------------------------
// 2.3 — Urgency indicators
// ---------------------------------------------------------------------------

function detectUrgencySignals(combinedText, anchors) {
    const signals = [];
    try {
        const text = String(combinedText || "");
        if (safeTest(/hiring.{0,40}(SDR|BDR|sales rep|marketing coordinator|receptionist|customer service)/i, text)) {
            signals.push({ type: "hiringForAutomatableRole", detail: "Hiring for a role automation could augment", urgency: "high" });
        }
        if (safeTest(/(RFP|request for proposal|seeking a (partner|vendor|agency)|looking for.{0,30}(agency|partner|consultant))/i, text)) {
            signals.push({ type: "seekingPartner", detail: "Actively looking for a service provider", urgency: "very-high" });
        }
        if (safeTest(/coming soon|launching soon|new service|now offering|just launched|grand opening/i, text)) {
            signals.push({ type: "newLaunch", detail: "Recently launched or launching something new", urgency: "medium" });
        }
        if (safeTest(/scaling|growing rapidly|doubled|tripled|expansion|new office|new location/i, text)) {
            signals.push({ type: "growthPhase", detail: "Language indicates active growth", urgency: "medium" });
        }
        // anchors param kept for parity with spec / future link-based urgency checks
        if (Array.isArray(anchors)) {
            const hasRfpLink = anchors.some((a) => a && safeTest(/rfp|proposal|vendor|partner-with-us/i, a.text || a.href || ""));
            if (hasRfpLink && !signals.some((s) => s.type === "seekingPartner")) {
                signals.push({ type: "seekingPartner", detail: "Site links reference RFP/vendor/partner pages", urgency: "very-high" });
            }
        }
    } catch {
        /* return whatever was gathered safely */
    }
    return signals;
}

// ---------------------------------------------------------------------------
// 2.4 — Content freshness scoring
// ---------------------------------------------------------------------------

/**
 * Extracts copyright year and last blog/news post date to compute a 0-100
 * freshness score, plus a gating hint for offer type (stale -> redesign
 * first; fresh -> add-on/optimization offers).
 */
function computeFreshnessScore(research, combinedText) {
    try {
        const text = String(combinedText || "");
        const now = new Date().getFullYear();
        let copyrightYear = null;
        const cMatch = safeMatch(/(?:©|&copy;|copyright)\s*(\d{4})/i, text) || safeMatch(/\b(20[0-2][0-9])\s*[-–]\s*(20[0-2][0-9])\b.{0,10}(all rights reserved)?/i, text);
        if (cMatch) {
            copyrightYear = parseInt(cMatch[2] && /^\d{4}$/.test(cMatch[2]) ? cMatch[2] : cMatch[1], 10);
        }

        let score = 50; // neutral baseline when nothing is known
        const reasons = [];
        if (copyrightYear && copyrightYear >= 1990 && copyrightYear <= now + 1) {
            const age = now - copyrightYear;
            if (age <= 0) {
                score = 90;
                reasons.push(`Copyright year is current (${copyrightYear})`);
            } else if (age === 1) {
                score = 75;
                reasons.push(`Copyright year is last year (${copyrightYear})`);
            } else if (age <= 3) {
                score = 50;
                reasons.push(`Copyright year is ${age} years old (${copyrightYear})`);
            } else {
                score = 20;
                reasons.push(`Copyright year is stale — ${age} years old (${copyrightYear})`);
            }
        }

        const R = research || {};
        const blogPostCount = (R.signals && R.signals.blogPostCount) || 0;
        if (blogPostCount > 3) {
            score = clamp(score + 15, 0, 100);
            reasons.push(`${blogPostCount} blog/news posts detected — active publishing`);
        } else if (blogPostCount === 0 && (R.pages && (R.pages.blog || R.pages.news))) {
            score = clamp(score - 10, 0, 100);
            reasons.push("Blog/news page exists but has no detectable recent posts");
        }

        const stale = score < 40;
        const fresh = score >= 70;
        const offerGate = stale ? "redesign-class" : fresh ? "addon-optimization" : "neutral";

        return { freshnessScore: clamp(score, 0, 100), stale, fresh, offerGate, copyrightYear, reasons };
    } catch {
        return { freshnessScore: 50, stale: false, fresh: false, offerGate: "neutral", copyrightYear: null, reasons: ["freshness check failed safely"] };
    }
}

// ---------------------------------------------------------------------------
// 2.5 — Negative-signal / disqualification rules
// ---------------------------------------------------------------------------

const PARKED_PATTERNS = [
    /this domain (is|may be) for sale/i,
    /buy this domain/i,
    /domain (parking|parked)/i,
    /future home of something quite cool/i,
    /this site is (currently )?under construction/i,
    /coming soon.{0,20}(website|site)?\s*$/i,
];

/**
 * Detects parked/placeholder domains, under-construction pages, "not
 * accepting clients" language, and enterprise-vs-small-ICP mismatch. Never
 * silently drops leads — callers should route these to a visible
 * DISQUALIFIED bucket, not remove them from totals.
 */
function detectDisqualificationSignals(lead, research, combinedText, icpProfile) {
    const reasons = [];
    try {
        const text = String(combinedText || "");
        const R = research || {};
        const L = lead || {};

        if (R.website && !R.reachable) {
            // Not itself disqualifying (site may be down transiently) — informational only.
        }

        for (const re of PARKED_PATTERNS) {
            if (safeTest(re, text)) {
                reasons.push({ code: "parked_domain", detail: "Domain looks parked/placeholder (for-sale or under-construction language detected)" });
                break;
            }
        }
        if ((R.signals && R.signals.wordCount) === 0 && R.reachable) {
            reasons.push({ code: "empty_site", detail: "Site loaded but rendered zero readable text" });
        }
        if (safeTest(/temporarily closed|permanently closed|not accepting (new )?clients|not currently taking (new )?clients|no longer in business/i, text)) {
            reasons.push({ code: "closed_or_not_accepting", detail: "Site states the business is closed or not accepting new clients" });
        }

        // Enterprise-scale-vs-small-ICP mismatch (only flags when an ICP profile is supplied).
        if (icpProfile && icpProfile.maxEmployees) {
            const { parseTeamSize } = require("./utils");
            const team = parseTeamSize(L.employees);
            if (team && team > icpProfile.maxEmployees * 5) {
                reasons.push({ code: "icp_size_mismatch", detail: `Company (${team} employees) is far larger than the configured ICP ceiling (${icpProfile.maxEmployees})` });
            }
        }
    } catch {
        /* degrade to whatever reasons were collected safely */
    }
    return { disqualified: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// 2.6 — Trust-signal + geo/timezone detection
// ---------------------------------------------------------------------------

const CALL_WINDOWS_LOCAL = "9:00–11:00 AM or 2:00–4:00 PM, local time";

/**
 * Detects presence/absence of testimonial/client-logo sections (existence
 * only), derives a city/region personalization token, and recommends a
 * "best call window" in the prospect's local time when a timezone can be
 * inferred.
 */
function detectTrustAndGeoSignals(research, lead) {
    try {
        const R = research || {};
        const L = lead || {};
        const s = R.signals || {};
        const testimonialsPresent = !!s.testimonials;
        const clientLogosPresent = !!s.clientLogos;

        const painSignal = !testimonialsPresent && !clientLogosPresent;
        const rapportSignal = testimonialsPresent || clientLogosPresent;

        const geoText = [L.city, L.state, L.country, R.facts && R.facts.address].filter(Boolean).join(", ");
        const tz = guessTimezone(geoText) || guessTimezone(R.facts && R.facts.address);

        return {
            testimonialsPresent,
            clientLogosPresent,
            painSignal,
            rapportSignal,
            city: L.city || "",
            region: L.state || L.country || "",
            timezone: tz ? tz.timezone : null,
            timezoneLabel: tz ? tz.label : "unknown",
            bestCallWindow: tz ? `${CALL_WINDOWS_LOCAL} (${tz.label})` : "Unknown — no location data to derive a timezone",
        };
    } catch {
        return {
            testimonialsPresent: false,
            clientLogosPresent: false,
            painSignal: false,
            rapportSignal: false,
            city: "",
            region: "",
            timezone: null,
            timezoneLabel: "unknown",
            bestCallWindow: "Unknown — trust/geo check failed safely",
        };
    }
}

module.exports = {
    detectIntentSignals,
    detectBuyingTimingSignals,
    detectUrgencySignals,
    computeFreshnessScore,
    detectDisqualificationSignals,
    detectTrustAndGeoSignals,
};
