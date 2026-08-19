/**
 * Canonical Action Card — single source of truth for CONTACT / NURTURE / SKIP.
 * Assembled after strategy + messaging; never invents company facts.
 */

let DeliverabilityL = {};
try { DeliverabilityL = require("./deliverability"); } catch { /* keep {} */ }

const PRIORITY_RANK = { High: 3, Medium: 2, Low: 1 };

function clamp(n, lo = 0, hi = 100) {
    return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
}

function truncate(s, max) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function lowerTier(a, b) {
    const ra = PRIORITY_RANK[a] || 2;
    const rb = PRIORITY_RANK[b] || 2;
    return ra <= rb ? a : b;
}

function tierDistance(a, b) {
    return Math.abs((PRIORITY_RANK[a] || 2) - (PRIORITY_RANK[b] || 2));
}

function pickChannel(data) {
    const ch = (data.finalRecommendation && data.finalRecommendation.channel) ||
        (Array.isArray(data.channels) && data.channels[0] && data.channels[0][0]) ||
        "Email";
    if (/linkedin/i.test(ch)) return "LinkedIn";
    if (/phone|call/i.test(ch)) return "Phone";
    if (/whatsapp/i.test(ch)) return "WhatsApp";
    return "Email";
}

function pickSubject(messages, data) {
    const company = (data.lead && data.lead.company) || "your company";
    let raw = "";
    const cold = (messages && messages.coldEmail) || (data.messages && data.messages.coldEmail) || {};
    // Prefer primary cold-email subject (already deliverability-scrubbed) over A/B variants.
    if (Array.isArray(cold.subjectLines) && cold.subjectLines[0]) raw = cold.subjectLines[0];
    else if (cold.subject) raw = cold.subject;
    else {
        const v2 = data.subjectLineVariants;
        if (Array.isArray(v2) && v2.length) {
            const first = v2[0];
            if (typeof first === "string") raw = first;
            else if (first && first.text) raw = first.text;
            else if (first && first.subject) raw = first.subject;
            else if (first && first.line) raw = first.line;
        }
    }
    if (!raw) raw = `Quick note on ${company}`;
    return DeliverabilityL.scrubSubject ? DeliverabilityL.scrubSubject(raw, company) : raw;
}

function pickBody(messages, data) {
    const cold = (messages && messages.coldEmail) || (data.messages && data.messages.coldEmail) || {};
    let body = "";
    if (cold.body) body = String(cold.body);
    else {
        const touch = Array.isArray(data.touchSequence)
            ? data.touchSequence.find((t) => t && /email/i.test(t.channel || t.label || ""))
            : null;
        if (touch && (touch.body || touch.script)) body = String(touch.body || touch.script);
    }
    return DeliverabilityL.scrubText ? DeliverabilityL.scrubText(body) : body;
}

function pickWhyNow(data, strat) {
    const exec = data.executiveWhyNow;
    if (exec && exec.summary) return truncate(exec.summary, 220);
    const paras = data.executiveSummary && data.executiveSummary.paragraphs;
    if (Array.isArray(paras)) {
        const why = paras.find((p) => /^why now:/i.test(p));
        if (why) return truncate(why.replace(/^why now:\s*/i, ""), 220);
    }
    const pain = strat && strat.copy && strat.copy.pain;
    if (pain) return truncate(pain, 220);
    const timing = data.timingSignals && data.timingSignals.signals && data.timingSignals.signals[0];
    if (timing && timing.signal) return truncate(String(timing.signal), 220);
    return "Not enough public information to justify urgency.";
}

function pickFirstOffer(data, strat) {
    if (data.bestFirstOffer && data.bestFirstOffer.offer) {
        return {
            name: data.bestFirstOffer.offer,
            why: data.bestFirstOffer.why || "",
        };
    }
    const ranked = data.rankedOffers;
    if (Array.isArray(ranked) && ranked[0] && ranked[0].name) {
        return { name: ranked[0].name, why: ranked[0].evidence || "" };
    }
    if (strat && strat.best) {
        return { name: strat.best.name, why: strat.best.evidence || "" };
    }
    return { name: "Not enough public information.", why: "" };
}

function pickOfferWhy(offer, data) {
    if (offer.why) return truncate(offer.why, 220);
    const ranked = Array.isArray(data.rankedOffers) ? data.rankedOffers[0] : null;
    if (ranked && ranked.evidence) return truncate(ranked.evidence, 220);
    return "Selected as the highest-evidence first move from observed site gaps.";
}

