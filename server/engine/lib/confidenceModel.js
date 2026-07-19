/**
 * PHASE 1.2 / 1.3 — Confidence-decay flag + decomposed, multi-signal
 * confidence model.
 *
 * This is purely ADDITIVE: strategy.js's existing `strat.confidence` field
 * (and everywhere it's consumed) is untouched. This module computes a
 * SEPARATE, more granular confidence score (`confidenceV2`) plus the three
 * requested sub-scores so reports can show them side by side with the
 * original number, per STRICT RULE #1 (never remove/rename existing
 * fields).
 */

const { clamp, safeCall } = require("./utils");

const MIN_TOTAL_CHARS_FOR_FULL_CONFIDENCE = 400;
const MIN_PAGES_FOR_FULL_CONFIDENCE = 1;
const THIN_CRAWL_CEILING = 35;

/**
 * PHASE 1.2 — caps confidence and attaches a visible flag when the crawl
 * (even after the 1.1 headless-render fallback) is too thin/blocked to
 * trust.
 */
function computeCrawlDecay(research) {
    try {
        if (!research) {
            return { thin: true, ceiling: THIN_CRAWL_CEILING, flag: "Limited data — verify manually before outreach.", reason: "No research object" };
        }
        if (!research.reachable) {
            return { thin: true, ceiling: THIN_CRAWL_CEILING, flag: "Limited data — verify manually before outreach.", reason: "Website unreachable" };
        }
        const pages = research.pages ? Object.keys(research.pages).length : 0;
        const chars = safeCall(() => {
            const wc = (research.signals && research.signals.wordCount) || 0;
            return wc * 5.5; // rough words->chars estimate, avoids re-parsing HTML here
        }, 0);
        const thin = pages <= MIN_PAGES_FOR_FULL_CONFIDENCE && chars < MIN_TOTAL_CHARS_FOR_FULL_CONFIDENCE;
        if (thin) {
            return {
                thin: true,
                ceiling: THIN_CRAWL_CEILING,
                flag: "Limited data — verify manually before outreach.",
                reason: `Only ${pages} page(s) and ~${Math.round(chars)} chars of content crawled`,
            };
        }
        return { thin: false, ceiling: null, flag: null, reason: "" };
    } catch {
        return { thin: true, ceiling: THIN_CRAWL_CEILING, flag: "Limited data — verify manually before outreach.", reason: "Decay check failed safely" };
    }
}

/**
 * PHASE 1.3 — multi-signal, decomposed confidence model. Every input is
 * null-checked; anything missing just contributes 0 to that bucket rather
 * than throwing.
 *
 * @param {object} lead
 * @param {object} research
 * @param {object} analysis
 * @param {object} best - the top-scoring offer candidate ({score, ...})
 * @param {object} [gaps] - strat.gaps (chat/capture/cta/booking/... booleans)
 * @param {number} [timingScore] - from detectBuyingTimingSignals (Phase 2.2)
 * @param {object} [ruleLog] - optional audit logger (see utils.createRuleLog)
 */
