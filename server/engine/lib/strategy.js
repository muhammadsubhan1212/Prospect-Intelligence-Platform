/**
 * Website analysis + sales-strategy decision engine + outreach generation.
 *
 * All decisions are derived from observable research signals + the lead record.
 * Nothing is invented: if a signal is unknown the logic stays neutral and the
 * report renders "Not enough public information." where appropriate.
 *
 * The intent is to reason like a senior sales consultant: find the single
 * highest-value gap, recommend ONE first offer, and justify it with evidence.
 */

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

// PHASE 1-6 additive layers. Every module degrades gracefully on its own; we
// also guard the requires themselves so a missing/broken new module can
// never take down the whole strategy engine (STRICT RULE #2).
let U = {};
let ScoringL = {};
let ApolloL = {};
let TechL = {};
let ConfidenceL = {};
let MessagingL = {};
let DedupeL = {};
try { U = require("./utils"); } catch { /* keep {} */ }
try { ScoringL = require("./scoring"); } catch { /* keep {} */ }
try { ApolloL = require("./apolloIntel"); } catch { /* keep {} */ }
try { TechL = require("./techIntel"); } catch { /* keep {} */ }
try { ConfidenceL = require("./confidenceModel"); } catch { /* keep {} */ }
try { MessagingL = require("./messagingV2"); } catch { /* keep {} */ }
try { DedupeL = require("./dedupe"); } catch { /* keep {} */ }

function firstNameOf(lead) {
    if (lead.firstName) return lead.firstName;
    if (lead.fullName) return lead.fullName.split(/\s+/)[0];
    return "there";
}