function resolvePriority(data) {
    const model =
        data.priorityV2 ||
        (data.priorityModel && data.priorityModel.priorityTier) ||
        (data.finalRecommendation && data.finalRecommendation.priority) ||
        (data.executiveSummary && data.executiveSummary.priority) ||
        "Medium";
    const legacy =
        (data.executiveSummary && data.executiveSummary.priority) ||
        (data.finalRecommendation && data.finalRecommendation.priority) ||
        model;

    const subs = (data.confidenceModel && data.confidenceModel.subScores) || {};
    // Sub-scores use different maxes (data~30, contact~25, signal~25, offer~20).
    // Only flag when a bucket is truly thin — not when it's merely under 40.
    const weakSubs =
        (typeof subs.dataCompleteness === "number" && subs.dataCompleteness < 12) ||
        (typeof subs.signalStrength === "number" && subs.signalStrength < 8) ||
        (typeof subs.offerStrength === "number" && subs.offerStrength < 6);

    const farConflict = tierDistance(model, legacy) > 1;
    const unresolvedConflict = !!(data.verdictConflict || (data.priorityReconciliation && data.priorityReconciliation.conflict));
    const routineCap = !!(data.priorityCappedByPainIntent || (data.priorityReconciliation && data.priorityReconciliation.capped));

    let priority = model;
    let reviewFlag = false;
    let reviewNote;

    // Routine pain×intent High→Medium cap is expected — not a yellow "conflict".
    if (unresolvedConflict || (farConflict && !routineCap) || weakSubs) {
        reviewFlag = true;
        priority = lowerTier(model, legacy);
        if (PRIORITY_RANK[priority] === 3) priority = "Medium";
        reviewNote =
            (data.priorityReconciliation && data.priorityReconciliation.conflict && data.priorityReconciliation.note) ||
            (weakSubs ? "Thin signals — manual review before treating as High" : "Signal conflict — manual review before treating as High");
        reviewNote = truncate(reviewNote, 220);
    } else if (routineCap && PRIORITY_RANK[priority] === 3) {
        priority = "Medium";
    }

    return { priority, reviewFlag, reviewNote, model, legacy };
}

function resolveConfidence(data) {
    if (data.confidenceModel && typeof data.confidenceModel.confidenceV2 === "number") {
        return clamp(data.confidenceModel.confidenceV2);
    }
    if (data.finalRecommendation && typeof data.finalRecommendation.confidence === "number") {
        return clamp(data.finalRecommendation.confidence);
    }
    if (typeof data.finalRecommendation?.confidence === "string") {
        const m = String(data.finalRecommendation.confidence).match(/(\d+)/);
        if (m) return clamp(parseInt(m[1], 10));
    }
    return 0;
}

/**
 * Build the canonical actionCard and sync user-facing priority fields to it.
 * @returns {{ actionCard: object, data: object }}
 */
function attachActionCard(data, strat, messages) {
    try {
        const lead = data.lead || {};
        const bucket = data.pipelineBucket || "STANDARD";
        const dq = data.disqualification && data.disqualification.disqualified;
        const unreachable = data.websiteAudit && data.websiteAudit.analyzedUrl && data._unreachable === true;

        let decision = "CONTACT";
        let skipReason;
        if (bucket === "DISQUALIFIED" || dq) {
            decision = "SKIP";
            const reasons = (data.disqualification && data.disqualification.reasons) || [];
            skipReason = reasons.length
                ? truncate(reasons.map((r) => r.detail || r.code).join("; "), 220)
                : "Disqualified against ICP / hard filters.";
        } else if (unreachable) {
            decision = "SKIP";
            skipReason = truncate(data._unreachableReason || "Website unreachable — incomplete research.", 220);
        } else if (bucket === "NURTURE" || data.nurture) {
            decision = "NURTURE";
        } else {
            decision = "CONTACT";
        }

        const { priority, reviewFlag, reviewNote } = decision === "SKIP"
            ? { priority: "Low", reviewFlag: false, reviewNote: undefined }
            : resolvePriority(data);

        const offer = pickFirstOffer(data, strat);
        const confidence = resolveConfidence(data);
        const whyNow = pickWhyNow(data, strat);
        const offerWhy = pickOfferWhy(offer, data);

        const actionCard = {
            decision,
            priority,
            confidence,
            whyNow,
            firstOffer: offer.name,
            offerWhy,
            channel: pickChannel(data),
            email: {
                to: lead.email && !/^not enough/i.test(lead.email) ? lead.email : "",
                firstName: lead.firstName || (lead.fullName ? String(lead.fullName).split(/\s+/)[0] : ""),
                company: lead.company || "",
                subject: pickSubject(messages, data),
                body: pickBody(messages, data),
            },
        };

        if (decision === "SKIP") actionCard.skipReason = skipReason || "Skipped.";
        if (reviewFlag) {
            actionCard.reviewFlag = true;
            actionCard.reviewNote = reviewNote || "Signal conflict — manual review before treating as High";
        }

        // Sync displayed priority everywhere so UI never shows High+Low without reviewFlag.
        data.actionCard = actionCard;
        if (data.executiveSummary) {
            data.executiveSummary.priority = priority;
            if (Array.isArray(data.executiveSummary.keyFacts)) {
                data.executiveSummary.keyFacts = data.executiveSummary.keyFacts.map(([k, v]) =>
                    k === "Priority" ? [k, priority] : [k, v]
                );
            }
        }
        if (data.finalRecommendation) {
            data.finalRecommendation.priority = priority;
            data.finalRecommendation.confidence = confidence;
            if (decision === "SKIP") data.finalRecommendation.verdict = "NO";
            else if (decision === "NURTURE") data.finalRecommendation.verdict = "NURTURE";
        }
        // Keep priorityV2 aligned with the action card (single model for display).
        data.priorityV2 = priority;

        return data;
    } catch {
        data.actionCard = data.actionCard || {
            decision: "NURTURE",
            priority: "Low",
            confidence: 0,
            whyNow: "Not enough public information.",
            firstOffer: "Not enough public information.",
            offerWhy: "Action card assembly failed — regenerate.",
            channel: "Email",
            email: { to: "", firstName: "", company: "", subject: "", body: "" },
            reviewFlag: true,
            reviewNote: "Action card assembly failed — manual review required.",
        };
        return data;
    }
}

