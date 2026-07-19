/**
 * PHASE 6 — Offer and Message Output Layer.
 *
 * 6.1 ranked multi-offer output (Primary + 2 Secondary)
 * 6.2 segment/industry-specific offer & messaging libraries
 * 6.3 evidence-anchored, mandatory-specificity rule
 * 6.4 seniority-adapted message tone and pain framing
 * 6.5 subject-line A/B variants tagged by evidence type
 * 6.6 dynamic, profile-aware objection handling
 * 6.7 multi-touch, cross-channel sequencing logic
 * 6.8 evidence-strength-scaled "why now" copy
 * 6.9 executive "Why This Lead / Why Now / Opening Line" summary block
 *
 * Every function is additive and layered ON TOP of strategy.js's existing
 * generateMessages()/decideStrategy() output — nothing here replaces the
 * original whatsapp/coldEmail/linkedin/callOpener/icebreakers/
 * objectionHandling fields. Callers merge these as NEW fields.
 */

const { safeTest, clamp, lc } = require("./utils");

// ---------------------------------------------------------------------------
// 6.1 — ranked multi-offer output (Primary + 2 Secondary)
// ---------------------------------------------------------------------------

/** @param {Array<{id:string,name:string,score:number,evidence:string}>} candidates */
function rankOffers(candidates) {
    try {
        const sorted = [...(candidates || [])].filter(Boolean).sort((a, b) => (b.score || 0) - (a.score || 0));
        const labels = ["Primary", "Secondary", "Tertiary"];
        return sorted.slice(0, 3).map((c, i) => ({ label: labels[i], id: c.id, name: c.name, score: c.score, evidence: c.evidence }));
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// 6.2 — segment-specific + industry-specific offer/messaging libraries
// ---------------------------------------------------------------------------

/**
 * Industry-specific phrasing overrides keyed by offer id. Falls back to the
 * generic OFFER_COPY from strategy.js when no override exists for the given
 * industry/offer combination — this NEVER removes the generic copy, only
 * supplements it with sharper, vertical-specific language when available.
 */
const INDUSTRY_MESSAGE_LIBRARY = {
    dental: {
        appointment_booking: { pain: "Patients calling during office hours is the only way to book — after-hours interest is lost.", outcome: "let patients book cleanings and consults online, any time" },
        review_automation: { pain: "New patients research reviews before choosing a dentist, and there's no system generating them.", outcome: "systematically build 5-star Google reviews after every visit" },
    },
    saas: {
        saas_demo_booking: { pain: "Visitors have to hunt for a way to book a demo, which kills trial-to-paid momentum.", outcome: "turn more trial sign-ups into booked, qualified demos" },
        ai_chatbot: { pain: "Product questions go to a contact form instead of getting answered in the moment.", outcome: "answer product questions instantly and route hot leads to sales" },
    },
    ecommerce: {
        ecom_email_automation: { pain: "Carts are abandoned with no automated recovery flow, and repeat customers get no lifecycle emails.", outcome: "recover abandoned carts and grow repeat purchase revenue on autopilot" },
        review_automation: { pain: "Product pages have little to no review volume, which suppresses conversion.", outcome: "systematically grow verified product reviews after every order" },
    },
    local_service: {
        review_automation: { pain: "Local reputation is left to chance with no system requesting reviews after every job.", outcome: "turn every completed job into a 5-star review request" },
        appointment_booking: { pain: "Booking still happens by phone tag instead of self-serve scheduling.", outcome: "let customers book themselves in and fill the calendar automatically" },
    },
    b2b_industrial: {
        landing_cro: { pain: "Buyers can't find a clear way to request a quote without calling.", outcome: "turn more site traffic into RFQs and qualified sales conversations" },
        crm_automation: { pain: "Quote requests and follow-ups are tracked manually across inboxes.", outcome: "get every RFQ and follow-up tracked automatically in one pipeline" },
    },
    legal: {
        appointment_booking: { pain: "Prospective clients have no way to book a free consultation online.", outcome: "let prospective clients book a consultation without calling during office hours" },
    },
    real_estate: {
        landing_cro: { pain: "There's no easy way for buyers/sellers to search listings or leave contact info.", outcome: "turn more site visitors into captured buyer/seller leads" },
    },
    restaurants: {
        appointment_booking: { pain: "There's no way to reserve a table or order online — it's phone-only.", outcome: "let guests reserve a table or order online without calling" },
    },
};

/**
 * Business-model/segment level overrides (broader than industry — applies
 * across many industries that share a business model).
 */
const SEGMENT_MESSAGE_LIBRARY = {
    marketplace: { landing_cro: { pain: "Buyers and sellers both need a frictionless way to list/browse — generic CTAs slow that down.", outcome: "convert more browsing visitors into active buyers or listed sellers" } },
    agency: { landing_cro: { pain: "The site sells services generically instead of leading with proof (case studies/clients).", outcome: "turn more visitors into discovery calls using stronger proof and CTAs" } },
    franchise: { landing_cro: { pain: "Franchise inquiries have to hunt for the right form instead of a clear, dedicated path.", outcome: "capture more qualified franchise inquiries" } },
    nonprofit: { landing_cro: { pain: "The donate path isn't prominent, so goodwill traffic doesn't convert into gifts.", outcome: "turn more visitors and goodwill into completed donations" } },
};

/** Returns the sharpest available copy for (offerId, industryKey, extendedModelType), else null (caller keeps the generic copy). */
function getSegmentOfferCopy(offerId, industryKey, extendedModelType) {
    try {
        if (industryKey && INDUSTRY_MESSAGE_LIBRARY[industryKey] && INDUSTRY_MESSAGE_LIBRARY[industryKey][offerId]) {
            return { ...INDUSTRY_MESSAGE_LIBRARY[industryKey][offerId], source: `industry:${industryKey}` };
        }
        if (extendedModelType && SEGMENT_MESSAGE_LIBRARY[extendedModelType] && SEGMENT_MESSAGE_LIBRARY[extendedModelType][offerId]) {
            return { ...SEGMENT_MESSAGE_LIBRARY[extendedModelType][offerId], source: `segment:${extendedModelType}` };
        }
        return null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 6.3 — evidence-anchored, mandatory-specificity rule
// ---------------------------------------------------------------------------

/**
 * A message opener is "specific" only if it names a concrete, verifiable
 * detail: a named page, a specific gap, or a specific date/number. Generic
 * phrases ("we noticed some issues") fail this check.
 */
function checkOpenerSpecificity(openerText) {
    try {
        const text = String(openerText || "");
        const hasNamedPage = safeTest(/\b(about|services|pricing|contact|careers|blog|team)\s*page\b/i, text);
        const hasNumber = safeTest(/\b\d+([.,]\d+)?\s*(%|reviews?|posts?|employees?|years?|days?|\$[\d,]+)\b/i, text);
        const hasNamedGap = safeTest(/\bno (live chat|online booking|contact form|reviews?|testimonials?|cta)\b/i, text);
        const hasDate = safeTest(/\b(19|20)\d{2}\b/, text) || safeTest(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i, text);
        const specific = hasNamedPage || hasNumber || hasNamedGap || hasDate;
        return { specific, hasNamedPage, hasNumber, hasNamedGap, hasDate };
    } catch {
        return { specific: false, hasNamedPage: false, hasNumber: false, hasNamedGap: false, hasDate: false };
    }
}

/** If the strongest available evidence doesn't meet the specificity bar, downgrade messaging confidence rather than ship generic copy. */
function gateMessagingConfidence(openerText, baseConfidence) {
    try {
        const { specific } = checkOpenerSpecificity(openerText);
        if (specific) return { messagingConfidence: clamp(baseConfidence, 0, 100), downgraded: false, note: "Opener meets the specificity bar." };
        const downgraded = clamp((Number(baseConfidence) || 0) * 0.6, 0, 100);
        return { messagingConfidence: downgraded, downgraded: true, note: "Opener lacked a concrete, verifiable detail — messaging confidence downgraded rather than shipping generic copy." };
    } catch {
        return { messagingConfidence: clamp(baseConfidence, 0, 100), downgraded: false, note: "Specificity check failed safely." };
    }
}

// ---------------------------------------------------------------------------
// 6.4 — seniority-adapted message tone and pain framing
// ---------------------------------------------------------------------------

function classifyRole(title, seniority, department) {
    try {
        const t = lc(title);
        const s = lc(seniority);
        const d = lc(department);
        const hay = `${t} ${s}`;

        let level = "individual";
        if (safeTest(/founder|owner|chief|c-?suite|\bceo\b|\bcto\b|\bcoo\b|\bcfo\b|\bcmo\b|president/i, hay)) level = "c-suite";
        else if (safeTest(/\bvp\b|vice president/i, hay)) level = "vp";
        else if (safeTest(/director|head of/i, hay)) level = "director";
        else if (safeTest(/manager|lead\b|senior/i, hay)) level = "manager";

        let func = "general";
        if (safeTest(/sales|business dev|revenue/i, `${hay} ${d}`)) func = "sales";
        else if (safeTest(/marketing|growth|digital|brand/i, `${hay} ${d}`)) func = "marketing";
        else if (safeTest(/operations|ops\b|admin/i, `${hay} ${d}`)) func = "ops";
        else if (safeTest(/it\b|engineering|tech|product|developer/i, `${hay} ${d}`)) func = "tech";

        return { level, function: func, key: `${level}-${func}` };
    } catch {
        return { level: "individual", function: "general", key: "individual-general" };
    }
}

const PAIN_BY_ROLE = {
    "c-suite-general": { focus: "revenue leak", care: "time and growth", cta: "worth 2 minutes?", length: "short" },
    "c-suite-sales": { focus: "revenue leak in the pipeline", care: "growth without adding headcount", cta: "worth 2 minutes?", length: "short" },
    "vp-sales": { focus: "leads going cold", care: "pipeline velocity", cta: "want me to send the breakdown?", length: "medium" },
    "director-sales": { focus: "leads going cold", care: "team quota attainment", cta: "want me to send the breakdown?", length: "medium" },
    "vp-marketing": { focus: "traffic not converting", care: "conversion rate and attribution", cta: "useful either way — want me to send it?", length: "medium" },
    "director-marketing": { focus: "traffic not converting", care: "campaign ROI", cta: "useful either way — want me to send it?", length: "medium" },
    "director-ops": { focus: "manual work that doesn't scale", care: "efficiency and headcount", cta: "happy to share the analysis", length: "medium" },
    "manager-ops": { focus: "manual process gaps", care: "team productivity", cta: "want me to send the short version?", length: "short" },
    "manager-general": { focus: "process gaps", care: "team productivity", cta: "want me to send the short version?", length: "short" },
    default: { focus: null, care: "growth", cta: "worth me sending it over?", length: "medium" },
};

function getRoleFraming(role, fallbackFocus) {
    try {
        const r = role || { level: "individual", function: "general", key: "individual-general" };
        const framing = PAIN_BY_ROLE[r.key] || PAIN_BY_ROLE[`${r.level}-general`] || PAIN_BY_ROLE.default;
        return { ...framing, focus: framing.focus || fallbackFocus || "a gap in converting your existing traffic" };
    } catch {
        return { ...PAIN_BY_ROLE.default, focus: fallbackFocus || "a growth opportunity" };
    }
}

// ---------------------------------------------------------------------------
// 6.5 — subject-line A/B variants tagged by evidence type
// ---------------------------------------------------------------------------

function generateSubjectLineVariants({ company, gapPhrase, timingSignal, techInsight }) {
    const variants = [];
    try {
        if (gapPhrase) variants.push({ text: `${company} — a small fix worth more leads`, evidenceType: "pain-based" });
        if (timingSignal) variants.push({ text: `Timing on ${company} — ${timingSignal}`, evidenceType: "timing-based" });
        if (techInsight) variants.push({ text: `Noticed ${company} runs ${techInsight} — quick idea`, evidenceType: "tech-based" });
        if (!variants.length) variants.push({ text: `Quick note on ${company}`, evidenceType: "pain-based" });
        while (variants.length < 2) variants.push({ text: `${company}, a 2-minute observation`, evidenceType: "pain-based" });
    } catch {
        return [{ text: "Quick note", evidenceType: "pain-based" }];
    }
    return variants.slice(0, 3);
}

// ---------------------------------------------------------------------------
// 6.6 — dynamic, profile-aware objection handling
// ---------------------------------------------------------------------------

function buildObjectionScripts(companyProfile, offerName, role) {
    const scripts = [];
    try {
        const growing = companyProfile === "funded" || companyProfile === "growing";
        if (growing) {
            scripts.push(["We need to move fast on other priorities first.", `Totally get it — that's exactly why this is worth doing now, before ${offerName.toLowerCase()} becomes a bottleneck to the growth you're already seeing.`]);
            scripts.push(["We're mid-fundraise/hiring, this isn't the priority.", "Fair — this runs in the background with almost no time from your side, so it doesn't compete with fundraising or hiring for attention."]);
        } else {
            scripts.push(["We don't have budget for this right now.", `This isn't a marketing spend — ${offerName} plugs a leak in revenue you're already generating. One recovered deal usually covers it.`]);
            scripts.push(["Things are steady, we don't need to change anything.", "Makes sense — this is a low-risk, no-cost-to-review addition, not a rebuild. Happy to just show you the specific gap first."]);
        }
        if (role && role.level === "c-suite") {
            scripts.push(["Send me some info.", "Will do — one page, the specific gap I found and the fix. No generic deck. If it's not useful, no harm done."]);
        } else {
            scripts.push(["I'll need to check with my manager/team.", "Makes sense — happy to send something you can forward internally, or hop on a quick call with both of you."]);
        }
    } catch {
        return [["We're not interested right now.", "Understood — happy to check back another time. Mind if I send the one-page finding either way?"]];
    }
    return scripts;
}

function inferCompanyProfile(lead, research) {
    try {
        const hasFunding = !!(lead && (lead.totalFunding || lead.latestFunding));
        const growingSignals = !!(research && research.timingSignals && research.timingSignals.timingScore > 15);
        if (hasFunding) return "funded";
        if (growingSignals) return "growing";
        return "static";
    } catch {
        return "static";
    }
}

// ---------------------------------------------------------------------------
// 6.7 — multi-touch, cross-channel sequencing logic
// ---------------------------------------------------------------------------

function buildTouchSequence({ company, first, whatsapp, coldEmail, linkedin, callOpener }) {
    try {
        return [
            { day: 1, channel: "Email", action: "Send the cold email opener.", referencesPrior: false, script: coldEmail && coldEmail.body },
            { day: 3, channel: "LinkedIn", action: `Send a LinkedIn connect note referencing the Day 1 email.`, referencesPrior: true, script: linkedin ? `${linkedin} (P.S. — following up on the note I sent ${first || "you"} by email a couple of days ago.)` : linkedin },
            { day: 5, channel: "Email", action: "Follow-up email referencing the original observation, add one more proof point.", referencesPrior: true, script: `Following up on my note about ${company || "your site"} — still think the gap I flagged is worth a 2-minute look. Happy to send the short breakdown if useful.` },
            { day: 8, channel: "Phone/WhatsApp", action: "Call or WhatsApp referencing both prior touches.", referencesPrior: true, script: callOpener ? `${callOpener} (Following up on the email and LinkedIn note from last week.)` : whatsapp },
        ];
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// 6.8 — evidence-strength-scaled "why now" copy
// ---------------------------------------------------------------------------

function scaleUrgencyCopy(evidenceStrength) {
    try {
        const strength = clamp(evidenceStrength, 0, 100);
        if (strength >= 70) return { intensity: "high", phrase: "This is worth acting on now — the signals are strong and timing-sensitive." };
        if (strength >= 40) return { intensity: "medium", phrase: "Worth a look soon — there's a real, if not urgent, opportunity here." };
        return { intensity: "low", phrase: "No rush, but worth keeping on the radar as a low-effort improvement." };
    } catch {
        return { intensity: "low", phrase: "Worth keeping on the radar." };
    }
}

// ---------------------------------------------------------------------------
// 6.9 — executive "Why This Lead / Why Now / Opening Line" summary block
// ---------------------------------------------------------------------------

function buildExecutiveWhyNow({ company, icpFitScore, intentScore, timingScore, topPain, offerName, openingLine }) {
    try {
        const fitPhrase = icpFitScore >= 70 ? "a strong ICP fit" : icpFitScore >= 40 ? "a reasonable ICP fit" : "a borderline ICP fit";
        const intentPhrase = intentScore >= 50 ? "clear buying-intent signals" : intentScore >= 20 ? "some buying-intent signals" : "limited buying-intent signals";
        const timingPhrase = timingScore >= 15 ? "favorable timing (funding/hiring/growth activity)" : "no strong timing catalyst";
        const painPhrase = topPain ? `The clearest pain point is: ${topPain}.` : "No single dominant pain point was identified.";

        const summary = `${company || "This company"} is ${fitPhrase} with ${intentPhrase} and ${timingPhrase}. ${painPhrase} The recommended opening move is ${offerName || "a tailored first offer"}.`;

        return { summary, openingLine: openingLine || `Hi — noticed ${topPain ? topPain.toLowerCase() : "something specific"} on ${company || "your site"} and wanted to share a quick idea.` };
    } catch {
        return { summary: "Why-now summary unavailable.", openingLine: "Hi — I had a quick idea for your team." };
    }
}

module.exports = {
    rankOffers,
    getSegmentOfferCopy,
    INDUSTRY_MESSAGE_LIBRARY,
    SEGMENT_MESSAGE_LIBRARY,
    checkOpenerSpecificity,
    gateMessagingConfidence,
    classifyRole,
    getRoleFraming,
    PAIN_BY_ROLE,
    generateSubjectLineVariants,
    buildObjectionScripts,
    inferCompanyProfile,
    buildTouchSequence,
    scaleUrgencyCopy,
    buildExecutiveWhyNow,
};
