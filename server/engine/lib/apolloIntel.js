/**
 * PHASE 4 — Apollo/CSV Data Utilization.
 *
 * 4.1 revenue-weighted confidence + funding-window boost + seniority/dept scoring
 * 4.2 revenue/company-size tiering (fixes the old "assume small when unknown" gap)
 * 4.3 email verification status -> channel strategy
 * 4.4 LinkedIn profile cross-validation
 *
 * All additive: nothing here mutates strat.confidence, strat.channels, or
 * any existing candidate score in place — callers apply the returned deltas
 * themselves so the original scoring stays inspectable. Every function
 * null-checks inputs and never throws (STRICT RULE #2).
 */

const { clamp, parseTeamSize, parseRevenue, isWithinMonths, lc, safeTest } = require("./utils");

// ---------------------------------------------------------------------------
// 4.1 — revenue-weighted confidence + funding-window boost + seniority/dept scoring
// ---------------------------------------------------------------------------

function computeApolloConfidenceBoosts(lead, ruleLog) {
    const fire = (rule, points, reason) => {
        if (ruleLog && typeof ruleLog.fire === "function") ruleLog.fire(rule, points, reason);
    };
    let points = 0;
    const reasons = [];
    try {
        const L = lead || {};
        const rev = parseRevenue(L.annualRevenue);
        if (rev !== null) {
            if (rev > 10_000_000) {
                points += 8;
                reasons.push(`Annual revenue > $10M (${L.annualRevenue})`);
                fire("apollo.revenueBoost.large", 8, `Annual revenue ${L.annualRevenue} > $10M`);
            } else if (rev > 1_000_000) {
                points += 5;
                reasons.push(`Annual revenue > $1M (${L.annualRevenue})`);
                fire("apollo.revenueBoost.mid", 5, `Annual revenue ${L.annualRevenue} > $1M`);
            }
        }

        let fundingWindowBoost = false;
        if (L.latestFunding && isWithinMonths(L.lastRaisedAt, 18)) {
            points += 12;
            fundingWindowBoost = true;
            reasons.push(`Funding round (${L.latestFunding}) within the last 18 months`);
            fire("apollo.fundingWindowBoost", 12, `${L.latestFunding} within 18 months of last raise date`);
        }

        return { points: clamp(points, 0, 20), reasons, fundingWindowBoost };
    } catch {
        return { points: 0, reasons: ["Apollo confidence boost check failed safely"], fundingWindowBoost: false };
    }
}

const DECISION_MAKER_RE = /founder|owner|ceo|cto|coo|president|partner|director|vp|head/i;
const INFLUENCER_RE = /manager|lead|senior/i;

function classifySeniority(lead) {
    try {
        const title = (lead && lead.title) || "";
        const seniorityField = (lead && lead.seniority) || "";
        const hay = `${title} ${seniorityField}`;
        const isDecisionMaker = DECISION_MAKER_RE.test(hay);
        const isInfluencer = !isDecisionMaker && INFLUENCER_RE.test(hay);
        return { isDecisionMaker, isInfluencer, level: isDecisionMaker ? "decision-maker" : isInfluencer ? "influencer" : "individual-contributor" };
    } catch {
        return { isDecisionMaker: false, isInfluencer: false, level: "unknown" };
    }
}

/**
 * Returns a map of offerId -> extra score points based on department fit,
 * plus the reasons, so decideStrategy() can add these to its own candidate
 * scores without altering the base scoring logic.
 */
function computeDepartmentOfferBoosts(lead, ruleLog) {
    const fire = (rule, points, reason) => {
        if (ruleLog && typeof ruleLog.fire === "function") ruleLog.fire(rule, points, reason);
    };
    const boosts = {};
    const reasons = [];
    try {
        const dept = lc((lead && lead.department) || "");
        if (!dept) return { boosts, reasons };
        if (/marketing|growth|digital/.test(dept)) {
            boosts.landing_cro = (boosts.landing_cro || 0) + 2;
            reasons.push("Marketing/growth department — boosted Landing Page & CRO offer");
            fire("apollo.deptBoost.marketing", 2, `Department "${lead.department}" boosted landing_cro`);
        }
        if (/sales|revenue|business dev/.test(dept)) {
            boosts.ai_chatbot = (boosts.ai_chatbot || 0) + 2;
            reasons.push("Sales/revenue department — boosted AI Chatbot offer");
            fire("apollo.deptBoost.sales", 2, `Department "${lead.department}" boosted ai_chatbot`);
        }
        if (/operations|it\b/.test(dept)) {
            boosts.crm_automation = (boosts.crm_automation || 0) + 2;
            reasons.push("Operations/IT department — boosted CRM Automation offer");
            fire("apollo.deptBoost.ops", 2, `Department "${lead.department}" boosted crm_automation`);
        }
    } catch {
        /* return whatever boosts were computed safely */
    }
    return { boosts, reasons };
}

