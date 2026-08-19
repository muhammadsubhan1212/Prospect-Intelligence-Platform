/**
 * Shared lead-processing pipeline.
 * Same logic as research_and_generate.js processLead — extracted so the
 * web app and CLI both call one implementation (no duplicated research/strategy).
 *
 *   lead → researchWebsite → analyze → decide → messages → buildProspectData → DOCX
 */

const fs = require("fs");
const path = require("path");

const { researchWebsite } = require("./lib/research");
const {
    analyzeWebsite,
    decideStrategy,
    generateMessages,
    buildProspectData,
    buildUnreachableSkipData,
} = require("./lib/strategy");
const { renderReport, safeFileName } = require("./Prospect_Intelligence_Report_Generator");

/**
 * @param {object} lead - canonical lead from mapRecordToLead
 * @param {object} [opts]
 * @param {number} [opts.timeout]
 * @param {string} [opts.outDir] - where to write the .docx
 * @param {string} [opts.jsonDir] - where to write prospect_data JSON (if saveJson)
 * @param {boolean} [opts.saveJson]
 * @param {object} [opts.icpProfile] - optional ICP profile
 * @param {string[]} [opts.offerFocus] - soft boost offer ids/names
 * @param {Record<string, number>} [opts.offerUsageCounts] - in-batch frequency map
 * @param {(stage: string, message: string, extra?: object) => void} [opts.onProgress]
 * @returns {Promise<{ outPath: string, data: object, analysis: object, strat: object, research: object }>}
 */
async function processLead(lead, opts = {}) {
    const timeout = opts.timeout || 12000;
    const outDir = opts.outDir;
    const jsonDir = opts.jsonDir;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};

    const label = `${lead.fullName || "(no name)"} @ ${lead.company || "(no company)"}`;
    onProgress("researching", `Researching: ${label}`, { website: lead.website || null });

    // Missing website → SKIP action card (no invented strategy).
    if (!lead.website) {
        const reason =
            "Incomplete research: no website URL on this lead. A reachable company website is required.";
        onProgress("analyzing", "SKIP — no website URL");
        return finalizeSkip(lead, null, reason, opts, onProgress);
    }

    let research = await researchWebsite(lead, { timeout, icpProfile: opts.icpProfile });

    // One automatic retry — transient blocks / slow TLS often succeed on a second pass.
    if (research.website && !research.reachable) {
        const retryTimeout = Math.max(timeout * 2, 25000);
        onProgress(
            "researching",
            `Homepage fetch failed — retrying once (${retryTimeout} ms timeout)…`,
            { status: research.homepage && research.homepage.status }
        );
        research = await researchWebsite(lead, { timeout: retryTimeout, icpProfile: opts.icpProfile });
    }

    // Unreachable site → SKIP action card (still write JSON + thin DOCX).
    if (research.website && !research.reachable) {
        const detail =
            research.notes && research.notes.length
                ? research.notes.join(" ")
                : "status 0 / fetch failed";
        const reason = `Could not load ${research.website}. ${detail}`;
        onProgress("analyzing", `SKIP — unreachable site`, { website: research.website });
        return finalizeSkip(lead, research, reason, opts, onProgress);
    }

    if (research.reachable) {
        onProgress(
            "researching",
            `Fetched ${(research.signals.pagesFetched || []).join(", ") || "home"} (${research.homepage.ms} ms)`
        );
    }

    onProgress("analyzing", "Analyzing website and deciding strategy...");
    const analysis = analyzeWebsite(research);
    const strat = decideStrategy(lead, research, analysis, {
        icpProfile: opts.icpProfile,
        offerFocus: opts.offerFocus,
        offerUsageCounts: opts.offerUsageCounts,
    });
    const messages = generateMessages(lead, research, analysis, strat);
    const data = buildProspectData(lead, research, analysis, strat, messages);

    // Track offer usage for in-batch diversity (caller owns the shared map).
    if (opts.offerUsageCounts && strat.best && strat.best.id) {
        opts.offerUsageCounts[strat.best.id] = (opts.offerUsageCounts[strat.best.id] || 0) + 1;
    }

    onProgress("analyzing", `Website score ${analysis.overallScore}/100 · Offer: ${strat.best.name}`, {
        score: analysis.overallScore,
        offer: strat.best.name,
        priority: data.actionCard ? data.actionCard.priority : strat.priority,
        confidence: data.actionCard ? data.actionCard.confidence : strat.confidence,
        decision: data.actionCard ? data.actionCard.decision : undefined,
    });

    if (data.pipelineBucket && data.pipelineBucket !== "STANDARD") {
        onProgress("analyzing", `Pipeline bucket: ${data.pipelineBucket}`, { bucket: data.pipelineBucket });
    }

    return writeOutputs(lead, data, analysis, strat, research, opts, onProgress);
}

async function finalizeSkip(lead, research, reason, opts, onProgress) {
    const buildSkip =
        typeof buildUnreachableSkipData === "function"
            ? buildUnreachableSkipData
            : null;
    if (!buildSkip) {
        const err = new Error(reason);
        err.code = "INCOMPLETE_RESEARCH";
        onProgress("failed", err.message);
        throw err;
    }
    const data = buildSkip(lead, research || { website: lead.website }, reason);
    const analysis = { overallScore: 0, sections: [], summary: reason, reachable: false };
    const strat = {
        best: { name: "—", id: "skip", score: 0, evidence: reason },
        priority: "Low",
        confidence: 0,
        verdict: "NO",
    };
    return writeOutputs(lead, data, analysis, strat, research || {}, opts, onProgress);
}

async function writeOutputs(lead, data, analysis, strat, research, opts, onProgress) {
    const outDir = opts.outDir;
    const jsonDir = opts.jsonDir;

    if (opts.saveJson !== false && jsonDir) {
        if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
        const jsonName = `${safeFileName(lead.company || "Prospect")}_prospect_data.json`;
        const jsonPath = path.join(jsonDir, jsonName);
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
        onProgress("generating", `Saved research JSON: ${jsonName}`);
        data._jsonPath = jsonPath;
    }

    onProgress("generating", "Generating DOCX report...");
    if (!outDir) throw new Error("processLead requires opts.outDir");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = await renderReport(data, outDir);
    onProgress("completed", `Report ready: ${path.basename(outPath)}`, { outPath });

    return { outPath, data, analysis, strat, research };
}

module.exports = { processLead };
