import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { PATHS, ensureDirs, readJsonFile, writeJsonFile, appendLog } from "./paths";
import { engine, type Lead, type ProspectData } from "./engine";

export type ReportStatus = "queued" | "processing" | "completed" | "failed";

export type ReportRecord = {
  id: string;
  batchId: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  company: string;
  fullName: string;
  email: string;
  website: string;
  industry: string;
  linkedin: string;
  rowIndex?: number;
  stage: string;
  message: string;
  progress: number;
  websiteScore?: number;
  firstOffer?: string;
  priority?: string;
  confidence?: number;
  verdict?: string;
  docxPath?: string;
  jsonPath?: string;
  error?: string;
  stack?: string;
};

export type BatchRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  csvUploadId: string;
  filename: string;
  mode: "row" | "range" | "all" | "email" | "company";
  options: GenerateOptions;
  total: number;
  completed: number;
  failed: number;
  processing: number;
  queued: number;
  status: ReportStatus;
  reportIds: string[];
};

export type GenerateOptions = {
  row?: number;
  rowFrom?: number;
  rowTo?: number;
  all?: boolean;
  limit?: number;
  email?: string;
  company?: string;
  timeout?: number;
  saveJson?: boolean;
};

type IndexFile = {
  reports: ReportRecord[];
  batches: BatchRecord[];
};

function loadIndex(): IndexFile {
  ensureDirs();
  return readJsonFile<IndexFile>(PATHS.index(), { reports: [], batches: [] });
}

function saveIndex(index: IndexFile) {
  writeJsonFile(PATHS.index(), index);
}

export function getDashboardStats() {
  const { reports } = loadIndex();
  return {
    total: reports.length,
    queued: reports.filter((r) => r.status === "queued").length,
    processing: reports.filter((r) => r.status === "processing").length,
    completed: reports.filter((r) => r.status === "completed").length,
    failed: reports.filter((r) => r.status === "failed").length,
  };
}

export function listReports(opts?: { q?: string; page?: number; pageSize?: number }) {
  const q = (opts?.q || "").toLowerCase().trim();
  const page = Math.max(1, opts?.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 20));
  let items = [...loadIndex().reports].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  if (q) {
    items = items.filter(
      (r) =>
        r.company.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.industry.toLowerCase().includes(q)
    );
  }
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize };
}

export function getReport(id: string) {
  return loadIndex().reports.find((r) => r.id === id) || null;
}

export function getBatch(id: string) {
  return loadIndex().batches.find((b) => b.id === id) || null;
}

export function getReportJson(id: string): ProspectData | null {
  const report = getReport(id);
  if (!report?.jsonPath || !fs.existsSync(report.jsonPath)) return null;
  return JSON.parse(fs.readFileSync(report.jsonPath, "utf8")) as ProspectData;
}

export function deleteReport(id: string) {
  const index = loadIndex();
  const report = index.reports.find((r) => r.id === id);
  if (!report) return false;
  if (report.docxPath && fs.existsSync(report.docxPath)) fs.unlinkSync(report.docxPath);
  if (report.jsonPath && fs.existsSync(report.jsonPath)) fs.unlinkSync(report.jsonPath);
  index.reports = index.reports.filter((r) => r.id !== id);
  for (const batch of index.batches) {
    batch.reportIds = batch.reportIds.filter((rid) => rid !== id);
  }
  saveIndex(index);
  appendLog("app", `Deleted report ${id}`);
  return true;
}

function updateReport(id: string, patch: Partial<ReportRecord>) {
  const index = loadIndex();
  const i = index.reports.findIndex((r) => r.id === id);
  if (i < 0) return;
  index.reports[i] = { ...index.reports[i], ...patch, updatedAt: new Date().toISOString() };
  const batch = index.batches.find((b) => b.id === index.reports[i].batchId);
  if (batch) {
    const kids = index.reports.filter((r) => r.batchId === batch.id);
    batch.completed = kids.filter((r) => r.status === "completed").length;
    batch.failed = kids.filter((r) => r.status === "failed").length;
    batch.processing = kids.filter((r) => r.status === "processing").length;
    batch.queued = kids.filter((r) => r.status === "queued").length;
    if (batch.completed + batch.failed >= batch.total) {
      batch.status = batch.failed && !batch.completed ? "failed" : batch.failed ? "completed" : "completed";
      if (batch.failed && batch.completed === 0) batch.status = "failed";
      else if (batch.processing || batch.queued) batch.status = "processing";
      else batch.status = "completed";
    } else if (batch.processing > 0 || batch.completed > 0 || batch.failed > 0) {
      batch.status = "processing";
    }
    batch.updatedAt = new Date().toISOString();
  }
  saveIndex(index);
}

