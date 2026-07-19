/**
 * PHASE 3 — Fit, Pain, and Priority Scoring.
 *
 * 3.1 configurable ICP-fit score
 * 3.2 evidence-taxonomy pain-point engine + industry-specific pain library
 * 3.3 revenue-per-employee efficiency scoring
 * 3.4 deal-size-aware prioritization weighting
 * 3.5 priority = pain × intent (multiplicative)
 * 3.6 NURTURE verdict gate
 * 3.7 lead-to-lead deduplication by root domain (see also lib/dedupe.js)
 *
 * All additive; nothing here mutates or removes any existing strategy.js
 * field. Every function null-checks its inputs and never throws.
 */

const { clamp, safeTest, parseTeamSize, parseRevenue, lc } = require("./utils");

// ---------------------------------------------------------------------------
// 3.1 — Configurable ICP-fit score (0-100)
// ---------------------------------------------------------------------------

/**
 * Default ICP profile used when the caller doesn't supply one. Kept broad on
 * purpose so it never disqualifies leads by default — operators can pass a
 * tighter opts.icpProfile through processLead()/researchWebsite() to focus
 * scoring on their actual engagement.
 */
const DEFAULT_ICP_PROFILE = {
    targetIndustries: [], // e.g. ["dental", "saas"] — empty = no restriction
    minEmployees: 0,
    maxEmployees: 5000,
    geographies: [], // e.g. ["United States", "Canada"] — empty = no restriction
    techMustHave: [], // e.g. ["Shopify"]
    techMustNotHave: [], // e.g. ["Salesforce"]
};

function computeIcpFitScore(lead, research, icpProfile) {
    const profile = { ...DEFAULT_ICP_PROFILE, ...(icpProfile || {}) };
    const notes = [];
    let score = 0;
    try {
        const L = lead || {};
        const R = research || {};
        const stack = (R.tech && R.tech.stack) || [];

        // Industry match — 30 pts. An unconfigured (no-restriction) profile
        // gives HALF credit, not full credit — otherwise every lead would
        // default to a near-max ICP-fit score and the NURTURE gate (3.6)
        // would fire for almost everyone whenever intent is low. Only a
        // real, engagement-specific ICP profile should be able to push fit
        // scores toward the extremes.
        if (!profile.targetIndustries.length) {
            score += 15;
        } else {
            const industryHay = lc(L.industry) + " " + lc((L.keywords || []).join(" "));
            const matched = profile.targetIndustries.some((ind) => industryHay.includes(lc(ind)));
            if (matched) {
                score += 30;
                notes.push(`Industry matches target list (${L.industry || "keyword match"})`);
            } else {
                notes.push(`Industry "${L.industry || "unknown"}" not in target list`);
            }
        }

        // Size band — 30 pts. A band still at the wide-open default
        // (0-5000) is treated as "not configured" -> half credit, so it
        // can't trivially max out the score for every lead.
        const team = parseTeamSize(L.employees);
        const sizeBandConfigured = profile.minEmployees !== DEFAULT_ICP_PROFILE.minEmployees || profile.maxEmployees !== DEFAULT_ICP_PROFILE.maxEmployees;
        if (!sizeBandConfigured) {
            score += 15;
            notes.push("Size band not configured for this engagement — partial credit given");
        } else if (team === null) {
            score += 15; // unknown size — half credit, don't punish missing data
            notes.push("Employee count unknown — partial size-fit credit given");
        } else if (team >= profile.minEmployees && team <= profile.maxEmployees) {
            score += 30;
            notes.push(`Team size ${team} is within ICP band (${profile.minEmployees}-${profile.maxEmployees})`);
        } else {
            notes.push(`Team size ${team} is outside ICP band (${profile.minEmployees}-${profile.maxEmployees})`);
        }

        // Geography — 20 pts (half credit when unconfigured — see note above)
        if (!profile.geographies.length) {
            score += 10;
        } else {
            const geoHay = lc([L.city, L.state, L.country].filter(Boolean).join(" "));
            const matched = profile.geographies.some((g) => geoHay.includes(lc(g)));
            if (matched) {
                score += 20;
                notes.push("Geography matches ICP target list");
            } else {
                notes.push("Geography does not match ICP target list");
            }
        }

        // Tech must-have / must-not-have — 20 pts (half credit when unconfigured)
        let techPts = profile.techMustHave.length || profile.techMustNotHave.length ? 20 : 10;
        if (profile.techMustHave.length) {
            const hasAll = profile.techMustHave.every((t) => stack.some((s) => lc(s).includes(lc(t))));
            if (!hasAll) {
                techPts -= 10;
                notes.push("Missing one or more ICP-required technologies");
            }
        }
        if (profile.techMustNotHave.length) {
            const hasBanned = profile.techMustNotHave.some((t) => stack.some((s) => lc(s).includes(lc(t))));
            if (hasBanned) {
                techPts -= 10;
                notes.push("Detected a technology on the ICP exclusion list");
            }
        }
        score += clamp(techPts, 0, 20);
    } catch {
        return { icpFitScore: 50, notes: ["ICP-fit check failed safely — neutral score returned"], profile };
    }
    return { icpFitScore: clamp(score, 0, 100), notes, profile };
}

