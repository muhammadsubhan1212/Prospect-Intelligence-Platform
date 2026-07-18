/**
 * Prospect Intelligence Report Generator
 * -------------------------------------------------------------
 * Renders a McKinsey-style Prospect Intelligence Report (.docx)
 * from a per-lead JSON produced by the AI research step.
 *
 * Usage:
 *   node Prospect_Intelligence_Report_Generator.js [path/to/prospect_data.json]
 *
 * If no path is given it falls back to prospect_data.sample.json.
 * Output is written to ./output/<Company>_Prospect_Intelligence_Report.docx
 *
 * Design philosophy follows the reusable helper-based approach of the
 * companion report generators, but uses a distinct "intelligence dossier"
 * visual identity (deep navy + emerald accent, numbered section bands,
 * score bars, verdict badges, confidence meters, copy-ready message cards).
 */

const fs = require("fs");
const path = require("path");
const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    HeadingLevel,
    Packer,
    PageBreak,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    UnderlineType,
    WidthType,
} = require("docx");

// ============================================================
// PATHS & DATA LOADING
// ============================================================

const BASE_DIR = __dirname;
const OUTPUT_DIR = path.join(BASE_DIR, "output");
const DEFAULT_DATA = path.join(BASE_DIR, "prospect_data.sample.json");

function loadData() {
    const arg = process.argv[2];
    const dataPath = arg ? path.resolve(arg) : DEFAULT_DATA;
    if (!fs.existsSync(dataPath)) {
        console.error(`Data file not found: ${dataPath}`);
        process.exit(1);
    }
    try {
        return { data: JSON.parse(fs.readFileSync(dataPath, "utf8")), dataPath };
    } catch (err) {
        console.error(`Failed to parse JSON at ${dataPath}:`, err.message);
        process.exit(1);
    }
}

// ============================================================
// THEME — "Intelligence Dossier"
// ============================================================

const THEME = {
    fonts: { heading: "Georgia", body: "Segoe UI", mono: "Consolas" },
    colors: {
        ink: "10151F",
        muted: "5B6472",
        navy: "0B1F3A",
        navyMid: "13315C",
        teal: "0E7C7B",
        tealDark: "0A5C5B",
        tealSoft: "DBF1F0",
        emerald: "1B7A4B",
        emeraldSoft: "E3F5EC",
        amber: "B7791F",
        amberSoft: "FDF3E0",
        rose: "B4293B",
        roseSoft: "FBE7EA",
        border: "C6CFDA",
        panel: "F4F7FB",
        panelAlt: "EAF0F7",
        band: "0B1F3A",
        white: "FFFFFF",
        chipBg: "13315C",
    },
    spacing: { xs: 30, sm: 70, md: 130, lg: 190, xl: 300, line: 240 },
    sizes: {
        coverTitle: 42,
        coverSub: 22,
        sectionNum: 20,
        h1: 26,
        h2: 21,
        h3: 18,
        body: 21,
        small: 17,
        tiny: 15,
    },
};

const CONTENT_WIDTH = 9360; // ~6.5in in DXA

// ============================================================
// LOW-LEVEL HELPERS
// ============================================================

function ensureOutputDir() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function val(v, fallback = "Not enough public information.") {
    if (v === undefined || v === null) return fallback;
    if (typeof v === "string" && v.trim() === "") return fallback;
    return v;
}

function txt(text, o = {}) {
    return new TextRun({
        text: String(text === undefined || text === null ? "" : text),
        font: o.font || THEME.fonts.body,
        size: o.size || THEME.sizes.body,
        bold: o.bold || false,
        italics: o.italics || false,
        color: o.color || THEME.colors.ink,
        underline: o.underline
            ? { type: UnderlineType.SINGLE, color: o.underlineColor || THEME.colors.teal }
            : undefined,
        break: o.break || 0,
    });
}

function para(content, o = {}) {
    const children = Array.isArray(content) ? content : [txt(content, o.textOpts || {})];
    return new Paragraph({
        children,
        alignment: o.align || AlignmentType.LEFT,
        spacing: { before: o.before || 0, after: o.after ?? THEME.spacing.sm, line: o.line || THEME.spacing.line },
        indent: o.indent ? { left: o.indent, hanging: o.hanging } : undefined,
        pageBreakBefore: o.pageBreakBefore || false,
        border: o.border,
    });
}

function bullet(content, o = {}) {
    const children = Array.isArray(content) ? content : [txt(content, o.textOpts || {})];
    return new Paragraph({
        children,
        bullet: { level: o.level || 0 },
        spacing: { after: o.after ?? THEME.spacing.xs, line: THEME.spacing.line },
    });
}

function spacer(after = THEME.spacing.sm) {
    return para("", { after });
}

function pageBreak() {
    return new Paragraph({ children: [new PageBreak()] });
}

function noBorders() {
    return {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    };
}

// ============================================================
// STRUCTURAL HELPERS
// ============================================================

let SECTION_COUNTER = 0;

function sectionDivider(title, opts = {}) {
    SECTION_COUNTER += 1;
    const number = String(SECTION_COUNTER).padStart(2, "0");
    const blocks = [];
    // Sections flow continuously instead of each starting on a fresh page —
    // this removes the large blank areas that short sections left behind.
    // Pass { pageBreak: true } to force a break before a specific section.
    if (opts.pageBreak === true) {
        blocks.push(pageBreak());
    } else if (SECTION_COUNTER > 1) {
        blocks.push(spacer(THEME.spacing.lg));
    }

    blocks.push(
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorders(),
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 12, type: WidthType.PERCENTAGE },
                            shading: { type: ShadingType.CLEAR, fill: THEME.colors.teal, color: "auto" },
                            margins: { top: 80, bottom: 80, left: 80, right: 80 },
                            verticalAlign: "center",
                            children: [
                                para(number, {
                                    align: AlignmentType.CENTER,
                                    after: 0,
                                    textOpts: { bold: true, size: THEME.sizes.sectionNum, color: THEME.colors.white, font: THEME.fonts.heading },
                                }),
                            ],
                        }),
                        new TableCell({
                            width: { size: 88, type: WidthType.PERCENTAGE },
                            shading: { type: ShadingType.CLEAR, fill: THEME.colors.navy, color: "auto" },
                            margins: { top: 80, bottom: 80, left: 180, right: 140 },
                            verticalAlign: "center",
                            children: [
                                para(title.toUpperCase(), {
                                    after: 0,
                                    textOpts: { bold: true, size: THEME.sizes.h1, color: THEME.colors.white, font: THEME.fonts.heading },
                                }),
                            ],
                        }),
                    ],
                }),
            ],
        })
    );

    // Invisible Heading 1 for TOC navigation
    blocks.push(
        new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 0, after: THEME.spacing.sm, line: 1 },
            children: [txt(`${number}. ${title}`, { size: 2, color: THEME.colors.white })],
        })
    );
    return blocks;
}

