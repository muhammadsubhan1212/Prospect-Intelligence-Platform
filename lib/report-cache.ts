/** Browser cache so a just-generated report opens even if the next serverless instance can't see Blob yet. */

export type CachedReportPayload = {
  report: {
    id: string;
    status: string;
    createdAt: string;
    company: string;
    fullName: string;
    email: string;
    website: string;
    industry: string;
    linkedin: string;
    websiteScore?: number;
    firstOffer?: string;
    priority?: string;
    confidence?: number;
    verdict?: string;
    error?: string;
    stack?: string;
    [key: string]: unknown;
  };
  data?: unknown;
};

function key(id: string) {
  return `prospect_report_${id}`;
}

export function cacheReport(payload: CachedReportPayload) {
  try {
    sessionStorage.setItem(key(payload.report.id), JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export function cacheReportsFromGenerate(json: {
  reports?: Array<CachedReportPayload["report"] & { data?: unknown }>;
}) {
  for (const r of json.reports || []) {
    const { data, ...report } = r;
    cacheReport({ report, data });
  }
}

export function loadCachedReport(id: string): CachedReportPayload | null {
  try {
    const raw = sessionStorage.getItem(key(id));
    if (!raw) return null;
    return JSON.parse(raw) as CachedReportPayload;
  } catch {
    return null;
  }
}