/**
 * Minimal prospect payload when the site is unreachable (SKIP, no invented strategy).
 */
function buildUnreachableSkipData(lead, research, reason) {
    const company = (lead && lead.company) || "Prospect";
    const nf = "Not enough public information.";
    const data = {
        meta: {
            reportTitle: "Prospect Intelligence Report",
            generatedDate: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }),
            preparedFor: "Growth & Outreach Team",
            analyst: "Automated Prospect Intelligence Engine",
            confidenceNote: "Website could not be loaded. No sales strategy was invented from empty research.",
        },
        lead: {
            fullName: (lead && lead.fullName) || nf,
            firstName: lead && lead.firstName,
            lastName: lead && lead.lastName,
            title: (lead && lead.title) || nf,
            company,
            email: (lead && lead.email) || nf,
            phone: (lead && lead.phone) || nf,
            website: (research && research.website) || (lead && lead.website) || nf,
            linkedin: (lead && lead.linkedin) || nf,
            industry: (lead && lead.industry) || nf,
            city: (lead && lead.city) || "",
            state: (lead && lead.state) || "",
            country: (lead && lead.country) || "",
        },
        executiveSummary: {
            verdict: "NO",
            priority: "Low",
            paragraphs: [
                `${company} — website unreachable. Skipped for outreach until a reachable URL is available.`,
                `Why now: ${reason}`,
            ],
            keyFacts: [
                ["Decision maker", (lead && lead.fullName) || nf],
                ["Company", company],
                ["Priority", "Low"],
                ["Confidence", "0%"],
                ["Best first offer", "—"],
            ],
        },
        websiteAudit: {
            overallScore: 0,
            summary: reason,
            analyzedUrl: (research && research.website) || (lead && lead.website) || "",
            sections: [],
            pages: [],
        },
        bestFirstOffer: { offer: "—", why: "Site unreachable; no offer recommended." },
        messages: {
            coldEmail: { subjectLines: [], body: "" },
            whatsapp: "",
            linkedin: "",
            callOpener: "",
            objectionHandling: [],
            followUps: [],
        },
        finalRecommendation: {
            verdict: "NO",
            priority: "Low",
            confidence: 0,
            channel: "Email",
            firstOffer: "—",
            nextStep: "Fix or replace the website URL, then regenerate.",
            reasoning: reason,
        },
        pipelineBucket: "DISQUALIFIED",
        verdictV2: "DISQUALIFIED",
        priorityV2: "Low",
        nurture: false,
        disqualification: {
            disqualified: true,
            reasons: [{ code: "unreachable_site", detail: reason }],
        },
        confidenceModel: { confidenceV2: 0, subScores: { dataCompleteness: 0, contactability: 0, signalStrength: 0, offerStrength: 0 } },
        _unreachable: true,
        _unreachableReason: reason,
    };
    return attachActionCard(data, null, data.messages);
}

module.exports = {
    attachActionCard,
    buildUnreachableSkipData,
    PRIORITY_RANK,
    lowerTier,
    tierDistance,
};