function subHeading(title) {
    return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: THEME.spacing.lg, after: THEME.spacing.sm, line: THEME.spacing.line },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: THEME.colors.teal, space: 8 } },
        indent: { left: 90 },
        children: [txt(title, { bold: true, size: THEME.sizes.h2, color: THEME.colors.navyMid, font: THEME.fonts.heading })],
    });
}

function chip(text, fill, textColor) {
    return new Table({
        borders: noBorders(),
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        shading: { type: ShadingType.CLEAR, fill, color: "auto" },
                        margins: { top: 40, bottom: 40, left: 140, right: 140 },
                        children: [para(text, { after: 0, textOpts: { bold: true, size: THEME.sizes.small, color: textColor || THEME.colors.white } })],
                    }),
                ],
            }),
        ],
    });
}

// ============================================================
// TABLES
// ============================================================

function colWidths(cols, weights) {
    if (weights && weights.length === cols) {
        const total = weights.reduce((a, b) => a + b, 0);
        return weights.map((w) => Math.floor((w / total) * CONTENT_WIDTH));
    }
    const base = Math.floor(CONTENT_WIDTH / cols);
    const arr = Array(cols).fill(base);
    arr[cols - 1] += CONTENT_WIDTH - base * cols;
    return arr;
}

function dataTable(headers, rows, weights) {
    const widths = colWidths(headers.length, weights);
    const headerRow = new TableRow({
        tableHeader: true,
        children: headers.map(
            (h, i) =>
                new TableCell({
                    width: { size: widths[i], type: WidthType.DXA },
                    shading: { type: ShadingType.CLEAR, fill: THEME.colors.navy, color: "auto" },
                    margins: { top: 90, bottom: 90, left: 110, right: 110 },
                    children: [para(h, { after: 0, textOpts: { bold: true, color: THEME.colors.white, size: THEME.sizes.small } })],
                })
        ),
    });
    const bodyRows = rows.map(
        (row, ri) =>
            new TableRow({
                children: row.map(
                    (cell, ci) =>
                        new TableCell({
                            width: { size: widths[ci], type: WidthType.DXA },
                            shading: {
                                type: ShadingType.CLEAR,
                                fill: ri % 2 === 0 ? THEME.colors.white : THEME.colors.panel,
                                color: "auto",
                            },
                            margins: { top: 80, bottom: 80, left: 110, right: 110 },
                            children: Array.isArray(cell)
                                ? cell
                                : [para(String(cell), { after: 0, textOpts: { size: THEME.sizes.small } })],
                        })
                ),
            })
    );
    return new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        layout: TableLayoutType.FIXED,
        columnWidths: widths,
        rows: [headerRow, ...bodyRows],
        borders: {
            top: { style: BorderStyle.SINGLE, size: 6, color: THEME.colors.teal },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
            left: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
            right: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.border },
            insideVertical: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.border },
        },
    });
}

function kvTable(pairs, labelWeight = 32) {
    const widths = colWidths(2, [labelWeight, 100 - labelWeight]);
    const rows = pairs.map(
        ([label, value], ri) =>
            new TableRow({
                children: [
                    new TableCell({
                        width: { size: widths[0], type: WidthType.DXA },
                        shading: { type: ShadingType.CLEAR, fill: THEME.colors.panelAlt, color: "auto" },
                        margins: { top: 70, bottom: 70, left: 110, right: 110 },
                        children: [para(label, { after: 0, textOpts: { bold: true, size: THEME.sizes.small, color: THEME.colors.navyMid } })],
                    }),
                    new TableCell({
                        width: { size: widths[1], type: WidthType.DXA },
                        shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? THEME.colors.white : THEME.colors.panel, color: "auto" },
                        margins: { top: 70, bottom: 70, left: 110, right: 110 },
                        children: Array.isArray(value) ? value : [para(String(value), { after: 0, textOpts: { size: THEME.sizes.small } })],
                    }),
                ],
            })
    );
    return new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        layout: TableLayoutType.FIXED,
        columnWidths: widths,
        rows,
        borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
            left: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
            right: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.border },
            insideVertical: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.border },
        },
    });
}

// Renders a value plus a compact "source / where to verify" line beneath it.
function valueWithSource(value, source) {
    const out = [para(String(value), { after: source ? 20 : 0, textOpts: { size: THEME.sizes.small } })];
    if (source && (source.where || source.url)) {
        const runs = [txt("↳ Source: ", { size: THEME.sizes.tiny, italics: true, color: THEME.colors.muted })];
        if (source.where) runs.push(txt(source.where, { size: THEME.sizes.tiny, italics: true, color: THEME.colors.muted }));
        if (source.url) {
            runs.push(txt("  ·  ", { size: THEME.sizes.tiny, color: THEME.colors.muted }));
            runs.push(txt(source.url, { size: THEME.sizes.tiny, color: THEME.colors.teal, font: THEME.fonts.mono }));
        }
        out.push(new Paragraph({ children: runs, spacing: { before: 0, after: 0, line: THEME.spacing.line } }));
    }
    return out;
}

// ============================================================
// CALLOUTS
// ============================================================

function callout(label, lines, fill, accent, labelColor) {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 3, color: THEME.colors.border },
            bottom: { style: BorderStyle.SINGLE, size: 3, color: THEME.colors.border },
            left: { style: BorderStyle.SINGLE, size: 22, color: accent },
            right: { style: BorderStyle.SINGLE, size: 3, color: THEME.colors.border },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        },
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        shading: { type: ShadingType.CLEAR, fill, color: "auto" },
                        margins: { top: 120, bottom: 120, left: 160, right: 140 },
                        children: [
                            para(label.toUpperCase(), {
                                after: 90,
                                textOpts: { bold: true, size: THEME.sizes.tiny, color: labelColor || accent },
                            }),
                            ...lines.map((l) => (typeof l === "string" ? para(l, { after: THEME.spacing.xs }) : l)),
                        ],
                    }),
                ],
            }),
        ],
    });
}

const insightBox = (lines) => callout("Insight", lines, THEME.colors.tealSoft, THEME.colors.teal, THEME.colors.tealDark);
const opportunityBox = (lines) => callout("Opportunity", lines, THEME.colors.emeraldSoft, THEME.colors.emerald, THEME.colors.emerald);
const riskBox = (lines) => callout("Watch-out", lines, THEME.colors.amberSoft, THEME.colors.amber, THEME.colors.amber);
const doNotBox = (lines) => callout("Do NOT say / do", lines, THEME.colors.roseSoft, THEME.colors.rose, THEME.colors.rose);

// ============================================================
// VISUAL: SCORE BAR (segmented)
// ============================================================