function parseTeamSize(v) {
    if (!v) return null;
    const m = String(v).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

function joinList(arr, fallback = "Not enough public information.") {
    return arr && arr.length ? arr.join(", ") : fallback;
}

function lc(s) {
    return String(s || "").toLowerCase();
}

// Light formatters so raw Apollo values (e.g. "3.0", "610000.0", ISO dates)
// render as clean facts rather than machine values.
function formatInt(v) {
    if (v === undefined || v === null || v === "") return "";
    const n = Number(String(v).replace(/[^0-9.]/g, ""));
    if (!isFinite(n) || n === 0) return String(v).trim();
    return Math.round(n).toLocaleString("en-US");
}

function formatMoney(v) {
    if (v === undefined || v === null || v === "") return "";
    const raw = String(v).trim();
    if (/[a-zA-Z]/.test(raw) && !/^\$?[\d.,\s]+$/.test(raw)) return raw; // already descriptive
    const n = Number(raw.replace(/[^0-9.]/g, ""));
    if (!isFinite(n) || n === 0) return raw;
    return "$" + Math.round(n).toLocaleString("en-US");
}

function formatDate(v) {
    if (!v) return "";
    const s = String(v).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[parseInt(iso[2], 10) - 1]} ${iso[1]}`;
    }
    return s;
}

function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function buildWhoTheyAre(company, lead, research, nf) {
    const f = research.facts || {};
    if (f.description && f.description.length > 40) {
        let d = f.description.trim();
        if (d.length > 320) d = d.slice(0, 317).replace(/\s+\S*$/, "") + "...";
        const founded = f.foundedYear ? ` Founded ${f.foundedYear}.` : "";
        return `${d}${founded}`;
    }
    const parts = [];
    parts.push(`${company}${lead.industry ? ", " + lead.industry.toLowerCase() : ""}${lead.city ? ", based in " + lead.city : ""}.`);
    if (f.valueProp && f.valueProp.length > 8) parts.push(`Positioning: "${f.valueProp}".`);
    if (f.foundedYear) parts.push(`Founded ${f.foundedYear}.`);
    const joined = parts.join(" ");
    return joined || nf;
}

const LEAD_SOURCE = { where: "Lead data record (imported CSV/Apollo export)", url: "" };

function buildCompanyOverview(company, lead, research, analysis, strat, nf) {
    const S = research.facts.sources || {};
    const areaServed = research.facts.areaServed && research.facts.areaServed.length ? research.facts.areaServed.join(", ") : "";

    // Each field is a [value, source] pair so the report can cite where to verify it.
    const whoTheyAre = buildWhoTheyAre(company, lead, research, nf);

    let sell, sellSrc;
    if (research.facts.services && research.facts.services.length) {
        sell = research.facts.services.join(", ");
        sellSrc = S.services || null;
    } else if (lead.keywords && lead.keywords.length) {
        sell = lead.keywords.slice(0, 5).join(", ");
        sellSrc = LEAD_SOURCE;
    } else {
        sell = nf;
        sellSrc = null;
    }

    let serve, serveSrc;
    if (research.facts.audience) {
        serve = research.facts.audience;
        serveSrc = S.audience || null;
    } else if (areaServed) {
        serve = areaServed;
        serveSrc = S.audience || null;
    } else if (strat.cls.local || strat.cls.serviceBiz) {
        serve = strat.cls.local ? "Primarily local / regional customers." : "Business / service customers (inferred).";
        serveSrc = { where: "Inferred from industry + detected business model", url: research.website || "" };
    } else {
        serve = nf;
        serveSrc = null;
    }

    const money = (research.facts.businessModel && research.facts.businessModel.monetisation) || nf;
    const moneySrc = money !== nf ? S.businessModel || { where: "Inferred from on-site signals", url: research.website || "" } : null;

    let ideal, idealSrc;
    if (research.facts.audience || areaServed) {
        ideal = research.facts.audience || areaServed;
        idealSrc = S.audience || null;
    } else if (lead.keywords && lead.keywords.length) {
        ideal = "Buyers seeking: " + lead.keywords.slice(0, 4).join(", ") + ".";
        idealSrc = LEAD_SOURCE;
    } else {
        ideal = nf;
        idealSrc = null;
    }

    const maturity = buildDigitalMaturity(analysis, research);
    const maturitySrc = analysis.reachable ? S.technologies || { where: "Detected in page source & HTTP headers", url: research.website || "" } : null;

    return {
        whoTheyAre,
        whatTheySell: sell,
        whoTheyServe: serve,
        howTheyMakeMoney: money,
        idealCustomers: ideal,
        digitalMaturity: maturity,
        sources: {
            whoTheyAre: whoTheyAre !== nf ? S.description || S.valueProp || S.foundedYear || { where: "Lead record + homepage", url: research.website || "" } : null,
            whatTheySell: sell !== nf ? sellSrc : null,
            whoTheyServe: serve !== nf ? serveSrc : null,
            howTheyMakeMoney: moneySrc,
            idealCustomers: ideal !== nf ? idealSrc : null,
            digitalMaturity: maturitySrc,
        },
        paragraphs: [],
    };
}

function buildDigitalMaturity(analysis, research) {
    const tier = analysis.overallScore >= 70 ? "Reasonable" : analysis.overallScore >= 45 ? "Moderate" : "Low";
    const stack = (research.tech.stack || []).slice(0, 4).join(", ") || "standard";
    const bits = [
        `${tier} — built on ${stack}`,
        research.tech.chat.length ? `chat (${research.tech.chat[0]})` : "no live chat",
        research.tech.booking.length ? `booking (${research.tech.booking[0]})` : "no online booking",
    ];
    if (research.facts.rating) bits.push(`rated ${research.facts.rating.value}${research.facts.rating.count ? " (" + research.facts.rating.count + " reviews)" : ""}`);
    return bits.join("; ") + ".";
}

// ---------------------------------------------------------------------------
// industry classification
// ---------------------------------------------------------------------------

function classifyBusiness(lead, research) {
    // Combine structured fields with the detected business model + audience.
    const hay = [
        lead.industry,
        (lead.keywords || []).join(" "),
        (research.facts.services || []).join(" "),
        research.facts.audience,
        research.facts.description,
    ]
        .join(" ")
        .toLowerCase();

    const model = (research.facts.businessModel && research.facts.businessModel.type) || "business";

    const appointment = /\b(dentist|dental|clinic|medical|healthcare|therapy|therapist|salon|spa|beauty|fitness|gym|wellness|law firm|attorney|lawyer|real estate|realtor|realty|automotive|chiropract\w*|veterinar\w*|aesthetic|cosmetic|barber|tattoo|massage|physio\w*|orthodont\w*|dermatolog\w*|optometr\w*)\b/i.test(
        hay
    );
    const local =
        model === "local" ||
        /\b(restaurant|retail store|hospitality|home services|plumbing|plumber|hvac|roofing|roofer|contractor|construction|landscap\w+|cleaning service|dealership|automotive|hotel|cafe|coffee shop|bakery|florist|catering)\b/i.test(
            hay
        );
    const ecommerce = model === "ecommerce";
    const saas = model === "saas";
    const serviceBiz =
        appointment ||
        local ||
        model === "services" ||
        saas ||
        /\b(services|agenc\w+|consult\w*|marketing|software|it services|solutions|b2b|saas|technology|platform)\b/i.test(hay);

    return { appointment, local, ecommerce, saas, serviceBiz, model, hay };
}

// ---------------------------------------------------------------------------
// website analysis (practical, short)
// ---------------------------------------------------------------------------

function analyzeWebsite(research) {
    const s = research.signals || {};
    const tech = research.tech || { stack: [], chat: [], booking: [] };
    const sections = [];
    const push = (name, score, note) => sections.push([name, clamp(score, 0, 10), note]);

    if (!research.reachable) {
        return {
            sections: [["Website reachability", 0, "The website could not be loaded during research."]],
            overallScore: 0,
            summary: research.notes.join(" ") || "The website could not be analysed automatically.",
            reachable: false,
        };
    }

    // Mobile responsiveness
    push("Mobile responsiveness", s.viewportMeta ? 8 : 3, s.viewportMeta ? "Responsive viewport is configured." : "No responsive viewport tag detected.");

    // Desktop experience
    push("Desktop experience", 7, "Loads and renders on desktop.");

    // Design quality (heuristic from stack + content depth)
    const modern = tech.stack.some((t) => /Webflow|Next\.js|React|Squarespace|Shopify|Vue/.test(t));
    const dated = tech.stack.some((t) => /Wix|jQuery|Elementor/.test(t)) && !modern;
    let design = 6;
    if (modern) design += 2;
    if (dated) design -= 2;
    if (s.wordCount && s.wordCount < 120) design -= 1;
    push("Design quality", design, modern ? "Built on a modern stack." : dated ? "Appears to use a dated/basic builder." : "Standard, functional design.");

    // Loading speed (basic)
    const ms = s.homepageMs || 0;
    let speed = 8;
    if (ms > 1500) speed = 6;
    if (ms > 3000) speed = 4;
    if (ms > 6000) speed = 2;
    push("Loading speed (basic)", speed, `Homepage responded in ~${ms} ms.`);

    // Navigation
    const nav = s.navLinkCount || 0;
    push("Navigation", nav >= 6 ? 8 : nav >= 3 ? 6 : 4, `${nav} internal links detected in navigation.`);

    // CTA quality
    const cta = s.ctaMatches || 0;
    push("CTA quality", cta >= 3 ? 8 : cta >= 1 ? 5 : 2, cta ? `${cta} action-oriented CTA phrase(s) found.` : "No clear call-to-action detected.");

    // Contact form
    push("Contact form", s.hasForm ? 8 : 3, s.hasForm ? "A form is present on the site." : "No web form detected — contact appears manual.");

    // Chat widget
    push("Chat widget", tech.chat.length ? 8 : 2, tech.chat.length ? `Live chat detected (${tech.chat.join(", ")}).` : "No live-chat / instant-response widget found.");

    // Lead capture
    const capture = (s.hasForm ? 1 : 0) + (s.newsletter ? 1 : 0) + (s.popup ? 1 : 0);
    push("Lead capture", capture >= 2 ? 8 : capture === 1 ? 5 : 2, capture ? "Some capture mechanism present." : "No newsletter, popup or capture funnel detected.");

    // Booking system
    push("Booking system", tech.booking.length ? 9 : 3, tech.booking.length ? `Online booking detected (${tech.booking.join(", ")}).` : "No online booking/scheduling detected.");

    // Trust elements
    const trust = (s.https ? 1 : 0) + (s.clientLogos ? 1 : 0) + (s.testimonials ? 1 : 0);
    push("Trust elements", trust >= 2 ? 8 : trust === 1 ? 5 : 3, `${s.https ? "HTTPS" : "no HTTPS"}${s.clientLogos ? ", client logos" : ""}${s.testimonials ? ", testimonials" : ""}.`);

    // Testimonials
    push("Testimonials", s.testimonials ? 8 : 3, s.testimonials ? "Testimonials/case content present." : "No testimonials found.");

    // Reviews
    push("Reviews integration", s.reviews ? 8 : 3, s.reviews ? "Review/ratings signals present." : "No third-party review integration found.");

    const avg = sections.reduce((a, [, sc]) => a + sc, 0) / sections.length;
    const overallScore = clamp(avg * 10, 0, 100);

    // short, practical summary
    const gaps = [];
    if (!tech.chat.length) gaps.push("no instant-response chat");
    if (!s.hasForm) gaps.push("no contact form");
    if ((s.ctaMatches || 0) < 1) gaps.push("weak CTAs");
    if (!tech.booking.length) gaps.push("no online booking");
    if (!s.testimonials && !s.reviews) gaps.push("limited social proof");
    const summary = gaps.length
        ? `Solid baseline, but the commercial layer is thin: ${gaps.slice(0, 3).join(", ")}. These are the fastest wins.`
        : "The site covers the commercial basics; focus opportunities on optimisation and automation rather than fixes.";

    return { sections, overallScore, summary, reachable: true };
}

// ---------------------------------------------------------------------------
// strategy decision engine
// ---------------------------------------------------------------------------

function decideStrategy(lead, research, analysis, opts = {}) {
    const s = research.signals || {};
    const tech = research.tech || { stack: [], chat: [], booking: [] };
    const cls = classifyBusiness(lead, research);
    const team = parseTeamSize(lead.employees);
    const smallTeam = team !== null ? team <= 12 : true; // default assume lean unless stated
    const midTeam = team !== null && team > 12 && team <= 200;

    // PHASE 1-6 — audit-trail logger. Every additive rule that fires below
    // pushes an entry here so the final report stays auditable (STRICT RULE #6).
    const ruleLog = U.createRuleLog ? U.createRuleLog() : { fire() {}, all() { return []; } };

    const gaps = {
        chat: tech.chat.length === 0,
        capture: !s.hasForm && !s.newsletter,
        cta: (s.ctaMatches || 0) < 2,
        booking: tech.booking.length === 0,
        design: analysis.sections.find(([n]) => n === "Design quality")?.[1] < 6,
        responsive: !s.viewportMeta,
        socialProof: !s.testimonials && !s.reviews,
        reviews: !s.reviews,
    };

    // Candidate offers with evidence-weighted scores
    const candidates = [];
    const add = (id, name, score, evidence) => candidates.push({ id, name, score, evidence });

    add(
        "ai_chatbot",
        "AI Chatbot & Lead-Qualification Assistant",
        (gaps.chat ? 3 : 0) + (cls.serviceBiz ? 2 : 0) + (gaps.capture ? 1 : 0) + (smallTeam ? 1 : 0),
        gaps.chat ? "no live chat, so website visitors must email and wait" : "chat present but qualification can be automated"
    );
    add(
        "landing_cro",
        "Landing Page & Conversion Optimisation",
        (gaps.cta ? 3 : 0) + (gaps.capture ? 2 : 0),
        gaps.cta ? "weak or missing calls-to-action" : "conversion path can be tightened"
    );
    add(
        "website_redesign",
        "Website Redesign",
        (gaps.design ? 3 : 0) + (gaps.responsive ? 2 : 0),
        gaps.responsive ? "the site is not mobile-responsive" : "the design/stack looks dated"
    );
    add(
        "appointment_booking",
        "AI Appointment Booking",
        gaps.booking ? (cls.appointment ? 4 : 1) : 0,
        "no online booking on an appointment-driven business"
    );
    add(
        "review_automation",
        "Review-Generation Automation",
        gaps.reviews ? (cls.local ? 3 : 1) : 0,
        "no review engine for a business that lives on local reputation"
    );
    add(
        "followup_automation",
        "Automated Lead Follow-up",
        (smallTeam ? 2 : 0) + (gaps.capture ? 1 : 0) + (gaps.chat ? 1 : 0),
        "a lean team cannot follow up on every enquiry consistently"
    );
    add(
        "crm_automation",
        "CRM & Pipeline Automation",
        (midTeam ? 2 : 0) + (cls.serviceBiz ? 1 : 0),
        "manual pipeline tracking becomes the bottleneck as the team grows"
    );
    add(
        "whatsapp_automation",
        "WhatsApp Automation",
        (lead.phone ? 1 : 0) + (gaps.chat ? 1 : 0) + (smallTeam ? 1 : 0),
        "a direct phone line exists but there is no fast, trackable messaging channel"
    );
    // Model-specific offers
    add(
        "ecom_email_automation",
        "Email & Cart-Recovery Automation",
        cls.ecommerce ? 4 : 0,
        "an online store with no visible cart-recovery / lifecycle email flow"
    );
    add(
        "saas_demo_booking",
        "Demo Booking + Lead-Qualification Assistant",
        cls.saas ? (gaps.booking ? 4 : 2) + (gaps.chat ? 1 : 0) : 0,
        "a SaaS with no frictionless demo-booking + qualification path"
    );

    // ---------------------------------------------------------------------
    // PHASE 4/5 — additive score boosts, applied BEFORE ranking so offer
    // selection reflects Apollo firmographics + detected tech gaps. Every
    // boost is logged for auditability (STRICT RULE #6) and is a pure
    // addition on top of the base `score` computed above (STRICT RULE #3).
    // ---------------------------------------------------------------------
    let tier = "small";
    let tierModifiers = {};
    let deptBoosts = { boosts: {}, reasons: [] };
    let apolloConfidenceBoost = { points: 0, reasons: [], fundingWindowBoost: false };
    let techGapInsights = [];
    let offerSuppression = {};
    let socialProofBoost = null;
    try {
        tier = ApolloL.classifyTier ? ApolloL.classifyTier(lead, research) : "small";
        tierModifiers = ApolloL.getTierModifiers ? ApolloL.getTierModifiers(tier) : {};
        deptBoosts = ApolloL.computeDepartmentOfferBoosts ? ApolloL.computeDepartmentOfferBoosts(lead, ruleLog) : { boosts: {}, reasons: [] };
        apolloConfidenceBoost = ApolloL.computeApolloConfidenceBoosts ? ApolloL.computeApolloConfidenceBoosts(lead, ruleLog) : { points: 0, reasons: [], fundingWindowBoost: false };
        techGapInsights = research.techGapInsights || [];
        offerSuppression = research.offerSuppression || {};
        socialProofBoost = research.facts && research.facts.socialProofInsights && research.facts.socialProofInsights.boost;

        for (const c of candidates) {
            const tierDelta = tierModifiers[c.id] || 0;
            if (tierDelta) {
                c.score += tierDelta;
                ruleLog.fire("tierModifier", tierDelta, `${tier} tier modifier applied to ${c.id}`);
            }
            const deptDelta = deptBoosts.boosts[c.id] || 0;
            if (deptDelta) c.score += deptDelta;
            for (const insight of techGapInsights) {
                if (insight.boost === c.id) {
                    c.score += insight.score;
                    ruleLog.fire("techGapInsight", insight.score, `${insight.insight} -> ${c.id}`);
                }
            }
            if (socialProofBoost && socialProofBoost.offerId === c.id) {
                c.score += socialProofBoost.score;
                ruleLog.fire("socialProofBoost", socialProofBoost.score, `Rating-based boost applied to ${c.id}`);
            }
        }
    } catch {
        /* boosts are best-effort; base `score` values remain valid even if this block fails */
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const runnerUp = candidates.find((c) => c.id !== best.id && c.score > 0) || candidates[1];

    const companyShort = lead.company || "the company";
    const topService = (research.facts.services || [])[0] || (lead.keywords || [])[0] || null;

    // Offer copy
    const OFFER_COPY = {
        ai_chatbot: {
            outcome: "capture and qualify every website visitor 24/7, then hand warm leads straight to the team",
            valueProps: [
                "Respond to enquiries instantly, even after hours — no more lost leads waiting on email",
                "Auto-qualify visitors so the team only spends time on serious prospects",
                "Runs without adding headcount",
            ],
            pain: `${companyShort} has no instant-response path on the site, so interested visitors have to email and wait.`,
        },
        landing_cro: {
            outcome: "turn more of the existing website traffic into booked conversations",
            valueProps: [
                "A focused page with one clear action lifts enquiry rates from the same traffic",
                "Stronger CTAs and capture mean fewer visitors leave without a trace",
                "Measurable: you can see conversion move week over week",
            ],
            pain: `${companyShort}'s site has weak calls-to-action, so traffic isn't converting into enquiries.`,
        },
        website_redesign: {
            outcome: "a modern, fast, mobile-first site that builds trust and converts",
            valueProps: [
                "A credible, modern site removes doubt for higher-value buyers",
                "Mobile-first design captures the majority of today's traffic",
                "Built around conversion, not just looks",
            ],
            pain: `${companyShort}'s current site undercuts credibility and conversion (${gaps.responsive ? "not mobile-responsive" : "dated design"}).`,
        },
        appointment_booking: {
            outcome: "let clients book themselves in automatically, filling the calendar without phone tag",
            valueProps: [
                "24/7 self-service booking removes friction for clients",
                "Fewer no-shows with automated reminders",
                "Frees staff from manual scheduling",
            ],
            pain: `${companyShort} relies on manual scheduling — there's no online booking despite being appointment-driven.`,
        },
        review_automation: {
            outcome: "systematically grow 5-star reviews to win more local trust and search visibility",
            valueProps: [
                "Automated review requests after every job — no chasing",
                "More reviews lift local ranking and conversion",
                "Protects reputation by catching unhappy customers first",
            ],
            pain: `${companyShort} has no system to generate reviews, leaving local reputation to chance.`,
        },
        followup_automation: {
            outcome: "ensure every lead is followed up automatically so none goes cold",
            valueProps: [
                "Instant + scheduled follow-up on every enquiry, hands-free",
                "Recovers deals that would otherwise be forgotten",
                "Gives a small team the consistency of a large sales operation",
            ],
            pain: `A lean team at ${companyShort} can't reliably follow up on every lead, so enquiries slip.`,
        },
        crm_automation: {
            outcome: "get every lead and deal tracked automatically in one pipeline",
            valueProps: [
                "No more leads lost in inboxes and spreadsheets",
                "Clear pipeline visibility and forecasting",
                "Automations handle the admin so the team sells",
            ],
            pain: `${companyShort} likely tracks deals manually, which breaks down as volume grows.`,
        },
        whatsapp_automation: {
            outcome: "engage and qualify leads instantly on the channel they actually reply to",
            valueProps: [
                "Instant WhatsApp replies and qualification, automated",
                "Higher open and response rates than email",
                "Every conversation logged and trackable",
            ],
            pain: `${companyShort} has a phone line but no fast, trackable messaging channel for leads.`,
        },
        ecom_email_automation: {
            outcome: "recover abandoned carts and grow repeat revenue on autopilot",
            valueProps: [
                "Automated cart-recovery flows win back sales that would otherwise be lost",
                "Welcome, post-purchase and win-back emails lift lifetime value",
                "Runs 24/7 with no extra staff time",
            ],
            pain: `${companyShort} runs an online store but has no visible automated email/cart-recovery flow, so abandoned carts and repeat sales leak.`,
        },
        saas_demo_booking: {
            outcome: "turn more site visitors into booked, qualified demos",
            valueProps: [
                "Frictionless self-serve demo booking captures intent instantly",
                "AI pre-qualifies so sales only talks to fit prospects",
                "Faster speed-to-lead lifts trial and demo conversion",
            ],
            pain: `${companyShort} makes visitors hunt for a way to talk to sales — no frictionless demo-booking + qualification path.`,
        },
    };

    const copy = OFFER_COPY[best.id] || OFFER_COPY.ai_chatbot;

    // Buying intent scores
    const buyingIntent = [
        ["AI Chatbot", clamp(40 + (gaps.chat ? 25 : 0) + (cls.serviceBiz ? 10 : 0) + (smallTeam ? 5 : 0), 0, 95)],
        ["Lead Automation", clamp(40 + (gaps.capture ? 20 : 0) + (smallTeam ? 10 : 0), 0, 95)],
        ["Conversion Optimization", clamp(35 + (gaps.cta ? 20 : 0) + (gaps.capture ? 10 : 0), 0, 95)],
        ["AI Automation", clamp(35 + (smallTeam ? 10 : 0) + (gaps.chat ? 10 : 0), 0, 95)],
        ["Landing Pages", clamp(30 + (gaps.cta ? 15 : 0) + (gaps.capture ? 10 : 0), 0, 95)],
        ["Website Redesign", clamp(30 + (gaps.design ? 25 : 0) + (gaps.responsive ? 10 : 0), 0, 95)],
        ["CRM Automation", clamp(30 + (midTeam ? 15 : 0), 0, 95)],
        ["Website Maintenance", clamp(25 + (gaps.design ? 10 : 0), 0, 95)],
        ["Monthly Retainer", clamp(30 + (smallTeam ? 10 : 0), 0, 95)],
    ];

    // AI automation suggestions (fitted, not random)
    const automations = [];
    const pushAuto = (name, why, priority) => automations.push({ name, why, priority });
    if (gaps.chat) pushAuto("AI website chatbot + lead qualification", copy.pain, "High");
    if (smallTeam || gaps.capture) pushAuto("Automated lead follow-up sequences", "A lean team can't chase every enquiry; automation keeps every lead warm.", gaps.capture ? "High" : "Medium");
    if (cls.appointment && gaps.booking) pushAuto("AI appointment booking + reminders", "Appointment-driven business with no self-service scheduling.", "High");
    if (cls.local && gaps.reviews) pushAuto("Automated review requests", "Local reputation is a growth lever with no system behind it.", "Medium");
    if (midTeam) pushAuto("CRM + pipeline automation", "Team size makes manual tracking the bottleneck.", "Medium");
    if (!automations.length) pushAuto("Lead capture + instant response", "Ensure inbound interest is captured and answered automatically.", "Medium");

    // Communication channels (rank by what we actually have)
    const channels = [];
    let rank = 1;
    if (lead.email) channels.push(["Email", rank++, "Verified/available email; low-friction, respectful first touch for a value-first offer."]);
    if (lead.linkedin) channels.push(["LinkedIn", rank++, "Profile available; strong for a warm, credibility-led connection."]);
    if (lead.phone) channels.push(["Phone", rank++, "Direct line available; high-impact once the lead is warm."]);
    if (lead.phone) channels.push(["WhatsApp", rank++, "Use only after initial contact; high reply rates."]);
    channels.push(["Video / Loom", rank++, "Best as a follow-up: a 60–90s walkthrough of the findings converts well."]);

    // Confidence score
    let confidence = 0;
    if (research.reachable) confidence += 25;
    confidence += Math.min(15, Object.keys(research.pages || {}).length * 4);
    if (lead.email) confidence += 15;
    if (lead.phone) confidence += 10;
    if (lead.linkedin) confidence += 10;
    if (lead.fullName && lead.title) confidence += 10;
    if (lead.industry) confidence += 5;
    if (best.score >= 3) confidence += 10;
    confidence = clamp(confidence, 0, 95);

    // Priority + verdict
    let priority = "Medium";
    let verdict = "MAYBE";
    if (confidence >= 68 && best.score >= 3) {
        priority = "High";
        verdict = "YES";
    } else if (confidence < 45 || best.score === 0) {
        priority = "Low";
        verdict = research.reachable ? "MAYBE" : "MAYBE";
    } else {
        priority = "Medium";
        verdict = "YES";
    }

    const bestChannel = channels[0] ? channels[0][0] : "Email";
    const nextStep = `Send the ${bestChannel.toLowerCase()} opener leading with a free ${
        best.name.includes("Redesign") ? "site" : "lead-capture"
    } observation, then offer the ${best.name}.`;

    // Apply the Apollo funding-window confidence boost (4.1) — additive, and
    // can only ever RAISE priority to High when confidenceV2 crosses the
    // threshold, never lower the original `confidence`/`priority` values.
    if (apolloConfidenceBoost.fundingWindowBoost) {
        ruleLog.fire("apollo.fundingWindowPriorityGate", 0, "Recent funding window checked against confidenceV2>=60 gate for priority upgrade");
    }

    // -----------------------------------------------------------------------
    // PHASE 1.3 / 2 / 3 / 4 / 5 — decomposed confidence model, signal
    // pass-through, fit/pain/priority scoring, tiering, channel re-ranking,
    // and LinkedIn cross-validation. Everything below is a NEW field on the
    // returned object — none of the fields above are touched.
    // -----------------------------------------------------------------------
    const icpProfile = opts.icpProfile;
    let icpFit = { icpFitScore: 50, notes: [], profile: {} };
    let painModel = research.painModel || { signals: [], painScore: 0, industryKey: null };
    let revenueEfficiency = { revPerEmployee: null, tier: "unknown", note: "" };
    let dealSize = { bucket: "unknown", multiplier: 1, effectiveTeam: null };
    let priorityModel = { priorityScore: 0, priorityTier: "Low", painHigh: false, intentHigh: false };
    let nurture = false;
    let confidenceModel = { confidenceV2: confidence, subScores: { dataCompleteness: 0, contactability: 0, signalStrength: 0, offerStrength: 0 } };
    let channelsV2 = { channelsV2: channels, note: "" };
    let linkedinValidation = { status: "unknown", mismatch: false, note: "" };
    const intentScore = (research.intentSignals && research.intentSignals.intentScore) || 0;
    const timingScore = (research.timingSignals && research.timingSignals.timingScore) || 0;

    try {
        if (ScoringL.computeIcpFitScore) icpFit = ScoringL.computeIcpFitScore(lead, research, icpProfile);
        if (ScoringL.computeRevenuePerEmployeeEfficiency) revenueEfficiency = ScoringL.computeRevenuePerEmployeeEfficiency(lead);
        if (ScoringL.computeDealSizeWeight) dealSize = ScoringL.computeDealSizeWeight(lead, research);
        if (ScoringL.computeMultiplicativePriority) priorityModel = ScoringL.computeMultiplicativePriority(painModel.painScore, intentScore, dealSize.multiplier);
        if (ScoringL.shouldNurture) nurture = ScoringL.shouldNurture(icpFit.icpFitScore, intentScore);
        if (ConfidenceL.calculateConfidence) confidenceModel = ConfidenceL.calculateConfidence(lead, research, analysis, best, gaps, timingScore, ruleLog);
        if (ApolloL.computeChannelStrategy) channelsV2 = ApolloL.computeChannelStrategy(lead, channels);
        if (ApolloL.crossValidateLinkedInHeuristic) linkedinValidation = ApolloL.crossValidateLinkedInHeuristic(lead);

        // Apollo revenue/funding boost feeds into confidenceV2 too (4.1).
        confidenceModel.confidenceV2 = clamp(confidenceModel.confidenceV2 + apolloConfidenceBoost.points, 0, 95);
    } catch {
        /* every sub-field above already has a safe default */
    }

    // 4.1 — funding-window boost can upgrade (never downgrade) priority.
    let priorityV2 = priority;
    if (apolloConfidenceBoost.fundingWindowBoost && confidenceModel.confidenceV2 >= 60) priorityV2 = "High";

    // 3.5/3.6 — true priority = pain × intent, gated by NURTURE/DISQUALIFIED.
    // verdictV2/priorityV2 are NEW fields — `verdict`/`priority` above are
    // untouched so existing consumers see no change in shape or value.
    if (priorityModel.priorityTier === "High") priorityV2 = priorityV2 === "Low" ? "Medium" : priorityV2;
    if (priorityModel.priorityTier === "Low" && !priorityModel.intentHigh && !priorityModel.painHigh) priorityV2 = priority === "High" ? "Medium" : priority;

    let verdictV2 = verdict;
    const disqualification = research.disqualification || { disqualified: false, reasons: [] };
    if (disqualification.disqualified) {
        verdictV2 = "DISQUALIFIED";
        priorityV2 = "Low";
    } else if (nurture) {
        verdictV2 = "NURTURE";
    } else {
        const urgencySignals = research.urgencySignals || [];
        if (urgencySignals.some((u) => u.urgency === "very-high")) {
            verdictV2 = "YES";
            priorityV2 = "High";
            confidenceModel.confidenceV2 = clamp(confidenceModel.confidenceV2 + 15, 0, 95);
            ruleLog.fire("urgency.veryHigh", 15, "Very-high urgency signal detected — verdict forced to YES/High");
        }
    }

    return {
        cls,
        team,
        smallTeam,
        midTeam,
        gaps,
        best,
        runnerUp,
        copy,
        topService,
        buyingIntent,
        automations,
        channels,
        confidence,
        priority,
        verdict,
        bestChannel,
        nextStep,
        // ---- PHASE 1-6 additive fields (new; existing fields above are unchanged) ----
        candidates,
        tier,
        tierModifiers,
        deptBoosts,
        apolloConfidenceBoost,
        techGapInsights,
        offerSuppression,
        icpFit,
        painModel,
        revenueEfficiency,
        dealSize,
        priorityModel,
        nurture,
        disqualification,
        confidenceModel,
        channelsV2,
        linkedinValidation,
        intentSignals: research.intentSignals || { signals: [], intentScore: 0 },
        timingSignals: research.timingSignals || { signals: [], timingScore: 0 },
        urgencySignals: research.urgencySignals || [],
        freshness: research.freshness || { freshnessScore: 50, stale: false, fresh: false, offerGate: "neutral" },
        trustGeoSignals: research.trustGeoSignals || {},
        priorityV2,
        verdictV2,
        ruleLog: ruleLog.all ? ruleLog.all() : [],
    };
}