// ---------------------------------------------------------------------------
// 4.2 — revenue/company-size tiering (fixes "default smallTeam=true when unknown")
// ---------------------------------------------------------------------------

/** Best-effort industry-based tier guess when employees AND revenue are both unknown. */
function classifyTierFromIndustry(industry, research) {
    try {
        const hay = lc(industry) + " " + lc((research && research.facts && research.facts.description) || "");
        if (safeTest(/enterprise|fortune 500|multinational|global (leader|corporation)/i, hay)) return "enterprise";
        if (safeTest(/mid-?size|regional (leader|provider)|scale-?up/i, hay)) return "mid-market";
        return "small";
    } catch {
        return "small";
    }
}

const TIER_MODIFIERS = {
    small: { ai_chatbot: 2, followup_automation: 2, review_automation: 2, crm_automation: -2 },
    "mid-market": { crm_automation: 3, landing_cro: 2, followup_automation: 1, review_automation: -1 },
    enterprise: { crm_automation: 3, saas_demo_booking: 2, landing_cro: 2, ai_chatbot: 0 },
};

function classifyTier(lead, research) {
    try {
        const L = lead || {};
        const team = parseTeamSize(L.employees);
        const rev = parseRevenue(L.annualRevenue);
        let tier = "small"; // 1-12 employees, <$2M rev (default floor)

        if ((team && team > 50) || (rev && rev > 5_000_000)) tier = "mid-market";
        if ((team && team > 200) || (rev && rev > 20_000_000)) tier = "enterprise";
        if (!team && !rev) tier = classifyTierFromIndustry(L.industry, research);

        return tier;
    } catch {
        return "small";
    }
}

/** Returns { candidateId: pointsDelta } for the given tier — apply additively to candidate scores. */
function getTierModifiers(tier) {
    return TIER_MODIFIERS[tier] || {};
}

// ---------------------------------------------------------------------------
// 4.3 — email verification status -> channel strategy
// ---------------------------------------------------------------------------

/**
 * Given the lead's email status and the existing ranked `channels` array
 * (from decideStrategy), returns a NEW re-ranked array (channelsV2) — the
 * original `channels` field is left untouched. Verified email stays/moves to
 * first touch; invalid/guessed/unverified email is downweighted and
 * LinkedIn/phone are promoted.
 */
function computeChannelStrategy(lead, channels) {
    try {
        const status = lc((lead && lead.emailStatus) || "");
        const list = Array.isArray(channels) ? channels.map((c) => [...c]) : [];
        if (!list.length) return { channelsV2: list, note: "No channels available to re-rank" };

        const isVerified = status === "verified";
        const isRisky = ["invalid", "guessed", "unverified", "unknown", ""].includes(status) && status !== "verified";

        if (isVerified) {
            return { channelsV2: list, note: "Email is verified — kept as first touch (no re-ranking needed)." };
        }

        if (isRisky && status) {
            // Demote Email, promote LinkedIn/Phone to the front.
            const emailIdx = list.findIndex((c) => c[0] === "Email");
            if (emailIdx > -1) {
                const [emailRow] = list.splice(emailIdx, 1);
                emailRow[2] = `${emailRow[2] || ""} (Downweighted — email status is "${status}"; verify before sending.)`.trim();
                list.push(emailRow);
            }
            const priorityOrder = ["LinkedIn", "Phone", "WhatsApp"];
            list.sort((a, b) => {
                const ai = priorityOrder.indexOf(a[0]);
                const bi = priorityOrder.indexOf(b[0]);
                if (ai === -1 && bi === -1) return 0;
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
            });
            list.forEach((row, i) => (row[1] = i + 1));
            return { channelsV2: list, note: `Email status "${status}" — LinkedIn/phone promoted to first touch, email demoted.` };
        }

        return { channelsV2: list, note: "Email status unknown — channel order unchanged." };
    } catch {
        return { channelsV2: Array.isArray(channels) ? channels : [], note: "Channel strategy check failed safely" };
    }
}