function scoreBar(label, score, max) {
    const clamped = Math.max(0, Math.min(max, Number(score) || 0));
    const segments = max <= 10 ? max : 20;
    const filled = Math.round((clamped / max) * segments);
    const cells = [];
    for (let i = 0; i < segments; i++) {
        const on = i < filled;
        cells.push(
            new TableCell({
                width: { size: Math.floor(3600 / segments), type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: on ? barColor(clamped, max) : THEME.colors.panelAlt, color: "auto" },
                margins: { top: 20, bottom: 20, left: 0, right: 0 },
                borders: {
                    top: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.white },
                    bottom: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.white },
                    left: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.white },
                    right: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.white },
                },
                children: [para("", { after: 0, textOpts: { size: 2 } })],
            })
        );
    }

    const widths = colWidths(3, [34, 52, 14]);
    return new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        layout: TableLayoutType.FIXED,
        columnWidths: widths,
        borders: noBorders(),
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        width: { size: widths[0], type: WidthType.DXA },
                        verticalAlign: "center",
                        margins: { top: 30, bottom: 30, left: 0, right: 80 },
                        children: [para(label, { after: 0, textOpts: { size: THEME.sizes.small, color: THEME.colors.ink } })],
                    }),
                    new TableCell({
                        width: { size: widths[1], type: WidthType.DXA },
                        verticalAlign: "center",
                        margins: { top: 30, bottom: 30, left: 0, right: 0 },
                        children: [
                            new Table({
                                width: { size: 100, type: WidthType.PERCENTAGE },
                                layout: TableLayoutType.FIXED,
                                borders: noBorders(),
                                rows: [new TableRow({ children: cells })],
                            }),
                        ],
                    }),
                    new TableCell({
                        width: { size: widths[2], type: WidthType.DXA },
                        verticalAlign: "center",
                        margins: { top: 30, bottom: 30, left: 80, right: 0 },
                        children: [
                            para(`${clamped}/${max}`, {
                                align: AlignmentType.RIGHT,
                                after: 0,
                                textOpts: { bold: true, size: THEME.sizes.small, color: barColor(clamped, max) },
                            }),
                        ],
                    }),
                ],
            }),
        ],
    });
}

function barColor(score, max) {
    const pct = score / max;
    if (pct >= 0.7) return THEME.colors.emerald;
    if (pct >= 0.45) return THEME.colors.amber;
    return THEME.colors.rose;
}

// ============================================================
// VISUAL: VERDICT BADGE + PRIORITY
// ============================================================

function verdictColor(verdict) {
    const v = String(verdict || "").toUpperCase();
    if (v === "YES") return THEME.colors.emerald;
    if (v === "NO") return THEME.colors.rose;
    return THEME.colors.amber; // MAYBE / default
}

function priorityColor(priority) {
    const p = String(priority || "").toLowerCase();
    if (p === "high") return THEME.colors.emerald;
    if (p === "low") return THEME.colors.rose;
    return THEME.colors.amber;
}

function verdictBanner(verdict, priority) {
    const widths = colWidths(2, [50, 50]);
    return new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        layout: TableLayoutType.FIXED,
        columnWidths: widths,
        borders: noBorders(),
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        width: { size: widths[0], type: WidthType.DXA },
                        shading: { type: ShadingType.CLEAR, fill: verdictColor(verdict), color: "auto" },
                        margins: { top: 140, bottom: 140, left: 160, right: 100 },
                        children: [
                            para("CONTACT DECISION", { after: 30, textOpts: { size: THEME.sizes.tiny, color: THEME.colors.white } }),
                            para(String(verdict || "MAYBE").toUpperCase(), { after: 0, textOpts: { bold: true, size: 30, color: THEME.colors.white, font: THEME.fonts.heading } }),
                        ],
                    }),
                    new TableCell({
                        width: { size: widths[1], type: WidthType.DXA },
                        shading: { type: ShadingType.CLEAR, fill: priorityColor(priority), color: "auto" },
                        margins: { top: 140, bottom: 140, left: 160, right: 100 },
                        children: [
                            para("PRIORITY", { after: 30, textOpts: { size: THEME.sizes.tiny, color: THEME.colors.white } }),
                            para(String(priority || "Medium").toUpperCase(), { after: 0, textOpts: { bold: true, size: 30, color: THEME.colors.white, font: THEME.fonts.heading } }),
                        ],
                    }),
                ],
            }),
        ],
    });
}

// ============================================================
// VISUAL: MESSAGE CARD (copy-ready)
// ============================================================

function messageCard(title, body, opts = {}) {
    const bodyLines = String(body).split("\n");
    const bodyParas = bodyLines.map((line) =>
        para(line === "" ? " " : line, {
            after: 40,
            textOpts: { font: opts.mono ? THEME.fonts.mono : THEME.fonts.body, size: THEME.sizes.small, color: THEME.colors.ink },
        })
    );
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.navyMid },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.navyMid },
            left: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.navyMid },
            right: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.navyMid },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        },
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        shading: { type: ShadingType.CLEAR, fill: THEME.colors.navyMid, color: "auto" },
                        margins: { top: 80, bottom: 80, left: 140, right: 140 },
                        children: [para(title.toUpperCase(), { after: 0, textOpts: { bold: true, size: THEME.sizes.small, color: THEME.colors.white } })],
                    }),
                ],
            }),
            new TableRow({
                children: [
                    new TableCell({
                        shading: { type: ShadingType.CLEAR, fill: THEME.colors.panel, color: "auto" },
                        margins: { top: 120, bottom: 120, left: 140, right: 140 },
                        children: bodyParas,
                    }),
                ],
            }),
        ],
    });
}

// "How to send" destination box — tells the user exactly where to send and how.
function sendToBox(lines) {
    const paras = lines.map((l) => {
        if (Array.isArray(l)) return new Paragraph({ children: l, spacing: { after: THEME.spacing.xs, line: THEME.spacing.line } });
        return para(l, { after: THEME.spacing.xs, textOpts: { size: THEME.sizes.small } });
    });
    return callout("Send it — exact destination & steps", paras, THEME.colors.emeraldSoft, THEME.colors.emerald, THEME.colors.emerald);
}

function linkRun(url) {
    return txt(url, { size: THEME.sizes.small, color: THEME.colors.teal, font: THEME.fonts.mono });
}

function phoneDigits(s) {
    return String(s || "").replace(/[^\d]/g, "");
}

// Returns "" when the value is missing or the "not enough info" sentinel.
function realVal(v) {
    if (v === undefined || v === null) return "";
    const s = String(v).trim();
    if (!s || /^not enough public information/i.test(s)) return "";
    return s;
}

// ============================================================
// HEADER / FOOTER
// ============================================================