// ---------------------------------------------------------------------------
// 3.2 — Evidence-taxonomy pain-point engine + industry-specific pain library
// ---------------------------------------------------------------------------

/** Fixed, named, weighted generic pain checklist (applies to every lead). */
function computeGenericPainSignals(research) {
    const R = research || {};
    const s = R.signals || {};
    const tech = R.tech || { chat: [], booking: [], stack: [] };
    const out = [];
    const add = (code, label, weight, evidence) => out.push({ code, label, weight, evidence });

    if (R.reachable && !s.https) add("no_ssl", "No SSL / not served over HTTPS", 8, "Homepage is not served over https://");
    if (R.reachable && !s.viewportMeta) add("no_responsive", "No responsive viewport meta tag", 6, "No <meta name=viewport> tag found");
    if (R.pageSpeed && R.pageSpeed.available && typeof R.pageSpeed.score === "number" && R.pageSpeed.score < 50)
        add("slow_load", "Slow page load (PageSpeed)", 8, `PageSpeed performance score ${R.pageSpeed.score}/100`);
    if (R.reachable && (s.ctaMatches || 0) < 1) add("no_cta", "No clear CTA above the fold", 6, "No action-oriented CTA phrase detected");
    if (R.reachable && !s.hasForm && !s.newsletter) add("no_email_capture", "No email capture mechanism", 5, "No form/newsletter signup detected");
    if (R.reachable && tech.chat.length === 0) add("no_live_chat", "No live chat", 6, "No chat widget signature detected");
    if (R.reachable && !s.pagesFetched?.some?.((p) => /pricing|about|contact/i.test(p)) && false) {
        /* placeholder kept intentionally inert — analytics check below covers the real signal */
    }
    if (R.reachable && !tech.stack.some((t) => safeTest(/Google Analytics|Meta Pixel|Google Tag Manager|Segment|Plausible/i, t)))
        add("no_analytics", "No analytics/pixel detected", 4, "No GA/GTM/Meta Pixel/Segment signature found");
    if (R.freshness && R.freshness.stale) add("stale_copyright", "Stale copyright/blog date", 5, `Freshness score ${R.freshness.freshnessScore}/100`);
    if (R.reachable && !s.testimonials && !s.clientLogos) add("no_testimonials", "No testimonials/client logos", 5, "No testimonial or client-logo section detected");
    if (R.reachable && (!s.hasContactPage)) add("missing_meta_seo", "No dedicated contact page found", 3, "No contact page detected during crawl");

    const painScore = clamp(out.reduce((a, p) => a + p.weight, 0), 0, 100);
    return { signals: out, painScore };
}

/**
 * PAIN_LIBRARY[industry] — extends the generic checklist above with
 * industry-specific weighted pain points, each mapped to an offer id so
 * message copy (Phase 6) can reference the exact right language.
 */
