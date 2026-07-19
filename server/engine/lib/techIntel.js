/**
 * PHASE 5 — Tech, Industry, and Business-Model Intelligence.
 *
 * 5.2 tech-gap scoring (scoreTechGaps)
 * 5.3 deeper business-model detection (marketplace/agency/franchise/nonprofit)
 * 5.4 industry classification cross-validation
 * 5.5 pricing-page intelligence extraction
 * 5.6 social-proof quantification (rating + count)
 * 5.7 positioning/value-prop extraction + light competitive context
 * 5.8 on-page decision-maker/contact discovery
 *
 * (5.1's fingerprint-library expansion lives in research.js's TECH_SIGNATURES
 * array — see the "PHASE 5.1" comment there — since that's where detection
 * already happens.)
 *
 * All pure functions, all null-safe, none throw.
 */

const { safeTest, safeMatch, safeMatchAll, clamp, htmlToText } = require("./utils");

// ---------------------------------------------------------------------------
// 5.2 — tech-gap scoring
// ---------------------------------------------------------------------------

/**
 * @param {{stack:string[], chat:string[], booking:string[]}} tech
 * @param {object} signals - research.signals (ctaMatches etc.)
 */
function scoreTechGaps(tech, signals) {
    const insights = [];
    try {
        const T = tech || { stack: [], chat: [], booking: [] };
        const stack = Array.isArray(T.stack) ? T.stack : [];
        const s = signals || {};

        if (stack.some((t) => safeTest(/HubSpot|Salesforce|Pipedrive/i, t)) && (T.chat || []).length === 0)
            insights.push({ insight: "Has CRM but no chat automation", boost: "ai_chatbot", score: 2 });
        if (stack.some((t) => safeTest(/Google Analytics|Hotjar|Clarity/i, t)) && (s.ctaMatches || 0) < 2)
            insights.push({ insight: "Tracks visitors but doesn't convert them", boost: "landing_cro", score: 2 });
        if (stack.some((t) => safeTest(/Shopify|WooCommerce|BigCommerce/i, t)) && !stack.some((t) => safeTest(/Klaviyo|Mailchimp|ActiveCampaign/i, t)))
            insights.push({ insight: "E-commerce store without email automation", boost: "ecom_email_automation", score: 3 });
        if ((T.booking || []).length > 0) insights.push({ insight: "Already has booking — skip that offer", boost: "appointment_booking", score: -5 });
        if (stack.includes("WordPress") && stack.includes("jQuery") && !stack.some((t) => safeTest(/React|Next|Vue/i, t)))
            insights.push({ insight: "Legacy WordPress — redesign opportunity", boost: "website_redesign", score: 2 });
        if (stack.some((t) => safeTest(/Stripe|PayPal|Square/i, t)) && !stack.some((t) => safeTest(/Klaviyo|ActiveCampaign/i, t)))
            insights.push({ insight: "Processes payments but no lifecycle automation", boost: "ecom_email_automation", score: 2 });
    } catch {
        /* degrade to whatever insights were collected safely */
    }
    return insights;
}

/** "Already has X" tech should suppress that offer category and become evidence for a complementary one. */
function suppressOffersForExistingTech(tech) {
    const suppressed = {};
    try {
        const T = tech || { stack: [], chat: [], booking: [] };
        if ((T.chat || []).length) suppressed.ai_chatbot = "Site already has a live-chat widget — suppress chatbot offer, pivot to automation/qualification add-on.";
        if ((T.booking || []).length) suppressed.appointment_booking = "Site already has online booking — suppress booking offer, pivot to reminders/no-show automation.";
        if ((T.stack || []).some((t) => safeTest(/Klaviyo|Mailchimp|ActiveCampaign|HubSpot/i, t))) suppressed.ecom_email_automation = "Email/lifecycle automation already present — suppress, pivot to segmentation/optimization.";
    } catch {
        /* return whatever was found safely */
    }
    return suppressed;
}

// ---------------------------------------------------------------------------
// 5.3 — deeper business-model detection
// ---------------------------------------------------------------------------

/**
 * Extends beyond B2B/B2C/SaaS/Service/local/ecommerce/content (already in
 * research.js's detectBusinessModel) into marketplace, agency, franchise,
 * and nonprofit — via CTA type, pricing-page structure, and schema.org type.
 * Returns null (no override) when nothing matches, so callers should treat
 * this as an ADDITIONAL classification layered on top of the existing one,
 * never a replacement.
 */
