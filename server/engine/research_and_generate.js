/**
 * Prospect Intelligence — CLI entry (unchanged behaviour).
 *
 *   CSV/Excel lead  ->  auto research  ->  website analysis  ->  sales strategy  ->  DOCX report
 *
 * Usage:
 *   node research_and_generate.js --csv "..\11.4_sample_20rows.csv" --row 1
 *   node research_and_generate.js --csv leads.csv --email jane@acme.com
 *   node research_and_generate.js --csv leads.csv --company "Acme"
 *   node research_and_generate.js --csv leads.csv --all --limit 10
 *   node research_and_generate.js --json my_single_lead.json
 *
 * Options: --csv --row --email --company --all --limit --json --timeout --save-json
 */

const fs = require("fs");
const path = require("path");

const { readCSVObjects, mapRecordToLead, selectRecord } = require("./lib/csv");
const { processLead } = require("./pipeline");
const { OUTPUT_DIR } = require("./Prospect_Intelligence_Report_Generator");

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith("--")) {
                args[key] = next;
                i++;
            } else {
                args[key] = true;
            }
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv);
    const opts = {
        timeout: parseInt(args.timeout, 10) || 12000,
        saveJson: !!args["save-json"],
        outDir: OUTPUT_DIR,
        jsonDir: OUTPUT_DIR,
    };

    let leads = [];

    if (args.json) {
        const raw = JSON.parse(fs.readFileSync(path.resolve(args.json), "utf8"));
        leads = [raw.lead ? raw.lead : raw];
    } else if (args.csv) {
        const csvPath = path.resolve(args.csv);
        if (!fs.existsSync(csvPath)) {
            console.error(`CSV not found: ${csvPath}`);
            process.exit(1);
        }
        const { headers, records } = readCSVObjects(csvPath);
        if (!records.length) {
            console.error("CSV has no data rows.");
            process.exit(1);
        }
        console.log(`Loaded ${records.length} rows from ${path.basename(csvPath)}.`);

        if (args.all) {
            const limit = args.limit ? parseInt(args.limit, 10) : records.length;
            leads = records.slice(0, limit).map((r) => mapRecordToLead(r, headers));
        } else {
            const rec = selectRecord(records, { row: args.row, email: args.email, company: args.company });
            if (!rec) {
                console.error("No matching row found for the given selector.");
                process.exit(1);
            }
            leads = [mapRecordToLead(rec, headers)];
        }
    } else {
        console.error("Provide --csv <path> (with --row/--email/--company/--all) or --json <path>.");
        console.error('Example: node research_and_generate.js --csv "..\\11.4_sample_20rows.csv" --row 1');
        process.exit(1);
    }

    const outputs = [];
    for (const lead of leads) {
        try {
            console.log(`\n► Researching: ${lead.fullName || "(no name)"} @ ${lead.company || "(no company)"}`);
            if (lead.website) console.log(`  website: ${lead.website}`);
            const result = await processLead(lead, {
                ...opts,
                onProgress: (stage, message) => {
                    if (stage === "researching" || stage === "analyzing" || stage === "generating" || stage === "completed") {
                        console.log(`  ${message}`);
                    }
                },
            });
            console.log(`  report: ${result.outPath}`);
            outputs.push(result.outPath);
        } catch (e) {
            console.error(`  ! failed for ${lead.company || lead.fullName}: ${e.message}`);
        }
    }

    console.log(`\nDone. ${outputs.length} report(s) generated in ${OUTPUT_DIR}`);
}

module.exports = { processLead, parseArgs };

if (require.main === module) {
    main().catch((err) => {
        console.error("Pipeline failed:", err);
        process.exit(1);
    });
}
