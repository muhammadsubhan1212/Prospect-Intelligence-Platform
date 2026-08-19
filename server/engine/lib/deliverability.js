/**
 * Deliverability-oriented copy scrub for cold email.
 * Cannot guarantee inbox placement (auth/reputation matter more than wording),
 * but removes common spam-filter bait from subject/body.
 */

const SPAMMY_PHRASE_REPLACEMENTS = [
    [/act\s*now/gi, "when you have a moment"],
    [/limited\s*time/gi, ""],
    [/100\s*%/gi, ""],
    [/guaranteed?/gi, ""],
    [/risk[\s-]*free/gi, "low-effort"],
    [/no\s*obligation/gi, "optional"],
    [/click\s*here/gi, "have a look"],
    [/buy\s*now/gi, ""],
    [/make\s*money/gi, ""],
    [/double\s*your/gi, "improve"],
    [/\$\$\$+/g, ""],
    [/!!!+/g, "."],
    [/free!!!/gi, ""],
    [/\bfree\b(?=\s+(trial|offer|gift|money|cash))/gi, ""],
    [/congratulations!?/gi, ""],
    [/you('ve| have) been selected/gi, ""],
    [/winner/gi, ""],
    [/urgent(ly)?/gi, ""],
    [/asap/gi, "soon"],
    [/no\s*strings\s*attached/gi, "optional"],
    [/worth more leads/gi, "quick thought on the site"],
    [/booked conversations/gi, "replies"],
    [/turning your traffic into/gi, "a thought on"],
];

const SPAMMY_SUBJECT_HARD_FAIL = /free|guarantee|urgent|!!!|\$\$|click|winner|congrat|limited time|act now|100%/i;

function collapseSpace(s) {
    return String(s || "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

function stripUrlsExceptNone(text) {
    // Cold openers should not include links (major spam / phishing signal).
    return String(text || "").replace(/https?:\/\/\S+/gi, "").replace(/www\.\S+/gi, "");
}

function softenCaps(text) {
    return String(text || "").replace(/\b([A-Z]{4,})\b/g, (m) => m.charAt(0) + m.slice(1).toLowerCase());
}

function scrubText(raw) {
    let s = String(raw || "");
    s = stripUrlsExceptNone(s);
    s = softenCaps(s);
    for (const [re, rep] of SPAMMY_PHRASE_REPLACEMENTS) {
        s = s.replace(re, rep);
    }
    s = s.replace(/\s+([,.!?])/g, "$1");
    s = collapseSpace(s);
    return s;
}

function scrubSubject(raw, company) {
    let s = scrubText(raw);
    if (!s || SPAMMY_SUBJECT_HARD_FAIL.test(s) || s.length > 70) {
        const c = company || "your site";
        s = `Quick note on ${c}`;
    }
    // Title case-ish: keep short and plain
    s = s.replace(/[!?]{2,}/g, "?").replace(/^\W+|\W+$/g, "");
    return s.slice(0, 70);
}

/**
 * Build a short, conversational cold email optimized for inbox filters.
 * Plain text, one observation, soft ask, no links, no hype.
 */
function buildSafeColdEmail({ first, company, service, observation, host }) {
    const name = first || "there";
    const co = company || "your company";
    const svc = service ? ` (especially around ${service})` : "";
    const obs = observation || "one clear, fixable gap on the site";
    const subjectHost = host || co;

    const subject = scrubSubject(`Quick note on ${subjectHost}`, subjectHost);

    const body = scrubText(
        `Hi ${name},\n\n` +
            `I was looking at ${co}${svc} and one thing stood out: ${obs}.\n\n` +
            `I wrote a short note with one specific idea that might help. Happy to send it if useful — and completely fine if now is not the right time.\n\n` +
            `Want me to share it?\n\n` +
            `Best,\n[Your Name]`
    );

    const subjectLines = [
        subject,
        scrubSubject(`${name}, quick thought on ${co}`, co),
        scrubSubject(`${co} — one observation`, co),
    ];

    return {
        subjectLines,
        body,
        note: "Deliverability-safe opener: plain text, one observation, soft ask, no links or hype. Inbox placement still depends on sender domain reputation (SPF/DKIM/DMARC).",
    };
}

function assessDeliverability(subject, body) {
    const issues = [];
    const sub = String(subject || "");
    const bod = String(body || "");
    if (SPAMMY_SUBJECT_HARD_FAIL.test(sub)) issues.push("Subject still looks salesy — keep it plain.");
    if (/https?:\/\//i.test(bod) || /www\./i.test(bod)) issues.push("Remove links from the first email.");
    if (/!{2,}/.test(sub + bod)) issues.push("Avoid multiple exclamation marks.");
    if (bod.length > 1200) issues.push("Body is long — shorter emails land better.");
    if (/\b(free|guarantee|urgent|click here|act now)\b/i.test(bod)) issues.push("Softened remaining hype words — double-check tone.");
    if (/\[Your Name\]/i.test(bod)) issues.push("Replace [Your Name] before sending.");
    return {
        ok: issues.length === 0,
        issues,
        tip: "Wording helps, but Gmail also weighs your domain reputation and authentication. Send from a real mailbox you use daily.",
    };
}

module.exports = {
    scrubText,
    scrubSubject,
    buildSafeColdEmail,
    assessDeliverability,
};