function detectExtendedBusinessModel(combinedText, schemaTypes, pricingIntel) {
    try {
        const text = String(combinedText || "");
        const types = (schemaTypes || []).map((t) => String(t || "").toLowerCase());

        if (types.some((t) => t.includes("nonprofit") || t.includes("ngo")) || safeTest(/\bdonate\b|\bdonation\b|501\(c\)\(3\)|non-?profit/i, text)) {
            return { type: "nonprofit", evidence: 'Schema.org NGO type or "donate"/nonprofit language detected', ctaType: "Donate" };
        }
        if (types.some((t) => t.includes("franchise")) || safeTest(/\bfranchise (opportunit|inquir|information)\b|own a franchise/i, text)) {
            return { type: "franchise", evidence: 'Franchise-specific language ("own a franchise", "franchise opportunities") detected', ctaType: "Franchise inquiry" };
        }
        if (safeTest(/\b(become a seller|sell on|multi-?vendor|marketplace|buyers and sellers|list your (product|service))\b/i, text)) {
            return { type: "marketplace", evidence: 'Multi-vendor / "become a seller" marketplace language detected', ctaType: "List / Sell" };
        }
        if (safeTest(/\b(our clients|full-service agency|creative agency|digital agency|we partner with brands)\b/i, text)) {
            return { type: "agency", evidence: 'Agency-style language ("full-service agency", "our clients") detected', ctaType: "Request a Quote" };
        }
        if (pricingIntel && pricingIntel.sellsToEnterprise) {
            return { type: "saas_enterprise", evidence: "Pricing page sells to enterprise (custom pricing / contact sales)", ctaType: "Contact Sales" };
        }
        return null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 5.4 — industry classification cross-validation
// ---------------------------------------------------------------------------

const INDUSTRY_TAXONOMY = [
    ["E-commerce / Retail", /add to (cart|bag)|shop now|\/checkout|free shipping/i],
    ["SaaS / Software", /free trial|book a demo|per (month|user)|dashboard|\bapi\b/i],
    ["Professional Services", /request a quote|book a consultation|our clients|case studies/i],
    ["Healthcare / Medical", /patients?|hipaa|appointment|clinic|physician/i],
    ["Legal", /attorney|law firm|legal counsel|practice areas/i],
    ["Real Estate", /listings|mls|property|realtor/i],
    ["Hospitality / Restaurants", /menu|reservations?|book a table/i],
    ["Nonprofit", /donate|donation|501\(c\)\(3\)/i],
    ["Manufacturing / Industrial", /manufactur|industrial|wholesale|distributor/i],
    ["Local / Home Services", /service area|free estimate|licensed and insured/i],
];

/** Classifies industry independently from crawled evidence (schema.org type, CTA/pricing language, cart presence). */
function classifyIndustryFromEvidence(combinedText, schemaTypes) {
    try {
        const text = String(combinedText || "");
        const types = (schemaTypes || []).join(" ").toLowerCase();
        for (const [label, re] of INDUSTRY_TAXONOMY) {
            if (safeTest(re, text) || safeTest(re, types)) return { industry: label, method: "on-site evidence (CTA/pricing/schema)" };
        }
        return { industry: null, method: "no strong evidence" };
    } catch {
        return { industry: null, method: "classification failed safely" };
    }
}

function crossValidateIndustry(leadIndustry, evidenceIndustry) {
    try {
        if (!leadIndustry || !evidenceIndustry) return { mismatch: false, note: "Not enough data to cross-validate industry." };
        const a = String(leadIndustry).toLowerCase();
        const b = String(evidenceIndustry).toLowerCase();
        const overlap = a.split(/[\s/,&-]+/).some((word) => word.length > 3 && b.includes(word));
        if (!overlap) {
            return { mismatch: true, note: `CSV-stated industry ("${leadIndustry}") doesn't clearly match on-site evidence ("${evidenceIndustry}") — verify manually.` };
        }
        return { mismatch: false, note: "CSV-stated industry is broadly consistent with on-site evidence." };
    } catch {
        return { mismatch: false, note: "Industry cross-validation failed safely." };
    }
}

// ---------------------------------------------------------------------------
// 5.5 — pricing-page intelligence extraction
// ---------------------------------------------------------------------------

function extractPricingIntelligence(pricingHtml) {
    try {
        if (!pricingHtml) return null;
        const text = htmlToText(pricingHtml);
        const prices = safeMatchAll(/\$[\d,]{1,6}/g, text)
            .map((m) => parseInt(m[0].replace(/[$,]/g, ""), 10))
            .filter((n) => isFinite(n));
        const maxPrice = prices.length ? Math.max(...prices) : null;
        const minPrice = prices.length ? Math.min(...prices) : null;
        const isSubscription = safeTest(/per month|\/mo|monthly|annually|per user|per seat/i, text);
        const isEnterprise = safeTest(/enterprise|custom pricing|contact us|sales/i, text);
        const hasFreeTier = safeTest(/free plan|tier|forever free|freemium|\$0/i, text);
        const tierNames = [
            ...new Set(
                safeMatchAll(/(starter|basic|pro|professional|business|enterprise|team|agency|growth|scale)/gi, text).map((m) => m[1].toLowerCase())
            ),
        ];
        return {
            priceRange: { min: minPrice, max: maxPrice },
            isSubscription,
            isEnterprise,
            hasFreeTier,
            tierNames,
            sellsToEnterprise: isEnterprise || tierNames.includes("enterprise"),
        };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 5.6 — social-proof quantification
// ---------------------------------------------------------------------------

function computeSocialProofInsights(rating) {
    try {
        if (!rating || !rating.value) return null;
        const ratingVal = parseFloat(rating.value);
        const ratingCount = parseInt(String(rating.count || "0").replace(/[^0-9]/g, ""), 10) || 0;
        if (!isFinite(ratingVal)) return null;

        let angle = "neutral";
        let boost = null;
        let note = `Rating ${ratingVal}${ratingCount ? ` (${ratingCount} reviews)` : ""}`;
        if (ratingVal < 4.0) {
            angle = "reputation-risk";
            boost = { offerId: "review_automation", score: 3 };
            note = `Rating is only ${ratingVal}/5${ratingCount ? ` across ${ratingCount} reviews` : ""} — reputation-risk pain point with hard evidence.`;
        } else if (ratingVal >= 4.5 && ratingCount < 20) {
            angle = "easy-win-low-volume";
            note = `Rating is strong (${ratingVal}/5) but only ${ratingCount} review(s) — "great service, no review volume" easy win.`;
        } else if (ratingVal >= 4.5 && ratingCount >= 50) {
            angle = "credibility-icebreaker";
            note = `Rating ${ratingVal}/5 across ${ratingCount} reviews — strong credibility icebreaker for outreach.`;
        }
        return { ratingVal, ratingCount, angle, boost, note };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 5.7 — positioning/value-prop extraction + light competitive context
// ---------------------------------------------------------------------------

function extractCompetitors(anchors, combinedText) {
    const competitors = new Set();
    try {
        const list = Array.isArray(anchors) ? anchors : [];
        for (const a of list) {
            if (!a) continue;
            const hay = `${a.href || ""} ${a.text || ""}`;
            if (safeTest(/\bvs\b|alternative(s)? to|switch from/i, hay)) {
                const m = safeMatch(/(?:vs\.?|alternative(?:s)? to|switch from)\s+([A-Za-z0-9][A-Za-z0-9 .&-]{1,30})/i, hay);
                if (m && m[1]) competitors.add(m[1].trim());
            }
        }
        const textMatches = safeMatchAll(/\b(?:vs\.?|alternative(?:s)? to|switch from)\s+([A-Z][A-Za-z0-9 .&-]{1,30})/g, String(combinedText || ""));
        for (const m of textMatches) {
            if (m[1]) competitors.add(m[1].trim());
        }
    } catch {
        /* return whatever was found safely */
    }
    return [...competitors].slice(0, 5);
}

function extractPositioning(valueProp, description, metaDescription) {
    try {
        const positioning = valueProp || description || metaDescription || null;
        return positioning ? { statement: positioning, source: valueProp ? "H1/tagline" : description ? "meta/JSON-LD description" : "meta description" } : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 5.8 — on-page decision-maker/contact discovery
// ---------------------------------------------------------------------------

const TITLE_RE = /\b(CEO|CTO|COO|CFO|CMO|Founder|Co-?Founder|President|Owner|Director|VP|Vice President|Head of [A-Za-z ]{2,30}|Manager|Partner)\b/;
const NAME_NEAR_TITLE_RE = new RegExp(`([A-Z][a-z]+(?:\\s[A-Z][a-z]+){0,2})\\s*[,\\-–—|]?\\s*(${TITLE_RE.source})`, "g");

function extractPossibleContacts(pagesHtml) {
    const contacts = [];
    const seen = new Set();
    try {
        const htmlBlobs = (pagesHtml || []).filter(Boolean);
        const combined = htmlBlobs.map((h) => htmlToText(h)).join(" \n ");
        const matches = safeMatchAll(NAME_NEAR_TITLE_RE, combined);
        for (const m of matches) {
            const name = (m[1] || "").trim();
            const title = (m[2] || "").trim();
            if (!name || name.split(" ").length < 2) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            contacts.push({ name, title, source: "On-page About/Team/Contact content", verified: false, note: "Unverified, sourced from site — cross-reference before outreach." });
            if (contacts.length >= 8) break;
        }

        // Emails/LinkedIn links near names (best-effort, still unverified).
        for (const h of htmlBlobs) {
            const emailMatches = safeMatchAll(/mailto:([^"'?\s>]+)/gi, h || "");
            for (const em of emailMatches) {
                const addr = em[1];
                if (addr && contacts.length && !contacts[0].email) {
                    contacts[0].email = addr; // best-effort association with the first found contact
                    break;
                }
            }
        }
    } catch {
        /* return whatever contacts were found safely */
    }
    return contacts;
}

module.exports = {
    scoreTechGaps,
    suppressOffersForExistingTech,
    detectExtendedBusinessModel,
    classifyIndustryFromEvidence,
    crossValidateIndustry,
    extractPricingIntelligence,
    computeSocialProofInsights,
    extractCompetitors,
    extractPositioning,
    extractPossibleContacts,
    INDUSTRY_TAXONOMY,
};