function buildHeader(D) {
    const company = val(D.lead && D.lead.company, "Prospect");
    return new Header({
        children: [
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    bottom: { style: BorderStyle.SINGLE, size: 3, color: THEME.colors.teal },
                    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                },
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({
                                width: { size: 60, type: WidthType.PERCENTAGE },
                                children: [para("PROSPECT INTELLIGENCE REPORT", { after: 30, textOpts: { bold: true, color: THEME.colors.navyMid, size: THEME.sizes.tiny } })],
                            }),
                            new TableCell({
                                width: { size: 40, type: WidthType.PERCENTAGE },
                                children: [para(company, { align: AlignmentType.RIGHT, after: 30, textOpts: { color: THEME.colors.muted, size: THEME.sizes.tiny } })],
                            }),
                        ],
                    }),
                ],
            }),
        ],
    });
}

function buildFooter(D) {
    return new Footer({
        children: [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 100, after: 0 },
                border: { top: { color: THEME.colors.border, style: BorderStyle.SINGLE, size: 4 } },
                children: [
                    txt("Confidential — prepared for internal outreach use  ·  Page ", { color: THEME.colors.muted, size: THEME.sizes.tiny }),
                    new TextRun({ children: [PageNumber.CURRENT], size: THEME.sizes.tiny, color: THEME.colors.muted, font: THEME.fonts.body }),
                ],
            }),
        ],
    });
}

// ============================================================
// COVER + TOC
// ============================================================

function buildCover(D) {
    const lead = D.lead || {};
    const meta = D.meta || {};
    const exec = D.executiveSummary || {};

    return [
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorders(),
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            shading: { type: ShadingType.CLEAR, fill: THEME.colors.navy, color: "auto" },
                            margins: { top: 520, bottom: 520, left: 420, right: 420 },
                            children: [
                                para("PROSPECT INTELLIGENCE", { align: AlignmentType.CENTER, after: 40, textOpts: { bold: true, size: 20, color: THEME.colors.tealSoft, font: THEME.fonts.body } }),
                                para("DOSSIER", { align: AlignmentType.CENTER, after: 0, textOpts: { bold: true, size: 46, color: THEME.colors.white, font: THEME.fonts.heading } }),
                            ],
                        }),
                    ],
                }),
            ],
        }),
        spacer(320),
        para(val(lead.company, "Target Company"), { align: AlignmentType.CENTER, after: 60, textOpts: { bold: true, size: THEME.sizes.coverTitle, color: THEME.colors.navy, font: THEME.fonts.heading } }),
        para(`${val(lead.fullName, "Decision Maker")}  ·  ${val(lead.title, "")}`, { align: AlignmentType.CENTER, after: 40, textOpts: { size: THEME.sizes.coverSub, color: THEME.colors.muted } }),
        para(val(lead.industry, ""), { align: AlignmentType.CENTER, after: 260, textOpts: { italics: true, size: THEME.sizes.small, color: THEME.colors.teal } }),
        verdictBanner(exec.verdict, exec.priority),
        spacer(240),
        kvTable([
            ["Prepared for", val(meta.preparedFor, "Outreach Team")],
            ["Prepared by", val(meta.analyst, "Prospect Intelligence Engine")],
            ["Report date", val(meta.generatedDate, new Date().toDateString())],
            ["Company", val(lead.company)],
            ["Decision maker", `${val(lead.fullName)} — ${val(lead.title)}`],
            ["Location", `${val(lead.city, "")}${lead.state ? ", " + lead.state : ""}${lead.country ? ", " + lead.country : ""}`.replace(/^,\s*/, "")],
            ["Website", val(lead.website)],
        ], 30),
        spacer(200),
        insightBox([
            val(meta.confidenceNote,
                "Verified facts are drawn from the supplied lead record and public positioning. Inferences are labelled. Where a claim cannot be verified, the report states: \"Not enough public information.\""),
        ]),
        pageBreak(),
    ];
}

const TOC_ENTRIES = [
    "Executive Summary",
    "Company Overview",
    "Decision Maker Analysis",
    "Website Audit",
    "Website Score",
    "AI Automation Opportunities",
    "Website Opportunities",
    "Business Pain Points",
    "Buying Intent Score",
    "Best First Offer",
    "Personalized Sales Strategy",
    "Best Communication Channel",
    "Personalized WhatsApp Message",
    "Personalized Cold Email",
    "Personalized LinkedIn Message",
    "Follow-up Strategy",
    "Sales Psychology",
    "Objection Handling",
    "Personalized Icebreakers",
    "Client-Facing Website Audit Summary",
    "Recommended Next Steps",
    "Final Recommendation",
];

function buildTOC() {
    // Static TOC (not a Word TOC field) so entries are visible in Word AND in-browser
    // document preview without requiring "Update Field".
    const rows = TOC_ENTRIES.map((title, i) => {
        const num = String(i + 1).padStart(2, "0");
        return new TableRow({
            children: [
                new TableCell({
                    width: { size: 900, type: WidthType.DXA },
                    shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? THEME.colors.panel : THEME.colors.white, color: "auto" },
                    margins: { top: 60, bottom: 60, left: 100, right: 60 },
                    children: [
                        para(num, {
                            after: 0,
                            textOpts: { bold: true, size: THEME.sizes.small, color: THEME.colors.teal, font: THEME.fonts.mono },
                        }),
                    ],
                }),
                new TableCell({
                    width: { size: CONTENT_WIDTH - 900, type: WidthType.DXA },
                    shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? THEME.colors.panel : THEME.colors.white, color: "auto" },
                    margins: { top: 60, bottom: 60, left: 80, right: 100 },
                    children: [
                        para(title, {
                            after: 0,
                            textOpts: { size: THEME.sizes.body, color: THEME.colors.ink },
                        }),
                    ],
                }),
            ],
        });
    });

    return [
        para("CONTENTS", { align: AlignmentType.CENTER, before: 120, after: 40, textOpts: { bold: true, size: 16, color: THEME.colors.muted } }),
        para("Report Navigation", { align: AlignmentType.CENTER, after: 60, textOpts: { bold: true, size: 30, color: THEME.colors.navy, font: THEME.fonts.heading } }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: THEME.colors.teal } },
            children: [],
        }),
        para("Sections in this dossier:", {
            after: THEME.spacing.sm,
            textOpts: { size: THEME.sizes.small, color: THEME.colors.muted, italics: true },
        }),
        new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            layout: TableLayoutType.FIXED,
            columnWidths: [900, CONTENT_WIDTH - 900],
            borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
                left: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
                right: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.border },
                insideVertical: { style: BorderStyle.SINGLE, size: 2, color: THEME.colors.border },
            },
            rows,
        }),
        pageBreak(),
    ];
}

// ============================================================
// SECTION BUILDERS (20)
// ============================================================

function paras(list) {
    return (Array.isArray(list) ? list : []).map((p) => para(p, { after: THEME.spacing.sm }));
}

