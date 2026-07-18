/**
 * CommonJS bridge so Next.js does not try to bundle / rewrite the engine.
 * All research / CSV / DOCX logic stays in ../engine (unchanged).
 */

const csv = require("../engine/lib/csv");
const { processLead } = require("../engine/pipeline");

module.exports = {
  readCSVObjects: csv.readCSVObjects,
  mapRecordToLead: csv.mapRecordToLead,
  selectRecord: csv.selectRecord,
  isIndexLike: csv.isIndexLike,
  isIgnoredHeader: csv.isIgnoredHeader,
  parseCSV: csv.parseCSV,
  cleanPhone: csv.cleanPhone,
  processLead,
};