function resolveLeads(
  csvPath: string,
  options: GenerateOptions
): { leads: Lead[]; rowIndexes: number[] } {
  const { headers, records } = engine.readCSVObjects(csvPath);
  if (!records.length) throw new Error("CSV has no data rows.");

  const leads: Lead[] = [];
  const rowIndexes: number[] = [];

  if (options.email) {
    const rec = engine.selectRecord(records, { email: options.email });
    if (!rec) throw new Error(`No row matched email: ${options.email}`);
    leads.push(engine.mapRecordToLead(rec, headers));
    rowIndexes.push(records.indexOf(rec) + 1);
    return { leads, rowIndexes };
  }

  if (options.company) {
    const rec = engine.selectRecord(records, { company: options.company });
    if (!rec) throw new Error(`No row matched company: ${options.company}`);
    leads.push(engine.mapRecordToLead(rec, headers));
    rowIndexes.push(records.indexOf(rec) + 1);
    return { leads, rowIndexes };
  }

  if (options.row) {
    const rec = engine.selectRecord(records, { row: options.row });
    if (!rec) throw new Error(`No row at index ${options.row}`);
    leads.push(engine.mapRecordToLead(rec, headers));
    rowIndexes.push(options.row);
    return { leads, rowIndexes };
  }

  if (options.rowFrom && options.rowTo) {
    const from = Math.max(1, options.rowFrom);
    const to = Math.min(records.length, options.rowTo);
    for (let i = from; i <= to; i++) {
      leads.push(engine.mapRecordToLead(records[i - 1], headers));
      rowIndexes.push(i);
    }
    return { leads, rowIndexes };
  }

  // --all (default when no row selector)
  const limit = options.limit ? Math.min(options.limit, records.length) : records.length;
  for (let i = 0; i < limit; i++) {
    leads.push(engine.mapRecordToLead(records[i], headers));
    rowIndexes.push(i + 1);
  }
  return { leads, rowIndexes };
}

export function createBatchJob(input: {
  csvUploadId: string;
  filename: string;
  csvPath: string;
  options: GenerateOptions;
}) {
  ensureDirs();
  const { leads, rowIndexes } = resolveLeads(input.csvPath, input.options);
  if (!leads.length) throw new Error("No leads selected for generation.");

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const reportIds: string[] = [];
  const reports: ReportRecord[] = leads.map((lead, i) => {
    const id = randomUUID();
    reportIds.push(id);
    return {
      id,
      batchId,
      status: "queued" as const,
      createdAt: now,
      updatedAt: now,
      company: lead.company || "Unknown",
      fullName: lead.fullName || "",
      email: (lead.email as string) || "",
      website: (lead.website as string) || "",
      industry: (lead.industry as string) || "",
      linkedin: (lead.linkedin as string) || "",
      rowIndex: rowIndexes[i],
      stage: "queued",
      message: "Queued",
      progress: 0,
    };
  });

  const mode: BatchRecord["mode"] = input.options.email
    ? "email"
    : input.options.company
      ? "company"
      : input.options.row
        ? "row"
        : input.options.rowFrom
          ? "range"
          : "all";

  const batch: BatchRecord = {
    id: batchId,
    createdAt: now,
    updatedAt: now,
    csvUploadId: input.csvUploadId,
    filename: input.filename,
    mode,
    options: { ...input.options, saveJson: input.options.saveJson !== false },
    total: leads.length,
    completed: 0,
    failed: 0,
    processing: 0,
    queued: leads.length,
    status: "queued",
    reportIds,
  };

  const index = loadIndex();
  index.batches.unshift(batch);
  index.reports.unshift(...reports);
  saveIndex(index);

  // Persist lead payloads for the worker (avoid re-parsing mid-job drift)
  writeJsonFile(path.join(PATHS.jobs(), `${batchId}.leads.json`), { leads, reportIds });

  appendLog("jobs", `Batch ${batchId} created with ${leads.length} report(s)`);
  return { batch, reports };
}