const PAIN_LIBRARY = {
    dental: [
        { code: "no_online_booking_dental", label: "No online appointment booking", weight: 8, offerId: "appointment_booking", test: (R) => !(R.tech && R.tech.booking && R.tech.booking.length) },
        { code: "no_insurance_info", label: "No insurance/payment info listed", weight: 4, offerId: "landing_cro", test: (R) => !safeTest(/insurance|ppo|payment plans?|financing/i, R._combinedText) },
    ],
    saas: [
        { code: "no_demo_booking", label: "No frictionless demo booking", weight: 8, offerId: "saas_demo_booking", test: (R) => !(R.tech && R.tech.booking && R.tech.booking.length) },
        { code: "no_free_trial", label: "No visible free trial / self-serve signup", weight: 5, offerId: "landing_cro", test: (R) => !safeTest(/free trial|start (for )?free|sign up free/i, R._combinedText) },
    ],
    ecommerce: [
        { code: "no_cart_recovery", label: "No cart-recovery / lifecycle email flow", weight: 9, offerId: "ecom_email_automation", test: (R) => !(R.tech && R.tech.stack.some((t) => safeTest(/Klaviyo|Mailchimp|ActiveCampaign|CartStack|Rejoiner/i, t))) },
        { code: "no_reviews_widget", label: "No product review widget", weight: 4, offerId: "review_automation", test: (R) => !(R.signals && R.signals.reviews) },
    ],
    local_service: [
        { code: "no_review_engine", label: "No systematic review-generation", weight: 7, offerId: "review_automation", test: (R) => !(R.signals && R.signals.reviews) },
        { code: "no_service_area_page", label: "No clear service-area page", weight: 3, offerId: "landing_cro", test: (R) => !(R.facts && R.facts.audience) },
    ],
    b2b_industrial: [
        { code: "no_quote_request", label: "No RFQ/quote-request path", weight: 7, offerId: "landing_cro", test: (R) => !safeTest(/request a quote|get a quote|rfq/i, R._combinedText) },
        { code: "no_case_studies", label: "No case studies / proof of past work", weight: 5, offerId: "landing_cro", test: (R) => !(R.pages && R.pages.caseStudies) },
    ],
    legal: [
        { code: "no_consultation_booking", label: "No free-consultation booking flow", weight: 8, offerId: "appointment_booking", test: (R) => !(R.tech && R.tech.booking && R.tech.booking.length) },
        { code: "no_practice_area_pages", label: "No dedicated practice-area pages", weight: 4, offerId: "landing_cro", test: (R) => !(R.facts && R.facts.services && R.facts.services.length > 1) },
    ],
    real_estate: [
        { code: "no_listing_search", label: "No property search/listings tool", weight: 6, offerId: "landing_cro", test: (R) => !safeTest(/search (listings|properties)|mls|browse (homes|listings)/i, R._combinedText) },
        { code: "no_lead_capture_realestate", label: "No buyer/seller lead-capture form", weight: 5, offerId: "followup_automation", test: (R) => !(R.signals && R.signals.hasForm) },
    ],
    restaurants: [
        { code: "no_online_reservation", label: "No online reservation/ordering", weight: 8, offerId: "appointment_booking", test: (R) => !(R.tech && R.tech.booking && R.tech.booking.length) },
        { code: "no_menu_page", label: "No accessible online menu", weight: 4, offerId: "landing_cro", test: (R) => !safeTest(/\bmenu\b/i, R._combinedText) },
    ],
};

const INDUSTRY_KEY_MAP = [
    [/dental|dentist|orthodont/i, "dental"],
    [/saas|software as a service|b2b software/i, "saas"],
    [/e-?commerce|retail online|online store/i, "ecommerce"],
    [/law firm|attorney|legal/i, "legal"],
    [/real estate|realtor|realty/i, "real_estate"],
    [/restaurant|cafe|catering|hospitality/i, "restaurants"],
    [/plumb|hvac|roofing|electrician|contractor|landscap|cleaning service|home service/i, "local_service"],
    [/industrial|manufactur|wholesale|logistics|b2b/i, "b2b_industrial"],
];

function resolveIndustryKey(lead, research) {
    try {
        // CSV-stated industry is the most reliable signal — check it first so
        // e.g. "Real Estate" never gets shadowed by a business-model guess
        // like "ecommerce" (checkout/cart language can appear on many sites).
        const industryHay = (lead && lead.industry) || "";
        for (const [re, key] of INDUSTRY_KEY_MAP) {
            if (safeTest(re, industryHay)) return key;
        }
        const modelHay = (research && research.facts && research.facts.businessModel && research.facts.businessModel.type) || "";
        for (const [re, key] of INDUSTRY_KEY_MAP) {
            if (safeTest(re, modelHay)) return key;
        }
        return null;
    } catch {
        return null;
    }
}

/** Runs the generic pain checklist plus any matching PAIN_LIBRARY[industry] entries. */
function computePainSignals(lead, research, combinedText) {
    const generic = computeGenericPainSignals({ ...(research || {}), _combinedText: combinedText });
    const industryKey = resolveIndustryKey(lead, research);
    const industrySignals = [];
    try {
        const libEntries = (industryKey && PAIN_LIBRARY[industryKey]) || [];
        const Rctx = { ...(research || {}), _combinedText: combinedText };
        for (const entry of libEntries) {
            try {
                if (entry.test(Rctx)) {
                    industrySignals.push({ code: entry.code, label: entry.label, weight: entry.weight, offerId: entry.offerId, evidence: `Industry-specific check (${industryKey})` });
                }
            } catch {
                /* skip a single bad rule, don't fail the whole library */
            }
        }
    } catch {
        /* degrade to generic-only */
    }
    const allSignals = [...generic.signals, ...industrySignals];
    const painScore = clamp(allSignals.reduce((a, p) => a + p.weight, 0), 0, 100);
    return { signals: allSignals, painScore, industryKey };
}

// ---------------------------------------------------------------------------
// 3.3 — Revenue-per-employee efficiency scoring
// ---------------------------------------------------------------------------