// 1. Executive Summary
function s_executiveSummary(D) {
    const e = D.executiveSummary || {};
    const blocks = [
        ...sectionDivider("Executive Summary", { pageBreak: false }),
        verdictBanner(e.verdict, e.priority),
        spacer(160),
        ...paras(e.paragraphs),
    ];
    if (Array.isArray(e.keyFacts) && e.keyFacts.length) {
        blocks.push(subHeading("At a Glance"));
        blocks.push(kvTable(e.keyFacts, 30));
    }
    return blocks;
}

// 2. Company Overview
function s_companyOverview(D) {
    const c = D.companyOverview || {};
    const cs = c.sources || {};
    const blocks = [...sectionDivider("Company Overview")];
    const rows = [
        ["Who they are", valueWithSource(val(c.whoTheyAre), cs.whoTheyAre)],
        ["What they sell", valueWithSource(val(c.whatTheySell), cs.whatTheySell)],
        ["Who they serve", valueWithSource(val(c.whoTheyServe), cs.whoTheyServe)],
        ["How they make money", valueWithSource(val(c.howTheyMakeMoney), cs.howTheyMakeMoney)],
        ["Ideal customers", valueWithSource(val(c.idealCustomers), cs.idealCustomers)],
        ["Digital maturity", valueWithSource(val(c.digitalMaturity), cs.digitalMaturity)],
    ];
    blocks.push(kvTable(rows, 26));
    if (Array.isArray(c.paragraphs) && c.paragraphs.length) {
        blocks.push(subHeading("Analyst Commentary"));
        blocks.push(...paras(c.paragraphs));
    }
    // Firmographics from lead record
    const lead = D.lead || {};
    blocks.push(subHeading("Firmographic Snapshot"));
    blocks.push(para("Source for all figures below: the imported lead data record (CSV / Apollo export).", { after: THEME.spacing.xs, textOpts: { italics: true, size: THEME.sizes.tiny, color: THEME.colors.muted } }));
    blocks.push(
        kvTable([
            ["Industry", val(lead.industry)],
            ["Employees", val(lead.employees)],
            ["Annual revenue", val(lead.annualRevenue)],
            ["Total funding", val(lead.totalFunding)],
            ["Latest funding", `${val(lead.latestFunding, "")} ${lead.latestFundingAmount ? "(" + lead.latestFundingAmount + ")" : ""}`.trim() || "Not enough public information."],
            ["Last raised", val(lead.lastRaisedAt)],
            ["Technologies", Array.isArray(lead.technologies) ? lead.technologies.join(", ") : val(lead.technologies)],
            ["Keywords", Array.isArray(lead.keywords) ? lead.keywords.join(", ") : val(lead.keywords)],
        ], 26)
    );
    return blocks;
}

// 3. Decision Maker Analysis
function s_decisionMaker(D) {
    const d = D.decisionMaker || {};
    const blocks = [...sectionDivider("Decision Maker Analysis")];
    const lead = D.lead || {};
    blocks.push(
        kvTable([
            ["Name", val(lead.fullName)],
            ["Role", val(lead.title)],
            ["Role type", val(d.roleType)],
            ["Seniority", val(lead.seniority)],
            ["LinkedIn", val(lead.linkedin)],
        ], 26)
    );
    const listBlock = (title, arr) => {
        if (!Array.isArray(arr) || !arr.length) return [];
        return [subHeading(title), ...arr.map((x) => bullet(x))];
    };
    blocks.push(...listBlock("What they care about", d.caresAbout));
    blocks.push(...listBlock("Their KPIs", d.kpis));
    blocks.push(...listBlock("Business goals", d.goals));
    blocks.push(...listBlock("Likely pain points", d.painPoints));
    if (d.buyingStyle) {
        blocks.push(subHeading("How they make buying decisions"));
        blocks.push(para(val(d.buyingStyle)));
    }
    if (Array.isArray(d.interests) && d.interests.length) {
        blocks.push(opportunityBox([para("What would interest them", { after: 60, textOpts: { bold: true } }), ...d.interests.map((x) => bullet(x))]));
    }
    if (Array.isArray(d.turnOffs) && d.turnOffs.length) {
        blocks.push(spacer(120));
        blocks.push(doNotBox([para("What would immediately turn them off", { after: 60, textOpts: { bold: true } }), ...d.turnOffs.map((x) => bullet(x))]));
    }
    return blocks;
}

// 4. Website Audit
function s_websiteAudit(D) {
    const w = D.websiteAudit || {};
    const blocks = [...sectionDivider("Website Audit")];
    if (w.analyzedUrl) {
        blocks.push(para([txt("Analyzed site: ", { bold: true, size: THEME.sizes.small }), txt(w.analyzedUrl, { size: THEME.sizes.small, color: THEME.colors.teal, font: THEME.fonts.mono })], { after: THEME.spacing.xs }));
    }
    if (Array.isArray(w.pages) && w.pages.length) {
        blocks.push(para([txt("Pages reviewed (verify findings here): ", { bold: true, size: THEME.sizes.tiny, color: THEME.colors.muted })], { after: 10 }));
        w.pages.forEach(([role, url]) => {
            blocks.push(new Paragraph({ children: [txt(`• ${role}: `, { size: THEME.sizes.tiny, color: THEME.colors.muted }), txt(url, { size: THEME.sizes.tiny, color: THEME.colors.teal, font: THEME.fonts.mono })], spacing: { after: 0, line: THEME.spacing.line } }));
        });
        blocks.push(spacer(THEME.spacing.sm));
    }
    if (w.summary) blocks.push(para(val(w.summary)));
    blocks.push(subHeading("Section Scores"));
    const secs = Array.isArray(w.sections) ? w.sections : [];
    secs.forEach(([name, score, note]) => {
        blocks.push(scoreBar(name, score, 10));
        if (note) blocks.push(para(note, { after: THEME.spacing.sm, indent: 120, textOpts: { size: THEME.sizes.tiny, color: THEME.colors.muted, italics: true } }));
    });
    return blocks;
}

// 5. Website Score
function s_websiteScore(D) {
    const w = D.websiteAudit || {};
    const overall = Number(w.overallScore) || 0;
    const blocks = [...sectionDivider("Website Score")];
    blocks.push(
        new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            layout: TableLayoutType.FIXED,
            columnWidths: colWidths(1),
            borders: noBorders(),
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            shading: { type: ShadingType.CLEAR, fill: THEME.colors.navy, color: "auto" },
                            margins: { top: 200, bottom: 200, left: 200, right: 200 },
                            children: [
                                para("OVERALL WEBSITE SCORE", { align: AlignmentType.CENTER, after: 40, textOpts: { size: THEME.sizes.small, color: THEME.colors.tealSoft } }),
                                para(`${overall}/100`, { align: AlignmentType.CENTER, after: 0, textOpts: { bold: true, size: 56, color: THEME.colors.white, font: THEME.fonts.heading } }),
                            ],
                        }),
                    ],
                }),
            ],
        })
    );
    blocks.push(spacer(160));
    blocks.push(scoreBar("Overall", overall, 100));
    blocks.push(spacer(100));
    blocks.push(insightBox([val(w.summary, "See the Website Audit section for the section-by-section breakdown behind this score.")]));
    return blocks;
}

