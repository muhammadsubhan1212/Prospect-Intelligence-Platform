/**
 * CommonJS bridge so Next.js does not try to bundle / rewrite the engine.
 * All research / CSV / DOCX logic stays in ../engine (unchanged).
 */

const csv = require("../engine/lib/csv");
const { processLead } = require("../engine/pipeline");
// PHASE 3.7 — lead-to-lead deduplication (additive; safe no-op fallback).
let dedupe = { annotateCompanyGroups: (leads) => leads, reconcileCompanyVerdict: () => null };
try {
  dedupe = require("../engine/lib/dedupe");
} catch {
  /* keep no-op defaults above */
}

module.exports = {
  readCSVObjects: csv.readCSVObjects,
  mapRecordToLead: csv.mapRecordToLead,
  selectRecord: csv.selectRecord,
  isIndexLike: csv.isIndexLike,
  isIgnoredHeader: csv.isIgnoredHeader,
  parseCSV: csv.parseCSV,
  cleanPhone: csv.cleanPhone,
  processLead,
  annotateCompanyGroups: dedupe.annotateCompanyGroups,
  reconcileCompanyVerdict: dedupe.reconcileCompanyVerdict,
};