/** Process one queued report inside a batch. Safe to call repeatedly. */
export async function processNextInBatch(batchId: string): Promise<{ done: boolean; reportId?: string }> {
  const index = loadIndex();
  const batch = index.batches.find((b) => b.id === batchId);
  if (!batch) return { done: true };

  const next = index.reports.find((r) => r.batchId === batchId && r.status === "queued");
  if (!next) {
    const stillProcessing = index.reports.some(
      (r) => r.batchId === batchId && r.status === "processing"
    );
    if (!stillProcessing) {
      updateReport(batch.reportIds[0], {}); // refresh batch rollup via side effect if needed
      const b = getBatch(batchId);
      if (b && b.status !== "completed" && b.queued === 0 && b.processing === 0) {
        const idx = loadIndex();
        const bi = idx.batches.findIndex((x) => x.id === batchId);
        if (bi >= 0) {
          idx.batches[bi].status = idx.batches[bi].failed && !idx.batches[bi].completed ? "failed" : "completed";
          idx.batches[bi].updatedAt = new Date().toISOString();
          saveIndex(idx);
        }
      }
    }
    return { done: true };
  }

  const leadsFile = path.join(PATHS.jobs(), `${batchId}.leads.json`);
  const payload = readJsonFile<{ leads: Lead[]; reportIds: string[] }>(leadsFile, {
    leads: [],
    reportIds: [],
  });
  const leadIndex = payload.reportIds.indexOf(next.id);
  const lead = payload.leads[leadIndex];
  if (!lead) {
    updateReport(next.id, {
      status: "failed",
      stage: "failed",
      message: "Lead payload missing",
      error: "Lead payload missing",
      progress: 100,
    });
    return { done: false, reportId: next.id };
  }

  updateReport(next.id, {
    status: "processing",
    stage: "researching",
    message: "Researching company...",
    progress: 10,
  });

  try {
    const timeout = batch.options.timeout || 12000;
    const result = await engine.processLead(lead, {
      timeout,
      outDir: PATHS.reports(),
      jsonDir: PATHS.json(),
      saveJson: batch.options.saveJson !== false,
      onProgress: (stage, message) => {
        const progressMap: Record<string, number> = {
          researching: 35,
          analyzing: 65,
          generating: 85,
          completed: 100,
        };
        updateReport(next.id, {
          stage,
          message,
          progress: progressMap[stage] ?? 50,
        });
      },
    });

    const data = result.data;
    const jsonPath =
      (data as { _jsonPath?: string })._jsonPath ||
      path.join(PATHS.json(), path.basename(result.outPath).replace(/\.docx$/i, "") + "_prospect_data.json");

    // pipeline already wrote JSON with company-based name; locate it
    let resolvedJson = (data as { _jsonPath?: string })._jsonPath;
    if (!resolvedJson || !fs.existsSync(resolvedJson)) {
      const candidate = path.join(
        PATHS.json(),
        `${(lead.company || "Prospect").replace(/[^a-z0-9]+/gi, "_")}_prospect_data.json`
      );
      if (fs.existsSync(candidate)) resolvedJson = candidate;
    }

    // Prefer unique per-report JSON to avoid collisions on same company
    const uniqueJson = path.join(PATHS.json(), `${next.id}.json`);
    fs.writeFileSync(uniqueJson, JSON.stringify(data, null, 2));

    updateReport(next.id, {
      status: "completed",
      stage: "completed",
      message: "Completed",
      progress: 100,
      docxPath: result.outPath,
      jsonPath: uniqueJson,
      websiteScore: result.analysis.overallScore,
      firstOffer: result.strat.best.name,
      priority: result.strat.priority,
      confidence: result.strat.confidence,
      verdict: data.finalRecommendation?.verdict || data.executiveSummary?.verdict,
    });

    appendLog("jobs", `Report ${next.id} completed → ${path.basename(result.outPath)}`);
    return { done: false, reportId: next.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    const incomplete = code === "INCOMPLETE_RESEARCH" || /incomplete research/i.test(error);
    updateReport(next.id, {
      status: "failed",
      stage: incomplete ? "incomplete_research" : "failed",
      message: incomplete ? "Incomplete research — website could not be loaded" : error,
      error,
      stack,
      progress: 100,
    });
    appendLog("jobs", `Report ${next.id} failed: ${error}`);
    return { done: false, reportId: next.id };
  }
}

/** Drain an entire batch sequentially (used by background worker). */
export async function runBatch(batchId: string) {
  // mark batch processing
  const idx = loadIndex();
  const bi = idx.batches.findIndex((b) => b.id === batchId);
  if (bi >= 0) {
    idx.batches[bi].status = "processing";
    idx.batches[bi].updatedAt = new Date().toISOString();
    saveIndex(idx);
  }

  let guard = 0;
  while (guard < 10_000) {
    guard += 1;
    const { done } = await processNextInBatch(batchId);
    if (done) break;
  }
}