// 6. AI Automation Opportunities
function s_aiOpportunities(D) {
    const arr = Array.isArray(D.aiOpportunities) ? D.aiOpportunities : [];
    const blocks = [...sectionDivider("AI Automation Opportunities")];
    if (!arr.length) {
        blocks.push(para("Not enough public information."));
        return blocks;
    }
    blocks.push(para("Opportunities are prioritised by ease of implementation against expected business impact for a lean team.", { after: THEME.spacing.md }));
    arr.forEach((o, i) => {
        blocks.push(subHeading(`${i + 1}. ${val(o.name)}  —  ${val(o.priority, "")} priority`));
        blocks.push(para(val(o.description)));
        blocks.push(
            dataTable(
                ["Hours saved", "Response time", "Conversion lift", "Revenue impact", "Complexity"],
                [[val(o.hoursSaved, "—"), val(o.responseTime, "—"), val(o.conversionLift, "—"), val(o.revenueImpact, "—"), val(o.complexity, "—")]],
                [20, 20, 22, 22, 16]
            )
        );
        blocks.push(spacer(120));
    });
    return blocks;
}

// 7. Website Opportunities
function s_websiteOpportunities(D) {
    const w = D.websiteOpportunities || {};
    const blocks = [...sectionDivider("Website Opportunities")];
    let added = 0;
    const group = (title, key) => {
        const rows = Array.isArray(w[key]) ? w[key] : [];
        if (!rows.length) return;
        added += 1;
        blocks.push(subHeading(title));
        blocks.push(dataTable(["Item", "Why it matters", "Impact"], rows.map((r) => [val(r[0]), val(r[1]), val(r[2], "—")]), [30, 55, 15]));
        blocks.push(spacer(120));
    };
    group("Critical Issues", "critical");
    group("Quick Wins", "quickWins");
    group("High-Impact Improvements", "highImpact");
    group("Long-Term Improvements", "longTerm");
    if (!added) blocks.push(para("Not enough public information."));
    return blocks;
}

// 8. Business Pain Points
function s_painPoints(D) {
    const arr = Array.isArray(D.painPoints) ? D.painPoints : [];
    const blocks = [...sectionDivider("Business Pain Points")];
    if (!arr.length) {
        blocks.push(para("Not enough public information."));
        return blocks;
    }
    blocks.push(para("Each pain point below is tied to observable evidence rather than assumption. Where evidence is inferred, it is labelled.", { after: THEME.spacing.md }));
    blocks.push(
        dataTable(
            ["Pain point", "Evidence", "Business impact"],
            arr.map((p) => [val(p.pain), val(p.evidence), val(p.impact)]),
            [30, 38, 32]
        )
    );
    return blocks;
}

// 9. Buying Intent Score
function s_buyingIntent(D) {
    const arr = Array.isArray(D.buyingIntent) ? D.buyingIntent : [];
    const blocks = [...sectionDivider("Buying Intent Score")];
    if (!arr.length) {
        blocks.push(para("Not enough public information."));
        return blocks;
    }
    blocks.push(para("Estimated probability that the prospect would buy each service, expressed as a confidence percentage.", { after: THEME.spacing.md }));
    const sorted = [...arr].sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
    sorted.forEach(([service, conf]) => {
        blocks.push(scoreBar(service, conf, 100));
    });
    return blocks;
}

// 10. Best First Offer
function s_bestFirstOffer(D) {
    const b = D.bestFirstOffer || {};
    const blocks = [...sectionDivider("Best First Offer")];
    blocks.push(
        new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            layout: TableLayoutType.FIXED,
            columnWidths: colWidths(1),
            borders: noBorders(),
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            shading: { type: ShadingType.CLEAR, fill: THEME.colors.emerald, color: "auto" },
                            margins: { top: 160, bottom: 160, left: 180, right: 180 },
                            children: [
                                para("RECOMMENDED OPENING OFFER (ONE ONLY)", { after: 40, textOpts: { size: THEME.sizes.tiny, color: THEME.colors.emeraldSoft } }),
                                para(val(b.offer, "Not enough public information."), { after: 0, textOpts: { bold: true, size: THEME.sizes.h1, color: THEME.colors.white, font: THEME.fonts.heading } }),
                            ],
                        }),
                    ],
                }),
            ],
        })
    );
    blocks.push(spacer(160));
    blocks.push(subHeading("Why this offer, and why only this one"));
    blocks.push(para(val(b.why)));
    return blocks;
}

// 11. Personalized Sales Strategy
function s_salesStrategy(D) {
    const s = D.salesStrategy || {};
    const blocks = [...sectionDivider("Personalized Sales Strategy")];
    blocks.push(
        kvTable([
            ["Primary sales angle", val(s.primaryAngle)],
            ["Secondary sales angle", val(s.secondaryAngle)],
            ["Business outcome", val(s.businessOutcome)],
            ["Value proposition", val(s.valueProp)],
        ], 26)
    );
    if (s.whyMatters) {
        blocks.push(spacer(140));
        blocks.push(insightBox([para("Why this matters to them", { after: 60, textOpts: { bold: true } }), para(val(s.whyMatters), { after: 0 })]));
    }
    blocks.push(spacer(120));
    blocks.push(riskBox(["Sell the business outcome, never the technology. Every claim should map to pipeline, revenue, or hours saved."]));
    return blocks;
}

// 12. Best Communication Channel
function s_channels(D) {
    const arr = Array.isArray(D.channels) ? D.channels : [];
    const blocks = [...sectionDivider("Best Communication Channel")];
    if (!arr.length) {
        blocks.push(para("Not enough public information."));
        return blocks;
    }
    const sorted = [...arr].sort((a, b) => (Number(a[1]) || 99) - (Number(b[1]) || 99));
    blocks.push(
        dataTable(
            ["Rank", "Channel", "Why / how to use it"],
            sorted.map((c) => [String(val(c[1], "—")), val(c[0]), val(c[2])]),
            [10, 22, 68]
        )
    );
    return blocks;
}