function computeRevenuePerEmployeeEfficiency(lead) {
    try {
        const L = lead || {};
        const team = parseTeamSize(L.employees);
        const rev = parseRevenue(L.annualRevenue);
        if (!team || !rev || team <= 0) {
            return { revPerEmployee: null, tier: "unknown", note: "Insufficient revenue/employee data to compute efficiency" };
        }
        const revPerEmployee = Math.round(rev / team);
        let tier = "balanced";
        let note = `~$${revPerEmployee.toLocaleString("en-US")} revenue per employee — balanced efficiency`;
        if (revPerEmployee > 250_000) {
            tier = "lean";
            note = `~$${revPerEmployee.toLocaleString("en-US")} revenue per employee — lean/efficient team, may not need ops help`;
        } else if (revPerEmployee < 60_000) {
            tier = "bloated";
            note = `~$${revPerEmployee.toLocaleString("en-US")} revenue per employee — inefficient, an opportunity signal for automation/CRM offers`;
        }
        return { revPerEmployee, tier, note };
    } catch {
        return { revPerEmployee: null, tier: "unknown", note: "Efficiency check failed safely" };
    }
}

// ---------------------------------------------------------------------------
// 3.4 — Deal-size-aware prioritization (weighting multiplier)
// ---------------------------------------------------------------------------

function computeDealSizeWeight(lead, research) {
    try {
        const L = lead || {};
        const team = parseTeamSize(L.employees);
        const rev = parseRevenue(L.annualRevenue);
        const totalFunding = parseRevenue(L.totalFunding);
        const teamHintCount = research && research.signals && research.signals.teamMemberCount;
        const effectiveTeam = team || teamHintCount || null;

        let bucket = "unknown";
        let multiplier = 1.0;
        if (effectiveTeam !== null) {
            if (effectiveTeam <= 12) {
                bucket = "micro";
                multiplier = 0.9;
            } else if (effectiveTeam <= 50) {
                bucket = "small";
                multiplier = 1.0;
            } else if (effectiveTeam <= 200) {
                bucket = "mid-market";
                multiplier = 1.15;
            } else {
                bucket = "enterprise";
                multiplier = 1.25;
            }
        }
        if ((rev && rev > 20_000_000) || (totalFunding && totalFunding > 10_000_000)) multiplier = Math.max(multiplier, 1.2);
        return { bucket, multiplier, effectiveTeam, revenueConsidered: rev, fundingConsidered: totalFunding };
    } catch {
        return { bucket: "unknown", multiplier: 1.0, effectiveTeam: null, revenueConsidered: null, fundingConsidered: null };
    }
}

// ---------------------------------------------------------------------------
// 3.5 — priority = pain × intent (multiplicative)
// ---------------------------------------------------------------------------

/**
 * Combines pain (0-100) and intent (0-100) multiplicatively so zero intent
 * suppresses priority even at high pain, and high intent boosts priority
 * even at moderate pain. Applies the deal-size multiplier (3.4) on top.
 * "Low priority" is reserved strictly for the low×low quadrant.
 */
function computeMultiplicativePriority(painScore, intentScore, dealSizeMultiplier) {
    try {
        const pain = clamp(painScore, 0, 100) / 100;
        const intent = clamp(intentScore, 0, 100) / 100;
        const mult = typeof dealSizeMultiplier === "number" && isFinite(dealSizeMultiplier) ? dealSizeMultiplier : 1.0;
        const raw = pain * intent * 100 * mult;
        const score = clamp(raw, 0, 100);

        const painHigh = pain >= 0.5;
        const intentHigh = intent >= 0.5;
        let tier;
        if (!painHigh && !intentHigh) tier = "Low";
        else if (painHigh && intentHigh) tier = "High";
        else tier = "Medium";

        return { priorityScore: score, priorityTier: tier, painHigh, intentHigh };
    } catch {
        return { priorityScore: 0, priorityTier: "Low", painHigh: false, intentHigh: false };
    }
}

// ---------------------------------------------------------------------------
// 3.6 — NURTURE verdict gate
// ---------------------------------------------------------------------------

/** High ICP-fit + low intent, regardless of pain score, should be NURTURE. */
function shouldNurture(icpFitScore, intentScore) {
    try {
        return clamp(icpFitScore, 0, 100) >= 65 && clamp(intentScore, 0, 100) < 25;
    } catch {
        return false;
    }
}

module.exports = {
    DEFAULT_ICP_PROFILE,
    computeIcpFitScore,
    computeGenericPainSignals,
    computePainSignals,
    PAIN_LIBRARY,
    resolveIndustryKey,
    computeRevenuePerEmployeeEfficiency,
    computeDealSizeWeight,
    computeMultiplicativePriority,
    shouldNurture,
};
