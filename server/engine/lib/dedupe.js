/**
 * PHASE 3.7 — Lead-to-lead deduplication by normalized root domain.
 *
 * This operates at the BATCH level (a list of leads), not per-lead, so it's
 * a separate module the CLI/report-service can call before/around
 * processLead(). It never removes leads or reduces the report count — the
 * pipeline still produces one report per contact (STRICT RULE #1: never
 * change existing output shape/count). Instead it annotates each lead with
 * its company-group context so buildProspectData can attach a reconciled,
 * consistent company-level verdict alongside the per-contact one.
 */

const { rootDomain } = require("./utils");

/**
 * @param {Array<object>} leads
 * @returns {Map<string, object[]>} domain -> leads sharing that domain (only
 *   domains that resolved to a non-empty string are grouped)
 */
function groupLeadsByDomain(leads) {
    const groups = new Map();
    try {
        for (const lead of leads || []) {
            if (!lead) continue;
            const domain = rootDomain(lead.website);
            if (!domain) continue;
            if (!groups.has(domain)) groups.set(domain, []);
            groups.get(domain).push(lead);
        }
    } catch {
        /* return whatever grouped safely */
    }
    return groups;
}

/**
 * Annotates every lead in `leads` with `_companyGroup` metadata describing
 * its domain-mates (role notes only — no data is merged/dropped). Mutates
 * and returns the same array for convenience.
 */
function annotateCompanyGroups(leads) {
    try {
        const groups = groupLeadsByDomain(leads);
        for (const [domain, group] of groups) {
            if (group.length < 2) continue;
            for (const lead of group) {
                lead._companyGroup = {
                    domain,
                    contactCount: group.length,
                    otherContacts: group
                        .filter((l) => l !== lead)
                        .map((l) => ({ fullName: l.fullName || "", title: l.title || "", email: l.email || "" })),
                };
            }
        }
    } catch {
        /* leave leads unannotated on failure — never throws */
    }
    return leads || [];
}

/**
 * Given the finished prospect_data objects for a group of contacts at the
 * same company, reconciles conflicting offer/priority outputs into one
 * consistent company-level verdict while retaining each contact's own
 * report untouched. Call this AFTER all reports in the group are built.
 */
function reconcileCompanyVerdict(prospectDataList) {
    try {
        const list = (prospectDataList || []).filter(Boolean);
        if (!list.length) return null;
        if (list.length === 1) {
            const only = list[0];
            return {
                contactCount: 1,
                consensusVerdict: only.finalRecommendation?.verdict || only.executiveSummary?.verdict || "MAYBE",
                consensusPriority: only.finalRecommendation?.priority || only.executiveSummary?.priority || "Medium",
                consensusOffer: only.bestFirstOffer?.offer || null,
                perContactNotes: [{ fullName: only.lead?.fullName || "", title: only.lead?.title || "", offer: only.bestFirstOffer?.offer || null, priority: only.finalRecommendation?.priority || null }],
            };
        }

        const verdictRank = { YES: 3, NURTURE: 2, MAYBE: 1, NO: 0, DISQUALIFIED: -1 };
        const priorityRank = { High: 3, Medium: 2, Low: 1 };

        let bestVerdict = "MAYBE";
        let bestPriority = "Low";
        const offerCounts = new Map();
        const perContactNotes = [];

        for (const data of list) {
            const verdict = data.finalRecommendation?.verdict || data.executiveSummary?.verdict || "MAYBE";
            const priority = data.finalRecommendation?.priority || data.executiveSummary?.priority || "Low";
            const offer = data.bestFirstOffer?.offer || null;

            if ((verdictRank[verdict] ?? 0) > (verdictRank[bestVerdict] ?? 0)) bestVerdict = verdict;
            if ((priorityRank[priority] ?? 0) > (priorityRank[bestPriority] ?? 0)) bestPriority = priority;
            if (offer) offerCounts.set(offer, (offerCounts.get(offer) || 0) + 1);

            perContactNotes.push({ fullName: data.lead?.fullName || "", title: data.lead?.title || "", offer, priority });
        }

        let consensusOffer = null;
        let bestCount = 0;
        for (const [offer, count] of offerCounts) {
            if (count > bestCount) {
                bestCount = count;
                consensusOffer = offer;
            }
        }

        return {
            contactCount: list.length,
            consensusVerdict: bestVerdict,
            consensusPriority: bestPriority,
            consensusOffer,
            perContactNotes,
        };
    } catch {
        return null;
    }
}

module.exports = { groupLeadsByDomain, annotateCompanyGroups, reconcileCompanyVerdict };