// 13. Personalized WhatsApp Message
function s_whatsapp(D) {
    const m = D.messages || {};
    const lead = D.lead || {};
    const blocks = [...sectionDivider("Personalized WhatsApp Message")];
    const number = realVal(lead.phone) || (Array.isArray(lead.phones) && lead.phones[0]) || "";
    if (number) {
        const link = `https://wa.me/${phoneDigits(number)}?text=${encodeURIComponent(m.whatsapp || "")}`;
        blocks.push(
            sendToBox([
                [txt("Send to (WhatsApp): ", { bold: true, size: THEME.sizes.small }), txt(number, { size: THEME.sizes.small })],
                [txt("1-tap link (opens the chat with the message pre-filled): ", { size: THEME.sizes.small }), linkRun(link)],
                "Steps: open the link on a device with WhatsApp \u2192 review the pre-filled text \u2192 press send. (Or open WhatsApp, search this number, and paste the message below.)",
            ])
        );
    } else {
        blocks.push(sendToBox(["No phone number on file for this lead. Use Email or LinkedIn first, or look for a WhatsApp / phone number on the site's contact page before using this message."]));
    }
    blocks.push(spacer(THEME.spacing.sm));
    blocks.push(messageCard("WhatsApp — first message (copy-ready)", val(m.whatsapp, "Not enough public information.")));
    return blocks;
}

// 14. Personalized Cold Email
function s_coldEmail(D) {
    const m = D.messages || {};
    const ce = m.coldEmail || {};
    const lead = D.lead || {};
    const blocks = [...sectionDivider("Personalized Cold Email")];
    const to = realVal(lead.email) || (Array.isArray(lead.emails) && lead.emails[0]) || "";
    const subject = (Array.isArray(ce.subjectLines) && ce.subjectLines[0]) || "";
    if (to) {
        const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(ce.body || "")}`;
        blocks.push(
            sendToBox([
                [txt("Send to: ", { bold: true, size: THEME.sizes.small }), txt(to, { size: THEME.sizes.small })],
                [txt("Suggested subject: ", { size: THEME.sizes.small }), txt(subject || "(pick one below)", { size: THEME.sizes.small })],
                "Send from: your own work inbox (a real, monitored address — not no-reply). Keep it plain-text for the first touch.",
                [txt("1-click compose (pre-fills subject + body): ", { size: THEME.sizes.small }), linkRun(mailto)],
            ])
        );
    } else {
        const site = realVal(lead.website) ? ` Use the contact form at ${realVal(lead.website)}` : "";
        blocks.push(sendToBox([`No email address on file for this lead. Connect on LinkedIn first, or find an address on the site's contact page.${site}`]));
    }
    blocks.push(spacer(THEME.spacing.sm));
    if (Array.isArray(ce.subjectLines) && ce.subjectLines.length) {
        blocks.push(subHeading("Subject line options"));
        ce.subjectLines.forEach((s) => blocks.push(bullet(s)));
    }
    blocks.push(subHeading("Email body"));
    blocks.push(messageCard("Cold email (copy-ready)", val(ce.body, "Not enough public information.")));
    if (ce.note) {
        blocks.push(spacer(THEME.spacing.xs));
        blocks.push(riskBox([val(ce.note)]));
    }
    return blocks;
}

// 15. Personalized LinkedIn Message
function s_linkedin(D) {
    const m = D.messages || {};
    const lead = D.lead || {};
    const blocks = [...sectionDivider("Personalized LinkedIn Message")];
    const url = realVal(lead.linkedin);
    if (url) {
        blocks.push(
            sendToBox([
                [txt("Open this profile: ", { bold: true, size: THEME.sizes.small }), linkRun(url)],
                "Steps: click Connect \u2192 \u201cAdd a note\u201d and paste the message below (if you are already connected, click Message instead) \u2192 send.",
                "Keep the connection note under ~300 characters so LinkedIn accepts it.",
            ])
        );
    } else {
        const who = `${lead.fullName || "the contact"}${lead.company ? " " + lead.company : ""}`;
        blocks.push(sendToBox([`No LinkedIn URL on file. Search \u201c${who}\u201d on LinkedIn to find the profile, then use the message below \u2014 or reach them via Email/WhatsApp.`]));
    }
    blocks.push(spacer(THEME.spacing.sm));
    blocks.push(messageCard("LinkedIn — connection / opener (copy-ready)", val(m.linkedin, "Not enough public information.")));
    return blocks;
}

// 16. Follow-up Strategy
function s_followUp(D) {
    const m = D.messages || {};
    const blocks = [...sectionDivider("Follow-up Strategy")];
    const fus = Array.isArray(m.followUps) ? m.followUps : [];
    if (fus.length) {
        blocks.push(subHeading("Sequenced follow-ups"));
        fus.forEach((f) => blocks.push(bullet(f)));
    }
    if (m.callOpener) {
        blocks.push(subHeading("Call opener"));
        const lead = D.lead || {};
        const number = realVal(lead.phone) || (Array.isArray(lead.phones) && lead.phones[0]) || "";
        if (number) {
            blocks.push(sendToBox([[txt("Call this number: ", { bold: true, size: THEME.sizes.small }), txt(number, { size: THEME.sizes.small })], "Use the opener below in the first 10 seconds, then pause and let them respond."]));
            blocks.push(spacer(THEME.spacing.xs));
        }
        blocks.push(messageCard("Phone — opening line (copy-ready)", val(m.callOpener)));
    }
    if (!fus.length && !m.callOpener) blocks.push(para("Not enough public information."));
    return blocks;
}

// 17. Sales Psychology
function s_salesPsychology(D) {
    const p = D.salesPsychology || {};
    const blocks = [...sectionDivider("Sales Psychology")];
    blocks.push(
        kvTable([
            ["Biggest fear", val(p.fear)],
            ["Biggest desire", val(p.desire)],
            ["Biggest motivation", val(p.motivation)],
        ], 26)
    );
    if (Array.isArray(p.objections) && p.objections.length) {
        blocks.push(subHeading("Most likely objections"));
        p.objections.forEach((o) => blocks.push(bullet(o)));
    }
    if (Array.isArray(p.overcome) && p.overcome.length) {
        blocks.push(subHeading("How to overcome them"));
        p.overcome.forEach((o) => blocks.push(bullet(o)));
    }
    return blocks;
}

// 18. Objection Handling
function s_objectionHandling(D) {
    const m = D.messages || {};
    const arr = Array.isArray(m.objectionHandling) ? m.objectionHandling : [];
    const blocks = [...sectionDivider("Objection Handling")];
    if (!arr.length) {
        blocks.push(para("Not enough public information."));
        return blocks;
    }
    blocks.push(
        dataTable(
            ["Likely objection", "Recommended response"],
            arr.map((o) => [val(o[0]), val(o[1])]),
            [38, 62]
        )
    );
    return blocks;
}