// ---------------------------------------------------------------------------
// outreach messages + icebreakers
// ---------------------------------------------------------------------------

function generateMessages(lead, research, analysis, strat) {
    const first = firstNameOf(lead);
    const company = lead.company || "your company";
    const copy = strat.copy;
    const offer = strat.best.name;
    const gapPhrase = strat.best.evidence;
    const service = strat.topService;
    const outcome = copy.outcome;

    const observation = strat.gaps.chat
        ? "there's no instant way for a visitor to get an answer — they have to email and wait"
        : strat.gaps.cta
        ? "the site doesn't push visitors toward one clear next step"
        : strat.gaps.booking
        ? "clients can't book themselves in online"
        : "there's a quick win to convert more of your existing traffic";

    const whatsapp = `Hi ${first} — came across ${company}${service ? ` and your work on ${service}` : ""}. Quick observation: ${observation}. I put together a short, no-strings idea to fix that and ${outcome}. Want me to send it over?`;

    const coldEmail = {
        subjectLines: [
            `Quick note on ${research.website ? new URL(research.website).host.replace(/^www\./, "") : company}`,
            `${company} — a small fix worth more leads`,
            `${first}, a 2-minute observation on your site`,
            `Turning your traffic into booked conversations`,
        ],
        body: `Hi ${first},\n\nI was looking at ${company}${service ? ` and your ${service} offering` : ""} and one thing stood out: ${observation}.\n\nFor a team your size that usually means real enquiries slip through. I put together a short, specific idea to ${outcome} — no pitch attached, it's useful either way.\n\nWorth me sending it over?\n\nBest,\n[Your Name]`,
        note: "Lead with the specific observation, not a service list. Sell the outcome (more booked conversations), never the technology.",
    };

    const linkedin = `Hi ${first} — genuinely liked what ${company} is doing${service ? ` around ${service}` : ""}. I help teams like yours ${outcome}, and I spotted one clear, fixable gap on your site. Happy to share a short breakdown — no pitch. Open to connecting?`;

    const callOpener = `Hi ${first}, this is [Your Name] — I'll be quick. I looked at ${company}'s site and noticed ${observation}. I've got a specific, no-cost idea to fix it and ${outcome}. Is now a bad time for two minutes?`;

    // Icebreakers — each must reference a real observation; skip if unknown
    const ice = [];
    if (strat.gaps.chat) ice.push(`Noticed ${company}'s site has no live chat — visitors have to email and wait for a reply.`);
    if (service) ice.push(`Saw that you focus on ${service}${(research.facts.services || [])[1] ? ` and ${research.facts.services[1]}` : ""} — clear positioning.`);
    if (lead.city || lead.industry) ice.push(`Running ${lead.industry ? lead.industry.toLowerCase() : "a business"}${lead.city ? ` out of ${lead.city}` : ""} — I follow that space closely.`);
    if (research.tech.stack && research.tech.stack.length) ice.push(`Noticed your site runs on ${research.tech.stack[0]} — solid choice, and easy to build capture on top of.`);
    if (research.facts.description) ice.push(`Your site line "${research.facts.description.slice(0, 80)}${research.facts.description.length > 80 ? "…" : ""}" makes the value clear.`);
    if (strat.gaps.booking && strat.cls.appointment) ice.push(`For an appointment-based business, I noticed there's no online booking on the site yet.`);
    if (lead.totalFunding) ice.push(`Congrats on the ${lead.totalFunding} raised — that's real conviction behind ${company}.`);
    if (!research.reachable) ice.push(`Couldn't load ${company}'s site cleanly on my end — worth checking it's fast for buyers too.`);

    // Fallbacks to always reach 5, still specific to provided data
    const fallbacks = [
        lead.industry ? `The ${lead.industry.toLowerCase()} space is moving fast on automation — feels timely for ${company}.` : `${company} looks well-positioned to convert more of its inbound interest.`,
        service ? `Your ${service} work stood out while researching ${company}.` : `Your positioning stood out while researching ${company}.`,
        `As ${lead.title || "the founder"}, you're probably the one feeling the manual follow-up load most.`,
    ];
    let fi = 0;
    while (ice.length < 5 && fi < fallbacks.length) ice.push(fallbacks[fi++]);

    // Objection handling
    const objectionHandling = [
        ["We're too busy right now.", "That's the point — this runs without your team's time once it's set up, so you stop losing leads while you're heads-down. I can send the 2-minute version to review when you're ready."],
        ["We don't have budget for marketing.", "This isn't a marketing spend — it plugs a leak in enquiries you already get. One recovered deal pays for it many times over. Want me to show the specific gap first, for free?"],
        ["We already get leads from referrals.", "Makes sense — this just makes sure the inbound interest you also get doesn't get wasted alongside those referrals. It complements what already works."],
        ["Send me some info.", "Happy to — I'll send a short, specific breakdown of the one gap I found, not a generic deck. If it's useful we talk; if not, no harm done."],
    ];

    // -----------------------------------------------------------------------
    // PHASE 6 — ranked multi-offer output, segment/industry copy, mandatory
    // specificity rule, seniority-adapted tone, subject-line variants,
    // dynamic objections, multi-touch sequencing, evidence-scaled urgency,
    // and the executive why-now block. All ADDITIVE new fields on the
    // returned object — whatsapp/coldEmail/linkedin/callOpener/icebreakers/
    // objectionHandling above are entirely unchanged.
    // -----------------------------------------------------------------------
    let rankedOffers = [];
    let role = { level: "individual", function: "general", key: "individual-general" };
    let roleFraming = { focus: gapPhrase, care: "growth", cta: "worth me sending it over?" };
    let segmentCopy = null;
    let specificity = { specific: false };
    let messagingConfidence = { messagingConfidence: strat.confidence, downgraded: false, note: "" };
    let subjectLineVariants = [];
    let objectionScriptsV2 = [];
    let touchSequence = [];
    let urgencyCopy = { intensity: "low", phrase: "" };
    let executiveWhyNow = { summary: "", openingLine: "" };

    try {
        if (MessagingL.rankOffers) rankedOffers = MessagingL.rankOffers(strat.candidates || []);
        if (MessagingL.classifyRole) role = MessagingL.classifyRole(lead.title, lead.seniority, lead.department);
        if (MessagingL.getRoleFraming) roleFraming = MessagingL.getRoleFraming(role, gapPhrase);
        if (MessagingL.getSegmentOfferCopy) {
            const industryKey = (strat.painModel && strat.painModel.industryKey) || null;
            const extendedType = research.facts && research.facts.extendedBusinessModel && research.facts.extendedBusinessModel.type;
            segmentCopy = MessagingL.getSegmentOfferCopy(strat.best.id, industryKey, extendedType);
        }
        if (MessagingL.checkOpenerSpecificity) specificity = MessagingL.checkOpenerSpecificity(whatsapp);
        if (MessagingL.gateMessagingConfidence) messagingConfidence = MessagingL.gateMessagingConfidence(whatsapp, strat.confidence);
        if (MessagingL.generateSubjectLineVariants) {
            const timingSignal = strat.timingSignals && strat.timingSignals.signals && strat.timingSignals.signals[0] && strat.timingSignals.signals[0].signal;
            const techInsight = research.tech && research.tech.stack && research.tech.stack[0];
            subjectLineVariants = MessagingL.generateSubjectLineVariants({ company, gapPhrase, timingSignal, techInsight });
        }
        if (MessagingL.buildObjectionScripts && MessagingL.inferCompanyProfile) {
            const profile = MessagingL.inferCompanyProfile(lead, research);
            objectionScriptsV2 = MessagingL.buildObjectionScripts(profile, offer, role);
        }
        if (MessagingL.buildTouchSequence) touchSequence = MessagingL.buildTouchSequence({ company, first, whatsapp, coldEmail, linkedin, callOpener });
        if (MessagingL.scaleUrgencyCopy) {
            const evidenceStrength = (strat.priorityModel && strat.priorityModel.priorityScore) || 0;
            urgencyCopy = MessagingL.scaleUrgencyCopy(evidenceStrength);
        }
        if (MessagingL.buildExecutiveWhyNow) {
            const topPainSignal = strat.painModel && strat.painModel.signals && strat.painModel.signals[0];
            executiveWhyNow = MessagingL.buildExecutiveWhyNow({
                company,
                icpFitScore: (strat.icpFit && strat.icpFit.icpFitScore) || 50,
                intentScore: (strat.intentSignals && strat.intentSignals.intentScore) || 0,
                timingScore: (strat.timingSignals && strat.timingSignals.timingScore) || 0,
                topPain: topPainSignal ? topPainSignal.label : gapPhrase,
                offerName: offer,
                openingLine: whatsapp,
            });
        }
    } catch {
        /* every field above already has a safe default */
    }

    return {
        whatsapp,
        coldEmail,
        linkedin,
        callOpener,
        icebreakers: ice.slice(0, 5),
        objectionHandling,
        // ---- PHASE 6 additive fields (new; fields above are unchanged) ----
        rankedOffers,
        role,
        roleFraming,
        segmentCopy,
        specificity,
        messagingConfidence,
        subjectLineVariants,
        objectionScriptsV2,
        touchSequence,
        urgencyCopy,
        executiveWhyNow,
    };
}

