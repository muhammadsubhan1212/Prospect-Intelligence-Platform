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
} = require("./lib/strategy");
const { renderReport, safeFileName } = require("./Prospect_Intelligence_Report_Generator");

/**
 * @param {object} lead - canonical lead from mapRecordToLead
 * @param {object} [opts]
 * @param {number} [opts.timeout]
 * @param {string} [opts.outDir] - where to write the .docx
 * @param {string} [opts.jsonDir] - where to write prospect_data JSON (if saveJson)
 * @param {boolean} [opts.saveJson]
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

    let research = await researchWebsite(lead, { timeout });

    // One automatic retry — transient blocks / slow TLS often succeed on a second pass.
    if (research.website && !research.reachable) {
        const retryTimeout = Math.max(timeout * 2, 25000);
        onProgress(
            "researching",
            `Homepage fetch failed — retrying once (${retryTimeout} ms timeout)…`,
            { status: research.homepage && research.homepage.status }
        );
        research = await researchWebsite(lead, { timeout: retryTimeout });
    }

    // Hard stop: never invent a full sales strategy / DOCX from an empty crawl.
    if (research.website && !research.reachable) {
        const detail = (research.notes && research.notes.length)
            ? research.notes.join(" ")
            : "status 0 / fetch failed";
        const err = new Error(
            `Incomplete research: could not load ${research.website}. ${detail} ` +
                "No sales strategy or DOCX was generated — fix the URL or re-run when the site is reachable."
        );
        err.code = "INCOMPLETE_RESEARCH";
        onProgress("failed", err.message);
        throw err;
    }

    if (!research.website) {
        const err = new Error(
            "Incomplete research: no website URL on this lead. " +
                "A reachable company website is required before generating a Prospect Intelligence Report."
        );
        err.code = "INCOMPLETE_RESEARCH";
        onProgress("failed", err.message);
        throw err;
    }

    if (research.reachable) {
        onProgress(
            "researching",
            `Fetched ${(research.signals.pagesFetched || []).join(", ") || "home"} (${research.homepage.ms} ms)`
        );
    }

    onProgress("analyzing", "Analyzing website and deciding strategy...");
    const analysis = analyzeWebsite(research);
    const strat = decideStrategy(lead, research, analysis);
    const messages = generateMessages(lead, research, analysis, strat);
    const data = buildProspectData(lead, research, analysis, strat, messages);

    onProgress("analyzing", `Website score ${analysis.overallScore}/100 · Offer: ${strat.best.name}`, {
        score: analysis.overallScore,
        offer: strat.best.name,
        priority: strat.priority,
        confidence: strat.confidence,
    });

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