// Icebreakers (bonus, placed with strategy)
function s_icebreakers(D) {
    const arr = Array.isArray(D.icebreakers) ? D.icebreakers : [];
    const blocks = [...sectionDivider("Personalized Icebreakers")];
    if (!arr.length) {
        blocks.push(para("Not enough public information."));
        return blocks;
    }
    blocks.push(para("Ten specific openers. Each references something real about the company, the founder, the product, or the website.", { after: THEME.spacing.md }));
    arr.forEach((ib, i) => blocks.push(bullet([txt(`${i + 1}. `, { bold: true, color: THEME.colors.teal }), txt(ib)])));
    return blocks;
}

// Client-facing website audit summary (bonus)
function s_auditSummary(D) {
    const blocks = [...sectionDivider("Client-Facing Website Audit Summary")];
    blocks.push(para("The text below is written to be sent directly to the prospect. It is valuable and neutral in tone — not salesy.", { after: THEME.spacing.md, textOpts: { italics: true, color: THEME.colors.muted, size: THEME.sizes.small } }));
    blocks.push(messageCard("Shareable audit summary", val(D.websiteAuditSummary, "Not enough public information.")));
    return blocks;
}

// 19. Recommended Next Steps
function s_nextSteps(D) {
    const arr = Array.isArray(D.nextSteps) ? D.nextSteps : [];
    const blocks = [...sectionDivider("Recommended Next Steps")];
    if (!arr.length) {
        blocks.push(para("Not enough public information."));
        return blocks;
    }
    arr.forEach((step, i) => {
        blocks.push(
            new Table({
                width: { size: CONTENT_WIDTH, type: WidthType.DXA },
                layout: TableLayoutType.FIXED,
                columnWidths: colWidths(2, [8, 92]),
                borders: noBorders(),
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({
                                shading: { type: ShadingType.CLEAR, fill: THEME.colors.teal, color: "auto" },
                                margins: { top: 60, bottom: 60, left: 0, right: 0 },
                                verticalAlign: "center",
                                children: [para(String(i + 1), { align: AlignmentType.CENTER, after: 0, textOpts: { bold: true, color: THEME.colors.white } })],
                            }),
                            new TableCell({
                                margins: { top: 60, bottom: 60, left: 140, right: 80 },
                                verticalAlign: "center",
                                children: [para(step, { after: 0 })],
                            }),
                        ],
                    }),
                ],
            })
        );
        blocks.push(spacer(60));
    });
    return blocks;
}

// 20. Final Recommendation
function s_finalRecommendation(D) {
    const f = D.finalRecommendation || {};
    const blocks = [...sectionDivider("Final Recommendation")];
    blocks.push(verdictBanner(f.verdict, f.priority));
    blocks.push(spacer(160));
    // Decision summary card (Contact Priority / Confidence / Channel / First Offer / Next Step)
    const decisionRows = [];
    decisionRows.push(["Contact priority", val(f.priority)]);
    if (f.confidence !== undefined && f.confidence !== null && f.confidence !== "") {
        const c = typeof f.confidence === "number" ? `${f.confidence}%` : String(f.confidence);
        decisionRows.push(["Confidence score", c]);
    }
    if (f.channel) decisionRows.push(["Best communication channel", val(f.channel)]);
    if (f.firstOffer) decisionRows.push(["Best first offer", val(f.firstOffer)]);
    if (f.nextStep) decisionRows.push(["Best next step", val(f.nextStep)]);
    blocks.push(kvTable(decisionRows, 30));
    blocks.push(spacer(140));
    blocks.push(subHeading("Reasoning"));
    blocks.push(para(val(f.reasoning)));
    return blocks;
}

// ============================================================
// DOCUMENT ASSEMBLY
// ============================================================

function createDocument(D) {
    SECTION_COUNTER = 0;
    const children = [
        ...buildCover(D),
        ...buildTOC(),
        ...s_executiveSummary(D),
        ...s_companyOverview(D),
        ...s_decisionMaker(D),
        ...s_websiteAudit(D),
        ...s_websiteScore(D),
        ...s_aiOpportunities(D),
        ...s_websiteOpportunities(D),
        ...s_painPoints(D),
        ...s_buyingIntent(D),
        ...s_bestFirstOffer(D),
        ...s_salesStrategy(D),
        ...s_channels(D),
        ...s_whatsapp(D),
        ...s_coldEmail(D),
        ...s_linkedin(D),
        ...s_followUp(D),
        ...s_salesPsychology(D),
        ...s_objectionHandling(D),
        ...s_icebreakers(D),
        ...s_auditSummary(D),
        ...s_nextSteps(D),
        ...s_finalRecommendation(D),
    ];

    return new Document({
        creator: (D.meta && D.meta.analyst) || "Prospect Intelligence Engine",
        title: `${(D.lead && D.lead.company) || "Prospect"} — Prospect Intelligence Report`,
        description: "Prospect Intelligence Report generated with Node.js and docx.",
        styles: {
            default: {
                document: {
                    run: { font: THEME.fonts.body, size: THEME.sizes.body, color: THEME.colors.ink },
                    paragraph: { spacing: { line: THEME.spacing.line, after: THEME.spacing.sm } },
                },
            },
            paragraphStyles: [
                { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: THEME.sizes.h1, bold: true, color: THEME.colors.navy, font: THEME.fonts.heading }, paragraph: { spacing: { before: 150, after: 110 }, outlineLevel: 0 } },
                { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: THEME.sizes.h2, bold: true, color: THEME.colors.navyMid, font: THEME.fonts.heading }, paragraph: { spacing: { before: 120, after: 70 }, outlineLevel: 1 } },
            ],
        },
        sections: [
            {
                properties: { page: { margin: { top: 1200, right: 1080, bottom: 1200, left: 1080 } } },
                headers: { default: buildHeader(D) },
                footers: { default: buildFooter(D) },
                children,
            },
        ],
    });
}

function safeFileName(name) {
    return String(name || "Prospect").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

// Render a prospect_data object straight to a .docx file (used by the
// automated research pipeline). Returns the output path.
async function renderReport(data, outDir) {
    const targetDir = outDir || OUTPUT_DIR;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const doc = createDocument(data);
    const buffer = await Packer.toBuffer(doc);
    const company = (data.lead && data.lead.company) || "Prospect";
    const outPath = path.join(targetDir, `${safeFileName(company)}_Prospect_Intelligence_Report.docx`);
    fs.writeFileSync(outPath, buffer);
    return outPath;
}

async function generate() {
    ensureOutputDir();
    const { data, dataPath } = loadData();
    const outPath = await renderReport(data, OUTPUT_DIR);
    console.log("Prospect Intelligence Report created successfully.");
    console.log(`Data source: ${dataPath}`);
    console.log(`Output:      ${outPath}`);
}

module.exports = { createDocument, renderReport, safeFileName, THEME, OUTPUT_DIR };

if (require.main === module) {
    generate().catch((err) => {
        console.error("Failed to create document:", err);
        process.exit(1);
    });
}