// ---------------------------------------------------------------------------
// assemble the concise prospect_data object the generator consumes
// ---------------------------------------------------------------------------

function buildProspectData(lead, research, analysis, strat, messages) {
    const company = lead.company || "the company";
    const nf = "Not enough public information.";

    // Merge researched socials/contacts over provided ones (provided wins if present)
    const website = research.website || lead.website || "";
    const emails = research.facts.emails || [];
    const phones = research.facts.phones || [];
    const socials = research.facts.socials || {};

    const painPoints = [];
    if (strat.gaps.chat)
        painPoints.push({ pain: "Interest isn't captured or answered instantly", evidence: "No live-chat / instant-response widget detected on the site.", impact: "Visitors leave without a trace while the team is busy elsewhere." });
    if (strat.smallTeam)
        painPoints.push({ pain: "A lean team can't follow up consistently", evidence: `Reported team size: ${formatInt(lead.employees) || "small"}.`, impact: "High-intent enquiries go cold before anyone replies." });
    if (strat.gaps.cta || strat.gaps.capture)
        painPoints.push({ pain: "Traffic isn't converting into enquiries", evidence: `${strat.gaps.cta ? "Weak/missing CTAs" : "No capture funnel"} on the site.`, impact: "The same visitors produce fewer booked conversations than they should." });
    if (!painPoints.length)
        painPoints.push({ pain: "Room to automate manual sales admin", evidence: "Based on team size and detected stack.", impact: "Time spent on admin is time not spent selling." });

    // 3 strongest value props joined for the single valueProp field
    const vp = strat.copy.valueProps || [];
    const valuePropCombined = vp.length ? vp.map((v, i) => `${i + 1}) ${v}`).join("   ") : nf;

    return {
        meta: {
            reportTitle: "Prospect Intelligence Report",
            generatedDate: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }),
            preparedFor: "Growth & Outreach Team",
            analyst: "Automated Prospect Intelligence Engine",
            confidenceNote:
                "Facts are extracted automatically from the lead record and the company website. Signals that could not be observed are shown as \"Not enough public information.\" Nothing here is fabricated.",
        },
        lead: {
            fullName: lead.fullName || nf,
            firstName: lead.firstName,
            lastName: lead.lastName,
            title: lead.title || nf,
            seniority: lead.seniority || "",
            department: lead.department || "",
            company: company,
            email: lead.email || emails[0] || nf,
            emailStatus: lead.emailStatus || "",
            phone: lead.phone || phones[0] || nf,
            website: website || nf,
            linkedin: lead.linkedin || socials.linkedin || nf,
            companyLinkedin: lead.companyLinkedin || nf,
            facebook: lead.facebook || socials.facebook || nf,
            twitter: lead.twitter || socials.twitter || nf,
            instagram: lead.instagram || socials.instagram || nf,
            industry: lead.industry || nf,
            keywords: lead.keywords && lead.keywords.length ? lead.keywords : research.facts.services,
            technologies: (research.tech.stack || []).concat(research.tech.chat || [], research.tech.booking || []),
            address: lead.address || research.facts.address || nf,
            city: lead.city || "",
            state: lead.state || "",
            country: lead.country || "",
            employees: formatInt(lead.employees) || nf,
            annualRevenue: formatMoney(lead.annualRevenue) || nf,
            totalFunding: formatMoney(lead.totalFunding) || nf,
            latestFunding: lead.latestFunding || "",
            latestFundingAmount: formatMoney(lead.latestFundingAmount) || "",
            lastRaisedAt: formatDate(lead.lastRaisedAt) || nf,
            // PHASE 3.7 — additive: surfaces the shared-domain grouping computed by
            // dedupe.annotateCompanyGroups() (if it was run upstream), so downstream
            // consumers of this single JSON file can see which other contacts, if
            // any, belong to the same company without needing the batch-level list.
            companyGroup: lead._companyGroup || null,
        },
        executiveSummary: {
            verdict: strat.verdict,
            priority: strat.priority,
            paragraphs: [
                `${company} — ${lead.title || "decision maker"} ${lead.fullName ? "(" + lead.fullName + ")" : ""}. Website score ${analysis.overallScore}/100. Recommended first move: ${strat.best.name}.`,
                `Why now: ${strat.copy.pain} The single highest-value opening is to fix that and ${strat.copy.outcome}.`,
            ],
            keyFacts: [
                ["Decision maker", `${lead.fullName || nf}${lead.title ? " — " + lead.title : ""}`],
                ["Company", company],
                ["Industry", lead.industry || nf],
                ["Business model", (research.facts.businessModel && research.facts.businessModel.type !== "business" && cap(research.facts.businessModel.type)) || nf],
                ["Founded", research.facts.foundedYear || nf],
                ["Website score", `${analysis.overallScore}/100`],
                ["Best first offer", strat.best.name],
                ["Confidence", `${strat.confidence}%`],
                ["Priority", strat.priority],
            ],
        },
        companyOverview: buildCompanyOverview(company, lead, research, analysis, strat, nf),
        decisionMaker: {
            roleType: lead.title || nf,
            caresAbout: ["More qualified conversations from existing effort", "Doing more without hiring", "Time saved on manual admin"],
            kpis: ["Qualified enquiries / booked calls", "Cost per lead", "Response & follow-up speed"],
            goals: ["Convert more of the current traffic and interest", "Keep the team lean"],
            painPoints: painPoints.map((p) => p.pain),
            buyingStyle: "Pragmatic and ROI-driven. Wants specifics and outcomes, not jargon. Fast to decide when value maps to leads, revenue, or hours saved.",
            interests: strat.copy.valueProps,
            turnOffs: ["Generic agency spam", "Overclaiming / hype", "Being sold technology instead of an outcome"],
        },
        personality: {
            founderMindset: /founder|owner|ceo|president/i.test(lead.title || "") ? "High — owner/operator." : "Manager/operator.",
            decisionStyle: "Evidence-led, fast once convinced.",
            riskTolerance: "Moderate; capital-efficient.",
            innovationLevel: "Open to automation that clearly pays back.",
            commStyle: "Direct, specific, substance-first.",
            traits: [],
        },
        websiteAudit: {
            sections: analysis.sections,
            overallScore: analysis.overallScore,
            summary: analysis.summary,
            analyzedUrl: research.website || lead.website || "",
            pages: research.crawledPages || [],
        },
        aiOpportunities: strat.automations.map((a) => ({
            name: a.name,
            description: a.why,
            hoursSaved: a.priority === "High" ? "~4-8 hrs/week" : "~2-4 hrs/week",
            responseTime: /chat|response|follow|whatsapp|booking/i.test(a.name) ? "Seconds vs. hours/days" : "—",
            conversionLift: a.priority === "High" ? "Est. 15-35% more captured leads" : "Est. 10-20%",
            revenueImpact: a.priority === "High" ? "High" : "Medium",
            complexity: /crm|workflow/i.test(a.name) ? "Medium" : "Low",
            priority: a.priority,
        })),
        websiteOpportunities: {
            critical: strat.gaps.chat ? [["No instant lead capture / response", "Inbound interest leaks with no way to capture or answer it fast.", "High"]] : [],
            quickWins: [
                strat.gaps.cta ? ["Add one clear primary CTA", "Give visitors a single obvious next step.", "Medium"] : null,
                !research.signals.hasForm ? ["Add a qualified enquiry form", "Capture visitor details so leads arrive pre-qualified.", "High"] : null,
                strat.gaps.chat ? ["Add an instant-response assistant", "Answer FAQs and capture details 24/7.", "High"] : null,
            ].filter(Boolean),
            highImpact: [
                strat.gaps.socialProof ? ["Add visible social proof", "Testimonials/reviews de-risk the buying decision.", "High"] : null,
                ["Automate follow-up", "Never let a serious lead go cold.", "High"],
            ].filter(Boolean),
            longTerm: [
                strat.gaps.design ? ["Modernise the site", "A faster, mobile-first site lifts trust and conversion.", "Medium"] : null,
            ].filter(Boolean),
        },
        painPoints,
        buyingIntent: strat.buyingIntent,
        bestFirstOffer: {
            offer: strat.best.name,
            why: `Chosen because ${strat.best.evidence}. It targets the single highest-value gap, is low-risk to start, and maps directly to more booked conversations — the outcome ${lead.fullName || "the decision maker"} cares about. Other options (${strat.runnerUp ? strat.runnerUp.name : "secondary services"}) can follow, but leading with everything would dilute the pitch.`,
        },
        salesStrategy: {
            primaryAngle: `Stop losing the interest you already earn — ${strat.copy.outcome}.`,
            secondaryAngle: strat.runnerUp ? `Follow with ${strat.runnerUp.name} once the first win lands.` : nf,
            businessOutcome: strat.copy.outcome.charAt(0).toUpperCase() + strat.copy.outcome.slice(1) + ".",
            valueProp: valuePropCombined,
            whyMatters: `For a ${strat.smallTeam ? "lean" : "growing"} team, a single recovered ${strat.cls.appointment ? "appointment" : "deal"} outweighs the cost, and every hour saved on admin goes back into the business.`,
        },
        channels: strat.channels,
        messages: {
            whatsapp: messages.whatsapp,
            coldEmail: messages.coldEmail,
            linkedin: messages.linkedin,
            followUps: [
                "Day 3 — reply to the thread with a 60–90s Loom walkthrough of the specific gap.",
                "Day 7 — share one concrete example/result relevant to their industry.",
                "Day 14 — soft close: ask if it's a priority now or better to revisit later.",
            ],
            callOpener: messages.callOpener,
            objectionHandling: messages.objectionHandling,
        },
        icebreakers: messages.icebreakers,
        websiteAuditSummary: `${company}'s site ${analysis.reachable ? "loads and covers the basics" : "was hard to analyse automatically"}. The opportunity is commercial, not cosmetic: ${analysis.summary} Three focused changes compound quickly — a clear primary call-to-action, an instant-response capture path, and visible proof (testimonials/reviews). None require rebuilding the product; they simply make sure the interest you already earn is captured and converted.`,
        salesPsychology: {
            fear: "Losing hard-won interest and runway because leads slip through the cracks.",
            desire: "Predictable, qualified conversations without growing the team.",
            motivation: "Efficient growth — maximum pipeline per dollar and per hour.",
            objections: messages.objectionHandling.map((o) => o[0]),
            overcome: [
                "Lead with a free, specific observation — zero risk, zero time.",
                "Frame it as plugging a revenue leak, not marketing spend.",
                "Stay specific and outcome-driven; never overclaim.",
            ],
        },
        nextSteps: [
            `Send the ${strat.bestChannel} opener (value-first, references the real gap).`,
            "Prepare a 60–90s Loom of the specific finding.",
            strat.channels.find((c) => c[0] === "LinkedIn") ? "Connect on LinkedIn in parallel with the warm opener." : "Line up the phone/WhatsApp follow-up.",
            `On reply, pitch the ${strat.best.name} as the first engagement.`,
        ],
        finalRecommendation: {
            verdict: strat.verdict,
            priority: strat.priority,
            confidence: strat.confidence,
            channel: strat.bestChannel,
            firstOffer: strat.best.name,
            nextStep: strat.nextStep,
            reasoning: `${strat.verdict === "YES" ? "Worth contacting." : "Contact with lighter effort."} Confidence ${strat.confidence}% based on ${research.reachable ? "a reachable site" : "limited web data"} and available contact channels. The clearest lever is ${strat.best.name.toLowerCase()} (${strat.best.evidence}). Best reached via ${strat.bestChannel}.`,
        },
        // =====================================================================
        // PHASE 1-6 additive report block. Every field below is NEW — nothing
        // above this point was renamed, removed, or restructured (STRICT RULE #1).
        // =====================================================================
        pipelineBucket: strat.verdictV2 === "DISQUALIFIED" ? "DISQUALIFIED" : strat.verdictV2 === "NURTURE" ? "NURTURE" : "STANDARD",
        confidenceModel: strat.confidenceModel,
        confidenceDecay: research.confidenceDecay || null,
        icpFit: strat.icpFit,
        painModel: strat.painModel,
        revenueEfficiency: strat.revenueEfficiency,
        dealSize: strat.dealSize,
        priorityModel: strat.priorityModel,
        tier: strat.tier,
        techGapInsights: strat.techGapInsights,
        offerSuppression: strat.offerSuppression,
        intentSignals: strat.intentSignals,
        timingSignals: strat.timingSignals,
        urgencySignals: strat.urgencySignals,
        freshness: strat.freshness,
        trustGeoSignals: strat.trustGeoSignals,
        disqualification: strat.disqualification,
        nurture: strat.nurture,
        channelsV2: strat.channelsV2,
        linkedinValidation: strat.linkedinValidation,
        industryValidation: research.facts.industryCrossValidation || null,
        extendedBusinessModel: research.facts.extendedBusinessModel || null,
        pricingIntelligence: research.facts.pricingIntelligence || null,
        socialProofInsights: research.facts.socialProofInsights || null,
        positioning: research.facts.positioning || null,
        competitors: research.facts.competitors || [],
        possibleContacts: research.facts.possibleContacts || [],
        pageSpeed: research.pageSpeed || null,
        spaShellDetected: research.spaShellDetected || false,
        headlessRenderUsed: research.headlessRenderUsed || false,
        rankedOffers: messages.rankedOffers || [],
        roleFraming: { role: messages.role, framing: messages.roleFraming },
        segmentCopy: messages.segmentCopy || null,
        messagingSpecificity: messages.specificity || null,
        messagingConfidence: messages.messagingConfidence || null,
        subjectLineVariants: messages.subjectLineVariants || [],
        objectionScriptsV2: messages.objectionScriptsV2 || [],
        touchSequence: messages.touchSequence || [],
        urgencyCopy: messages.urgencyCopy || null,
        executiveWhyNow: messages.executiveWhyNow || null,
        verdictV2: strat.verdictV2,
        priorityV2: strat.priorityV2,
        auditLog: strat.ruleLog || [],
    };
}

module.exports = { analyzeWebsite, decideStrategy, generateMessages, buildProspectData, classifyBusiness };