function calculateConfidence(lead, research, analysis, best, gaps, timingScore, ruleLog) {
    const fire = (rule, points, reason) => {
        if (ruleLog && typeof ruleLog.fire === "function") ruleLog.fire(rule, points, reason);
    };
    const L = lead || {};
    const R = research || { pages: {}, facts: {}, tech: { stack: [] } };
    const A = analysis || {};
    const B = best || { score: 0 };
    const G = gaps || {};
    const facts = R.facts || {};

    // ---- Data completeness (know?) — max 30 ----
    let dataCompleteness = 0;
    if (R.reachable) {
        dataCompleteness += 12;
        fire("dataCompleteness.reachable", 12, "Website was reachable during research");
    }
    const pagesUseful = safeCall(() => Object.keys(R.pages || {}).length, 0);
    const pagesPoints = Math.min(8, pagesUseful * 2);
    if (pagesPoints) {
        dataCompleteness += pagesPoints;
        fire("dataCompleteness.pages", pagesPoints, `${pagesUseful} useful page(s) crawled`);
    }
    if (facts.description && facts.description.length > 40) {
        dataCompleteness += 5;
        fire("dataCompleteness.description", 5, "Description longer than 40 chars found");
    }
    if (facts.services && facts.services.length > 2) {
        dataCompleteness += 5;
        fire("dataCompleteness.services", 5, `${facts.services.length} services detected`);
    }
    dataCompleteness = clamp(dataCompleteness, 0, 30);

    // ---- Contactability (reach?) — max 25 ----
    let contactability = 0;
    if (L.email && L.emailStatus !== "invalid") {
        contactability += 12;
        fire("contactability.email.valid", 12, "Email present and not flagged invalid");
    } else if (L.email) {
        contactability += 6;
        fire("contactability.email.risky", 6, "Email present but status is invalid/unknown");
    }
    if (L.phone) {
        contactability += 5;
        fire("contactability.phone", 5, "Phone number on file");
    }
    if (L.linkedin) {
        contactability += 8;
        fire("contactability.linkedin", 8, "LinkedIn profile on file");
    }
    contactability = clamp(contactability, 0, 25);

    // ---- Research depth / signal strength (understand?) — max 25 ----
    let signalStrength = 0;
    if (facts.audience) {
        signalStrength += 5;
        fire("signalStrength.audience", 5, "Target audience identified");
    }
    if (facts.businessModel && facts.businessModel.type && facts.businessModel.type !== "unknown" && facts.businessModel.type !== "business") {
        signalStrength += 5;
        fire("signalStrength.businessModel", 5, `Business model classified as ${facts.businessModel.type}`);
    }
    if (typeof A.overallScore === "number" && A.overallScore >= 0 && A.overallScore <= 100) {
        signalStrength += 5;
        fire("signalStrength.websiteScore", 5, "Website score computed successfully");
    }
    if (facts.rating) {
        signalStrength += 3;
        fire("signalStrength.rating", 3, "Public rating/review data found");
    }
    if (R.tech && Array.isArray(R.tech.stack) && R.tech.stack.length > 2) {
        signalStrength += 4;
        fire("signalStrength.techStack", 4, `${R.tech.stack.length} technologies detected`);
    }
    if (facts.foundedYear) {
        signalStrength += 3;
        fire("signalStrength.foundedYear", 3, "Founding year found");
    }
    signalStrength = clamp(signalStrength, 0, 25);

    // ---- Offer strength — max 20 ----
    let offerStrength = 0;
    if (B.score > 5) {
        offerStrength += 12;
        fire("offerStrength.strong", 12, `Best offer score ${B.score} > 5`);
    } else if (B.score > 3) {
        offerStrength += 8;
        fire("offerStrength.moderate", 8, `Best offer score ${B.score} > 3`);
    } else if (B.score > 1) {
        offerStrength += 3;
        fire("offerStrength.weak", 3, `Best offer score ${B.score} > 1`);
    }
    const gapCount = safeCall(() => Object.values(G).filter(Boolean).length, 0);
    const gapPoints = Math.min(8, gapCount * 2);
    if (gapPoints) {
        offerStrength += gapPoints;
        fire("offerStrength.gaps", gapPoints, `${gapCount} evidence gap(s) support the offer`);
    }
    offerStrength = clamp(offerStrength, 0, 20);

    let confidence = dataCompleteness + contactability + signalStrength + offerStrength;

    // Timing signals (Phase 2.2) feed into confidence, capped at +20.
    const timingBoost = Math.min(20, Number(timingScore) || 0);
    if (timingBoost) {
        confidence += timingBoost;
        fire("confidenceV2.timingBoost", timingBoost, "Buying-timing signals detected (Phase 2.2)");
    }

    confidence = clamp(confidence, 0, 95);

    return {
        confidenceV2: confidence,
        subScores: {
            dataCompleteness,
            contactability,
            signalStrength,
            offerStrength,
        },
    };
}

module.exports = { calculateConfidence, computeCrawlDecay, THIN_CRAWL_CEILING };
