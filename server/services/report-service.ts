import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { PATHS, ensureDirs, appendLog } from "./paths";
import {
  durableReadJson,
  durableWriteJson,
  durableWriteFile,
  durableEnsureLocal,
  durableDelete,
  localAbs,
  blobEnabled,
} from "./durable-store";
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

const INDEX_REL = "index.json";

/** Serialize index mutations on this instance (void updateReport races were clobbering docxPath). */
let indexChain: Promise<unknown> = Promise.resolve();

function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexChain.then(fn, fn);
  indexChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function loadIndex(): Promise<IndexFile> {
  ensureDirs();
  return durableReadJson<IndexFile>(INDEX_REL, { reports: [], batches: [] });
}

/** Prefer newer updatedAt; never drop a report/batch that only exists on one side. */
function mergeIndex(remote: IndexFile, local: IndexFile): IndexFile {
  const reports = new Map<string, ReportRecord>();
  for (const r of remote.reports) reports.set(r.id, r);
  for (const r of local.reports) {
    const prev = reports.get(r.id);
    if (!prev || new Date(r.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()) {
      reports.set(r.id, r);
    }
  }
  const batches = new Map<string, BatchRecord>();
  for (const b of remote.batches) batches.set(b.id, b);
  for (const b of local.batches) {
    const prev = batches.get(b.id);
    if (!prev || new Date(b.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()) {
      batches.set(b.id, b);
    }
  }
  return {
    reports: [...reports.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
    batches: [...batches.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
  };
}

async function saveIndex(index: IndexFile, opts?: { dropReportIds?: string[] }) {
  // Re-read Blob before write so a parallel generate on another instance isn't wiped.
  const remote = await durableReadJson<IndexFile>(INDEX_REL, { reports: [], batches: [] });
  const merged = mergeIndex(remote, index);
  if (opts?.dropReportIds?.length) {
    const drop = new Set(opts.dropReportIds);
    merged.reports = merged.reports.filter((r) => !drop.has(r.id));
    for (const batch of merged.batches) {
      batch.reportIds = batch.reportIds.filter((rid) => !drop.has(rid));
    }
  }
  await durableWriteJson(INDEX_REL, merged);
}

export async function getDashboardStats() {
  const { reports } = await loadIndex();
  return {
    total: reports.length,
    queued: reports.filter((r) => r.status === "queued").length,
    processing: reports.filter((r) => r.status === "processing").length,
    completed: reports.filter((r) => r.status === "completed").length,
    failed: reports.filter((r) => r.status === "failed").length,
  };
}

export async function listReports(opts?: { q?: string; page?: number; pageSize?: number }) {
  const q = (opts?.q || "").toLowerCase().trim();
  const page = Math.max(1, opts?.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 20));
  let items = [...(await loadIndex()).reports].sort(
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

export async function getReport(id: string) {
  return (await loadIndex()).reports.find((r) => r.id === id) || null;
}

export async function getBatch(id: string) {
  return (await loadIndex()).batches.find((b) => b.id === id) || null;
}

export async function getReportJson(id: string): Promise<ProspectData | null> {
  const report = await getReport(id);
  if (!report?.jsonPath) return null;
  const local = await durableEnsureLocal(report.jsonPath);
  if (!local) return null;
  return JSON.parse(fs.readFileSync(local, "utf8")) as ProspectData;
}

export async function getReportDocxBuffer(id: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const report = await getReport(id);
  const candidates = [report?.docxPath, `reports/${id}.docx`].filter(Boolean) as string[];
  for (const rel of candidates) {
    const local = await durableEnsureLocal(rel);
    if (!local || !fs.existsSync(local)) continue;
    return { buffer: fs.readFileSync(local), filename: path.basename(local) };
  }
  return null;
}

export async function deleteReport(id: string) {
  return withIndexLock(async () => {
    const index = await loadIndex();
    const report = index.reports.find((r) => r.id === id);
    if (!report) return false;
    if (report.docxPath) await durableDelete(report.docxPath);
    if (report.jsonPath) await durableDelete(report.jsonPath);
    // Also try the stable key used by newer builds.
    await durableDelete(`reports/${id}.docx`);
    await durableDelete(`json/${id}.json`);
    index.reports = index.reports.filter((r) => r.id !== id);
    for (const batch of index.batches) {
      batch.reportIds = batch.reportIds.filter((rid) => rid !== id);
    }
    await saveIndex(index, { dropReportIds: [id] });
    appendLog("app", `Deleted report ${id}`);
    return true;
  });
}

async function updateReport(id: string, patch: Partial<ReportRecord>) {
  await withIndexLock(async () => {
    const index = await loadIndex();
    const i = index.reports.findIndex((r) => r.id === id);
    if (i < 0) return;
    const prev = index.reports[i];
    // Never let a stale progress patch wipe terminal state / file paths.
    if (
      (prev.status === "completed" || prev.status === "failed") &&
      patch.status &&
      patch.status !== "completed" &&
      patch.status !== "failed"
    ) {
      return;
    }
    index.reports[i] = {
      ...prev,
      ...patch,
      docxPath: patch.docxPath ?? prev.docxPath,
      jsonPath: patch.jsonPath ?? prev.jsonPath,
      updatedAt: new Date().toISOString(),
    };
    const batch = index.batches.find((b) => b.id === index.reports[i].batchId);
    if (batch) {
      const kids = index.reports.filter((r) => r.batchId === batch.id);
      batch.completed = kids.filter((r) => r.status === "completed").length;
      batch.failed = kids.filter((r) => r.status === "failed").length;
      batch.processing = kids.filter((r) => r.status === "processing").length;
      batch.queued = kids.filter((r) => r.status === "queued").length;
      if (batch.completed + batch.failed >= batch.total) {
        if (batch.failed && batch.completed === 0) batch.status = "failed";
        else if (batch.processing || batch.queued) batch.status = "processing";
        else batch.status = "completed";
      } else if (batch.processing > 0 || batch.completed > 0 || batch.failed > 0) {
        batch.status = "processing";
      }
      batch.updatedAt = new Date().toISOString();
    }
    await saveIndex(index);
  });
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

  const limit = options.limit ? Math.min(options.limit, records.length) : records.length;
  for (let i = 0; i < limit; i++) {
    leads.push(engine.mapRecordToLead(records[i], headers));
    rowIndexes.push(i + 1);
  }
  return { leads, rowIndexes };
}

export async function createBatchJob(input: {
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

  await withIndexLock(async () => {
    const index = await loadIndex();
    index.batches.unshift(batch);
    index.reports.unshift(...reports);
    await saveIndex(index);
  });

  const jobsRel = `jobs/${batchId}.leads.json`;
  await durableWriteJson(jobsRel, { leads, reportIds });

  appendLog(
    "jobs",
    `Batch ${batchId} created with ${leads.length} report(s)${blobEnabled() ? " [blob]" : ""}`
  );
  return { batch, reports };
}

export async function processNextInBatch(batchId: string): Promise<{ done: boolean; reportId?: string }> {
  const index = await loadIndex();
  const batch = index.batches.find((b) => b.id === batchId);
  if (!batch) return { done: true };

  const next = index.reports.find((r) => r.batchId === batchId && r.status === "queued");
  if (!next) {
    const stillProcessing = index.reports.some(
      (r) => r.batchId === batchId && r.status === "processing"
    );
    if (!stillProcessing) {
      const b = await getBatch(batchId);
      if (b && b.status !== "completed" && b.queued === 0 && b.processing === 0) {
        const idx = await loadIndex();
        const bi = idx.batches.findIndex((x) => x.id === batchId);
        if (bi >= 0) {
          idx.batches[bi].status =
            idx.batches[bi].failed && !idx.batches[bi].completed ? "failed" : "completed";
          idx.batches[bi].updatedAt = new Date().toISOString();
          await saveIndex(idx);
        }
      }
    }
    return { done: true };
  }

  const jobsRel = `jobs/${batchId}.leads.json`;
  const localJobs = await durableEnsureLocal(jobsRel);
  const payload = localJobs
    ? (JSON.parse(fs.readFileSync(localJobs, "utf8")) as { leads: Lead[]; reportIds: string[] })
    : { leads: [] as Lead[], reportIds: [] as string[] };
  const leadIndex = payload.reportIds.indexOf(next.id);
  const lead = payload.leads[leadIndex];
  if (!lead) {
    await updateReport(next.id, {
      status: "failed",
      stage: "failed",
      message: "Lead payload missing",
      error: "Lead payload missing",
      progress: 100,
    });
    return { done: false, reportId: next.id };
  }

  await updateReport(next.id, {
    status: "processing",
    stage: "researching",
    message: "Researching company...",
    progress: 10,
  });

  try {
    const timeout = batch.options.timeout || 12000;
    // Do not write the shared index on every progress tick — those races were
    // overwriting completed+docxPath (and could wipe sibling reports on Blob).
    const result = await engine.processLead(lead, {
      timeout,
      outDir: PATHS.reports(),
      jsonDir: PATHS.json(),
      saveJson: batch.options.saveJson !== false,
      onProgress: () => undefined,
    });

    const data = result.data;
    const jsonRel = `json/${next.id}.json`;
    await durableWriteFile(jsonRel, JSON.stringify(data, null, 2), "application/json; charset=utf-8");

    // Stable Blob key (company filename varies / is unsafe as the only key).
    const docxRel = `reports/${next.id}.docx`;
    const docxAbs = result.outPath;
    if (docxAbs && fs.existsSync(docxAbs)) {
      await durableWriteFile(
        docxRel,
        fs.readFileSync(docxAbs),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    } else {
      throw new Error("DOCX was not produced by the report engine");
    }

    await updateReport(next.id, {
      status: "completed",
      stage: "completed",
      message: "Completed",
      progress: 100,
      docxPath: docxRel,
      jsonPath: jsonRel,
      websiteScore: result.analysis.overallScore,
      firstOffer: result.strat.best.name,
      priority: result.strat.priority,
      confidence: result.strat.confidence,
      verdict: data.finalRecommendation?.verdict || data.executiveSummary?.verdict,
    });

    appendLog("jobs", `Report ${next.id} completed → ${docxRel}`);
    return { done: false, reportId: next.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    const incomplete = code === "INCOMPLETE_RESEARCH" || /incomplete research/i.test(error);
    await updateReport(next.id, {
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

export async function runBatch(batchId: string) {
  await withIndexLock(async () => {
    const idx = await loadIndex();
    const bi = idx.batches.findIndex((b) => b.id === batchId);
    if (bi >= 0) {
      idx.batches[bi].status = "processing";
      idx.batches[bi].updatedAt = new Date().toISOString();
      await saveIndex(idx);
    }
  });

  let guard = 0;
  while (guard < 10_000) {
    guard += 1;
    const { done } = await processNextInBatch(batchId);
    if (done) break;
  }
}

/** @deprecated local helper kept for typing */
export function _localAbsReports() {
  return localAbs("reports");
}
