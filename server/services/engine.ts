/**
 * Thin TypeScript facade over the CommonJS engine bridge.
 * Does NOT reimplement CSV / research / strategy / DOCX.
 */

export type Lead = {
  fullName: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  email?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  companyLinkedin?: string;
  facebook?: string;
  instagram?: string;
  twitter?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  [key: string]: unknown;
};

export type ProspectData = {
  lead?: Lead;
  executiveSummary?: {
    verdict?: string;
    priority?: string;
    paragraphs?: string[];
    keyFacts?: [string, string][];
  };
  websiteAudit?: {
    overallScore?: number;
    summary?: string;
    analyzedUrl?: string;
    sections?: [string, number, string][];
    pages?: [string, string][];
  };
  companyOverview?: Record<string, unknown>;
  salesStrategy?: Record<string, string>;
  messages?: Record<string, unknown>;
  aiOpportunities?: { name?: string; description?: string; priority?: string }[];
  icebreakers?: string[];
  nextSteps?: string[];
  decisionMaker?: Record<string, unknown>;
  salesPsychology?: Record<string, unknown>;
  channels?: [string, number, string][];
  buyingIntent?: [string, number][];
  bestFirstOffer?: { offer?: string; why?: string };
  finalRecommendation?: {
    verdict?: string;
    priority?: string;
    confidence?: number | string;
    channel?: string;
    firstOffer?: string;
    nextStep?: string;
    reasoning?: string;
  };
  painPoints?: { pain: string; evidence: string; impact: string }[];
  [key: string]: unknown;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bridge = require("./engine-bridge.cjs") as {
  readCSVObjects: (filePath: string) => { headers: string[]; records: Record<string, string>[] };
  mapRecordToLead: (record: Record<string, string>, headers: string[]) => Lead;
  selectRecord: (
    records: Record<string, string>[],
    opts: { row?: string | number; email?: string; company?: string }
  ) => Record<string, string> | undefined;
  isIndexLike: (v: string) => boolean;
  isIgnoredHeader: (h: string) => boolean;
  processLead: (
    lead: Lead,
    opts?: {
      timeout?: number;
      outDir?: string;
      jsonDir?: string;
      saveJson?: boolean;
      onProgress?: (stage: string, message: string, extra?: Record<string, unknown>) => void;
    }
  ) => Promise<{
    outPath: string;
    data: ProspectData;
    analysis: { overallScore: number };
    strat: { best: { name: string }; priority: string; confidence: number };
    research: unknown;
  }>;
};

export const engine = {
  readCSVObjects: bridge.readCSVObjects,
  mapRecordToLead: bridge.mapRecordToLead,
  selectRecord: bridge.selectRecord,
  isIndexLike: bridge.isIndexLike,
  isIgnoredHeader: bridge.isIgnoredHeader,
  processLead: bridge.processLead,
};