// ---------------------------------------------------------------------------
// 4.4 — LinkedIn profile cross-validation
// ---------------------------------------------------------------------------

/**
 * LinkedIn is login-gated (scraping it isn't one of the explicitly-allowed
 * external APIs — headless render and PageSpeed are). So instead of an
 * unreliable/ToS-risky scrape, this is a fast, synchronous, dependency-free
 * heuristic cross-check: does the CSV-stated title/seniority look internally
 * consistent, and does a LinkedIn URL exist at all. decideStrategy() stays
 * fully synchronous (no behavior change to its call contract) while still
 * surfacing a genuinely useful data-quality note.
 */
function crossValidateLinkedInHeuristic(lead) {
    try {
        const L = lead || {};
        if (!L.linkedin) return { status: "no_profile", mismatch: false, note: "No LinkedIn URL on file." };

        const looksLikeProfileUrl = /linkedin\.com\/(in|pub)\//i.test(String(L.linkedin));
        if (!looksLikeProfileUrl) {
            return { status: "malformed_url", mismatch: true, note: "LinkedIn URL on file doesn't look like a personal profile URL (linkedin.com/in/...) — verify manually." };
        }

        const seniorityGuess = classifySeniority(L);
        const statedSeniority = lc(L.seniority);
        let mismatch = false;
        if (statedSeniority) {
            const statedSaysSenior = /founder|owner|c-?suite|chief|president|partner|director|vp|head/i.test(statedSeniority);
            if (seniorityGuess.isDecisionMaker && statedSeniority && !statedSaysSenior) mismatch = true;
        }

        return {
            status: "reachable_format_ok",
            mismatch,
            note: mismatch
                ? `Title ("${L.title || ""}") reads as decision-maker level but the CSV "seniority" field ("${L.seniority || ""}") doesn't match — verify manually before role-framing messaging.`
                : "LinkedIn URL format looks valid; title/seniority in the CSV are internally consistent. Full profile content is login-gated so this is a heuristic check, not a live scrape — verify manually before outreach.",
        };
    } catch {
        return { status: "unknown", mismatch: false, note: "LinkedIn cross-validation failed safely." };
    }
}

/**
 * Optional, best-effort ASYNC reachability check (not wired into the sync
 * decideStrategy pipeline — available for callers that can await it, e.g. a
 * future batch-enrichment step). Still never throws.
 */
async function crossValidateLinkedInFetch(lead, timeout = 8000) {
    try {
        const L = lead || {};
        if (!L.linkedin) return { status: "no_profile", mismatch: false, note: "No LinkedIn URL on file." };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        let reachable = false;
        try {
            const res = await fetch(L.linkedin, {
                method: "GET",
                redirect: "follow",
                signal: controller.signal,
                headers: { "User-Agent": "Mozilla/5.0 (compatible; ProspectIntelligenceBot/1.0)" },
            });
            reachable = res.ok || res.status === 999; // LinkedIn often returns 999 to bots — still "exists"
        } catch {
            reachable = false;
        } finally {
            clearTimeout(timer);
        }

        // LinkedIn blocks unauthenticated scraping, so title/seniority text is
        // not extractable here. We only confirm reachability and flag that a
        // human should visually cross-check title/seniority before outreach.
        return {
            status: reachable ? "unverified_reachable" : "unreachable",
            mismatch: false,
            note: reachable
                ? "LinkedIn URL resolves; profile content is login-gated so title/seniority could not be auto cross-checked — verify manually."
                : "LinkedIn URL could not be confirmed reachable — verify manually before using it as a channel.",
        };
    } catch {
        return { status: "unknown", mismatch: false, note: "LinkedIn cross-validation failed safely." };
    }
}

module.exports = {
    computeApolloConfidenceBoosts,
    classifySeniority,
    computeDepartmentOfferBoosts,
    classifyTierFromIndustry,
    classifyTier,
    getTierModifiers,
    TIER_MODIFIERS,
    computeChannelStrategy,
    crossValidateLinkedInHeuristic,
    crossValidateLinkedInFetch,
};
