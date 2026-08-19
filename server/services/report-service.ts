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
  durableListRelPaths,
  localAbs,
  blobEnabled,
} from "./durable-store";
import {
  engine,
  type Lead,
  type ProspectData,
  type ActionCard,
  type OutreachOutcome,
  type SendQueueStatus,
  type IcpProfile,
} from "./engine";
import { GTM } from "@/lib/gtm-defaults";

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
  /** PHASE 2.5/3.6 — additive. Reports stay visible in the same list/count; this only labels them. */
  bucket?: "STANDARD" | "NURTURE" | "DISQUALIFIED";
  /** Action-system fields (from actionCard). */
  decision?: "CONTACT" | "NURTURE" | "SKIP";
  reviewFlag?: boolean;
  emailSubject?: string;
  outreachOutcome?: OutreachOutcome;
  /** Browser send queue (Gmail compose flow). Default pending for CONTACT when unset. */
  sendQueueStatus?: SendQueueStatus;
  sentAt?: string;
  lastSendError?: string;
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
  /** PHASE 3.1 — optional, one-time-configurable ICP profile for this engagement. */
  icpProfile?: IcpProfile | Record<string, unknown>;
  /** Soft boost for preferred sellable offers (never hard-filters). */
  offerFocus?: string[];
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

/**
 * Recover reports whose .docx/.json exist in Blob but were dropped from index.json
 * (stale /tmp overwrites). Runs under the index lock.
 */
async function reconcileOrphanReports(): Promise<void> {
  if (!blobEnabled()) return;
  await withIndexLock(async () => {
    const index = await loadIndex();
    const known = new Set(index.reports.map((r) => r.id));
    const jsonPaths = await durableListRelPaths("json/");
    let added = 0;
    for (const rel of jsonPaths) {
      const m = /^json\/([^/]+)\.json$/.exec(rel);
      if (!m) continue;
      const id = m[1];
      if (known.has(id)) continue;
      const data = await durableReadJson<ProspectData>(rel, {});
      const lead = (data.lead || {}) as Lead;
      const now = new Date().toISOString();
      const docxRel = `reports/${id}.docx`;
      index.reports.unshift({
        id,
        batchId: "recovered",
        status: "completed",
        createdAt: now,
        updatedAt: now,
        company: String(lead.company || "Recovered report"),
        fullName: String(lead.fullName || ""),
        email: String(lead.email || ""),
        website: String(lead.website || data.websiteAudit?.analyzedUrl || ""),
        industry: String(lead.industry || ""),
        linkedin: String(lead.linkedin || ""),
        stage: "completed",
        message: "Recovered from Blob storage",
        progress: 100,
        websiteScore: data.websiteAudit?.overallScore,
        firstOffer: data.bestFirstOffer?.offer,
        priority: data.finalRecommendation?.priority || data.executiveSummary?.priority,
        confidence: undefined,
        verdict: data.finalRecommendation?.verdict || data.executiveSummary?.verdict,
        docxPath: docxRel,
        jsonPath: rel,
      });
      known.add(id);
      added += 1;
    }
    if (added > 0) {
      await saveIndex(index);
      appendLog("app", `Reconciled ${added} orphan report(s) from Blob`);
    }
  });
}

export async function getDashboardStats() {
  await reconcileOrphanReports();
  const { reports, batches } = await loadIndex();
  const completed = reports.filter((r) => r.status === "completed");
  const lastBatch = batches[0] || null;
  const lastBatchReports = lastBatch
    ? reports.filter((r) => r.batchId === lastBatch.id && r.status === "completed")
    : [];

  const countDecision = (list: ReportRecord[], d: string) =>
    list.filter((r) => (r.decision || "CONTACT") === d).length;

  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const TOUCHED = new Set(["sent", "replied", "meeting", "not_interested", "bounced"]);

  const withOutcome30d = completed.filter(
    (r) => r.outreachOutcome && new Date(r.outreachOutcome.updatedAt).getTime() >= since
  );
  const touched30d = withOutcome30d.filter((r) => TOUCHED.has(r.outreachOutcome!.status));
  const sent = touched30d.length;
  const replied = touched30d.filter((r) => r.outreachOutcome!.status === "replied").length;
  const meeting = touched30d.filter((r) => r.outreachOutcome!.status === "meeting").length;
  const not_interested = touched30d.filter((r) => r.outreachOutcome!.status === "not_interested").length;
  const bounced = touched30d.filter((r) => r.outreachOutcome!.status === "bounced").length;
  const replyRate = sent > 0 ? replied / sent : 0;
  const meetingRate = sent > 0 ? meeting / sent : 0;

  const byOfferMap = new Map<
    string,
    { offer: string; sent: number; replied: number; meeting: number }
  >();
  for (const r of touched30d) {
    const offer = (r.firstOffer || "Unassigned").trim() || "Unassigned";
    const row = byOfferMap.get(offer) || { offer, sent: 0, replied: 0, meeting: 0 };
    row.sent += 1;
    if (r.outreachOutcome!.status === "replied") row.replied += 1;
    if (r.outreachOutcome!.status === "meeting") row.meeting += 1;
    byOfferMap.set(offer, row);
  }
  const byOffer = [...byOfferMap.values()]
    .map((row) => ({
      ...row,
      replyRate: row.sent > 0 ? row.replied / row.sent : 0,
    }))
    .sort((a, b) => b.sent - a.sent);

  const ruleOf100Progress = completed.filter(
    (r) => r.outreachOutcome && TOUCHED.has(r.outreachOutcome.status)
  ).length;

  const queueable = completed.filter((r) => {
    const d = r.decision || "CONTACT";
    return d === "CONTACT" || d === "NURTURE";
  });

  const pendingInQueue = queueable.filter(
    (r) => r.decision === "CONTACT" && getEffectiveSendQueueStatus(r) === "pending"
  ).length;
  const openedGmail = queueable.filter((r) => getEffectiveSendQueueStatus(r) === "opened_gmail").length;
  const queueSent = queueable.filter((r) => getEffectiveSendQueueStatus(r) === "sent").length;

  const sendsToday = countSendsToday(completed);
  const nextUnlockAt = nextLocalMidnightIso();
  const dailyCap = GTM.dailySendCap;
  const softExtra = GTM.dailySendCapSoftExtra;
  const sendLocked = sendsToday >= dailyCap;
  const hardLocked = sendsToday >= dailyCap + softExtra;

  // Prefer last batch with pending CONTACTs for Continue CTA
  let continueBatchId: string | null = null;
  for (const b of batches) {
    const pending = reports.filter(
      (r) =>
        r.batchId === b.id &&
        r.status === "completed" &&
        r.decision === "CONTACT" &&
        getEffectiveSendQueueStatus(r) === "pending"
    );
    if (pending.length) {
      continueBatchId = b.id;
      break;
    }
  }

  // Also surface opened_gmail as continue target
  if (!continueBatchId) {
    for (const b of batches) {
      const opened = reports.filter(
        (r) =>
          r.batchId === b.id &&
          r.status === "completed" &&
          r.decision === "CONTACT" &&
          getEffectiveSendQueueStatus(r) === "opened_gmail"
      );
      if (opened.length) {
        continueBatchId = b.id;
        break;
      }
    }
  }

  return {
    total: reports.length,
    queued: reports.filter((r) => r.status === "queued").length,
    processing: reports.filter((r) => r.status === "processing").length,
    completed: completed.length,
    failed: reports.filter((r) => r.status === "failed").length,
    lastBatch: lastBatch
      ? {
          id: lastBatch.id,
          filename: lastBatch.filename,
          createdAt: lastBatch.createdAt,
          contact: countDecision(lastBatchReports, "CONTACT"),
          nurture: countDecision(lastBatchReports, "NURTURE"),
          skip: countDecision(lastBatchReports, "SKIP"),
          needsReview: lastBatchReports.filter((r) => r.reviewFlag).length,
          total: lastBatchReports.length,
        }
      : null,
    needsReview: completed.filter((r) => r.reviewFlag).length,
    outcomes30d: {
      sent,
      replied,
      meeting,
      not_interested,
      bounced,
      replyRate,
      meetingRate,
      byOffer,
    },
    ruleOf100: {
      target: GTM.ruleOf100Target,
      progress: ruleOf100Progress,
    },
    sendToday: {
      sendsToday,
      dailyCap,
      softExtra,
      sendLocked,
      hardLocked,
      nextUnlockAt,
      /** Counts use local calendar day; unlock is next local midnight. */
      timezoneNote: "local",
    },
    sendQueue: {
      pending: pendingInQueue,
      openedGmail,
      sent: queueSent,
      continueBatchId,
    },
  };
}

/** Local calendar-day midnight (ISO) for the next unlock window. */
export function nextLocalMidnightIso(from = new Date()): string {
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

function isLocalSameDay(iso: string, now = new Date()): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Confirmed Gmail sends today (prefer sentAt). Legacy: outcome=sent same day without queue status. */
export function countSendsToday(reports: ReportRecord[], now = new Date()): number {
  let n = 0;
  for (const r of reports) {
    if (r.sentAt && isLocalSameDay(r.sentAt, now) && (r.sendQueueStatus === "sent" || !r.sendQueueStatus)) {
      n += 1;
      continue;
    }
    if (
      !r.sentAt &&
      r.sendQueueStatus !== "opened_gmail" &&
      r.sendQueueStatus !== "pending" &&
      r.sendQueueStatus !== "skipped" &&
      r.sendQueueStatus !== "failed" &&
      r.outreachOutcome?.status === "sent" &&
      r.outreachOutcome.updatedAt &&
      isLocalSameDay(r.outreachOutcome.updatedAt, now)
    ) {
      n += 1;
    }
  }
  return n;
}

export function getEffectiveSendQueueStatus(r: ReportRecord): SendQueueStatus {
  if (r.sendQueueStatus) return r.sendQueueStatus;
  if (r.outreachOutcome?.status && r.outreachOutcome.status !== "not_sent") {
    if (r.outreachOutcome.status === "sent" || r.outreachOutcome.status === "replied" || r.outreachOutcome.status === "meeting") {
      return "sent";
    }
  }
  return "pending";
}

export function normalizeEmail(email: string | undefined | null): string {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function companyKey(company: string | undefined | null, website?: string | undefined | null): string {
  const c = String(company || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const w = String(website || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!c && !w) return "";
  return `${c}||${w}`;
}

function wasSuccessfullySent(r: ReportRecord): boolean {
  const sq = getEffectiveSendQueueStatus(r);
  if (sq === "sent") return true;
  const o = r.outreachOutcome?.status;
  return o === "sent" || o === "replied" || o === "meeting";
}

export type OverlapMatch = {
  leadEmail: string;
  leadCompany: string;
  reportId: string;
  batchId: string;
  company: string;
  email: string;
  createdAt: string;
  decision?: string;
  sendQueueStatus: SendQueueStatus;
  alreadySent: boolean;
};

/** Find completed reports that match the upcoming lead set (by email, else company+website). */
export async function findAnalysisOverlaps(leads: Lead[]): Promise<{
  alreadyAnalyzed: OverlapMatch[];
  alreadySent: OverlapMatch[];
  priorFilenameBatches: Array<{ id: string; filename: string; createdAt: string; total: number }>;
}> {
  await reconcileOrphanReports();
  const index = await loadIndex();
  const completed = index.reports.filter((r) => r.status === "completed");

  const byEmail = new Map<string, ReportRecord[]>();
  const byCompany = new Map<string, ReportRecord[]>();
  for (const r of completed) {
    const em = normalizeEmail(r.email);
    if (em) {
      const list = byEmail.get(em) || [];
      list.push(r);
      byEmail.set(em, list);
    }
    const ck = companyKey(r.company, r.website);
    if (ck) {
      const list = byCompany.get(ck) || [];
      list.push(r);
      byCompany.set(ck, list);
    }
  }

  const seenReportIds = new Set<string>();
  const alreadyAnalyzed: OverlapMatch[] = [];

  for (const lead of leads) {
    const em = normalizeEmail(lead.email as string);
    let matches: ReportRecord[] = [];
    if (em && byEmail.has(em)) matches = byEmail.get(em)!;
    else {
      const ck = companyKey(lead.company as string, lead.website as string);
      if (ck && byCompany.has(ck)) matches = byCompany.get(ck)!;
    }
    for (const r of matches) {
      if (seenReportIds.has(r.id)) continue;
      seenReportIds.add(r.id);
      alreadyAnalyzed.push({
        leadEmail: String(lead.email || ""),
        leadCompany: String(lead.company || ""),
        reportId: r.id,
        batchId: r.batchId,
        company: r.company,
        email: r.email,
        createdAt: r.createdAt,
        decision: r.decision,
        sendQueueStatus: getEffectiveSendQueueStatus(r),
        alreadySent: wasSuccessfullySent(r),
      });
    }
  }

  const alreadySent = alreadyAnalyzed.filter((m) => m.alreadySent);

  return { alreadyAnalyzed, alreadySent, priorFilenameBatches: [] };
}

/** Preview overlaps for a CSV selection without generating. */
export async function previewAnalysisOverlaps(input: {
  csvPath: string;
  options: GenerateOptions;
  filename?: string;
}) {
  const { leads } = resolveLeads(input.csvPath, input.options);
  const overlaps = await findAnalysisOverlaps(leads);

  let priorFilenameBatches: Array<{ id: string; filename: string; createdAt: string; total: number }> = [];
  if (input.filename) {
    const name = input.filename.trim().toLowerCase();
    const index = await loadIndex();
    priorFilenameBatches = index.batches
      .filter((b) => b.filename.trim().toLowerCase() === name)
      .slice(0, 5)
      .map((b) => ({ id: b.id, filename: b.filename, createdAt: b.createdAt, total: b.total }));
  }

  return {
    leadCount: leads.length,
    ...overlaps,
    priorFilenameBatches,
  };
}

/** Delete prior completed reports that match these leads (used when operator confirms replace).
 * Keeps reports that were already successfully emailed so send-queue dedupe still works. */
export async function replacePriorAnalysesForLeads(leads: Lead[]): Promise<{ deleted: string[]; keptSent: string[] }> {
  const { alreadyAnalyzed } = await findAnalysisOverlaps(leads);
  const toDelete: string[] = [];
  const keptSent: string[] = [];
  for (const m of alreadyAnalyzed) {
    if (m.alreadySent) keptSent.push(m.reportId);
    else toDelete.push(m.reportId);
  }
  const ids = [...new Set(toDelete)];
  if (!ids.length) return { deleted: [], keptSent: [...new Set(keptSent)] };
  const result = await deleteReports(ids);
  return { deleted: result.deleted, keptSent: [...new Set(keptSent)] };
}

/** Find another report (not currentId) where this email was already sent. */
export function findPriorSentReport(
  email: string,
  currentId: string,
  reports: ReportRecord[]
): ReportRecord | null {
  const em = normalizeEmail(email);
  if (!em) return null;
  return (
    reports.find(
      (r) => r.id !== currentId && normalizeEmail(r.email) === em && wasSuccessfullySent(r)
    ) || null
  );
}

export async function listReports(opts?: {
  q?: string;
  page?: number;
  pageSize?: number;
  decision?: string;
  reviewOnly?: boolean;
  batchId?: string;
  outcome?: string;
  sendQueueStatus?: string;
  offer?: string;
  reportIds?: string[];
}) {
  await reconcileOrphanReports();
  const q = (opts?.q || "").toLowerCase().trim();
  const page = Math.max(1, opts?.page || 1);
  const pageSize = Math.min(500, Math.max(1, opts?.pageSize || 20));
  let items = [...(await loadIndex()).reports].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  if (opts?.reportIds?.length) {
    const set = new Set(opts.reportIds);
    items = items.filter((r) => set.has(r.id));
  }
  if (opts?.batchId) {
    items = items.filter((r) => r.batchId === opts.batchId);
  }
  if (opts?.decision) {
    const d = opts.decision.toUpperCase();
    items = items.filter((r) => (r.decision || "").toUpperCase() === d);
  }
  if (opts?.reviewOnly) {
    items = items.filter((r) => !!r.reviewFlag);
  }
  if (opts?.outcome) {
    const o = opts.outcome.toLowerCase();
    items = items.filter((r) => (r.outreachOutcome?.status || "not_sent").toLowerCase() === o);
  }
  if (opts?.sendQueueStatus) {
    const s = opts.sendQueueStatus.toLowerCase();
    items = items.filter((r) => getEffectiveSendQueueStatus(r) === s);
  }
  if (opts?.offer) {
    const offer = opts.offer.toLowerCase().trim();
    items = items.filter((r) => (r.firstOffer || "").toLowerCase().includes(offer));
  }
  if (q) {
    items = items.filter(
      (r) =>
        r.company.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.industry.toLowerCase().includes(q) ||
        (r.firstOffer || "").toLowerCase().includes(q)
    );
  }
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize };
}

export type SendQueueItem = ReportRecord & {
  sendQueueStatus: SendQueueStatus;
  compose?: { to: string; subject: string; body: string; firstName?: string };
};

export async function getSendQueue(opts: {
  batchId?: string;
  reportIds?: string[];
  status?: string;
  includeNurture?: boolean;
  enrichEmail?: boolean;
  /** When true (default), auto-skip pending rows whose email was already sent on another report. */
  autoSkipAlreadySent?: boolean;
}): Promise<{
  items: SendQueueItem[];
  counts: { pending: number; opened_gmail: number; sent: number; skipped: number; failed: number; total: number };
  sendsToday: number;
  dailyCap: number;
  softExtra: number;
  sendLocked: boolean;
  hardLocked: boolean;
  nextUnlockAt: string;
  alreadySentExcluded: Array<{
    id: string;
    company: string;
    email: string;
    fullName: string;
    priorReportId: string;
    priorSentAt?: string;
  }>;
}> {
  await reconcileOrphanReports();
  const index = await loadIndex();
  let reports = index.reports.filter((r) => r.status === "completed");
  if (opts.batchId && opts.batchId !== "selection") {
    reports = reports.filter((r) => r.batchId === opts.batchId);
  }
  if (opts.reportIds?.length) {
    const set = new Set(opts.reportIds);
    reports = reports.filter((r) => set.has(r.id));
  }

  const allowed = new Set(opts.includeNurture ? ["CONTACT", "NURTURE"] : ["CONTACT"]);
  reports = reports.filter((r) => allowed.has((r.decision || "CONTACT").toUpperCase()));

  const allCompleted = index.reports.filter((r) => r.status === "completed");
  const alreadySentExcluded: Array<{
    id: string;
    company: string;
    email: string;
    fullName: string;
    priorReportId: string;
    priorSentAt?: string;
  }> = [];
  const autoSkip = opts.autoSkipAlreadySent !== false;

  for (const r of reports) {
    const status = getEffectiveSendQueueStatus(r);
    if (status !== "pending" && status !== "failed" && status !== "opened_gmail") continue;
    // Allow finishing an already-opened draft even if somehow duplicated
    if (status === "opened_gmail") continue;
    const prior = findPriorSentReport(r.email, r.id, allCompleted);
    if (!prior) continue;
    alreadySentExcluded.push({
      id: r.id,
      company: r.company,
      email: r.email,
      fullName: r.fullName,
      priorReportId: prior.id,
      priorSentAt: prior.sentAt || prior.outreachOutcome?.updatedAt,
    });
    if (autoSkip && status === "pending") {
      await updateReport(r.id, {
        sendQueueStatus: "skipped",
        lastSendError: `Already sent previously (${prior.company || prior.email})`,
      });
      r.sendQueueStatus = "skipped";
      r.lastSendError = `Already sent previously (${prior.company || prior.email})`;
    }
  }

  // Reload queue rows after possible skips
  if (alreadySentExcluded.length && autoSkip) {
    const fresh = await loadIndex();
    const idSet = new Set(reports.map((r) => r.id));
    reports = fresh.reports.filter((r) => idSet.has(r.id));
  }

  let items: SendQueueItem[] = reports.map((r) => ({
    ...r,
    sendQueueStatus: getEffectiveSendQueueStatus(r),
  }));

  if (opts.status && opts.status !== "all") {
    const s = opts.status.toLowerCase();
    items = items.filter((r) => r.sendQueueStatus === s);
  }

  items.sort((a, b) => {
    const order = { pending: 0, opened_gmail: 1, failed: 2, skipped: 3, sent: 4 } as const;
    const ao = order[a.sendQueueStatus] ?? 9;
    const bo = order[b.sendQueueStatus] ?? 9;
    if (ao !== bo) return ao - bo;
    return a.company.localeCompare(b.company);
  });

  if (opts.enrichEmail) {
    for (let i = 0; i < items.length; i++) {
      const data = await getReportJson(items[i].id);
      const card = data?.actionCard;
      if (card?.email) {
        items[i] = {
          ...items[i],
          compose: {
            to: card.email.to || items[i].email,
            subject: card.email.subject || items[i].emailSubject || "",
            body: card.email.body || "",
            firstName: card.email.firstName,
          },
        };
      }
    }
  }

  const allForCounts = reports.map((r) => ({
    ...r,
    sendQueueStatus: getEffectiveSendQueueStatus(r),
  }));
  const counts = {
    pending: allForCounts.filter((r) => r.sendQueueStatus === "pending").length,
    opened_gmail: allForCounts.filter((r) => r.sendQueueStatus === "opened_gmail").length,
    sent: allForCounts.filter((r) => r.sendQueueStatus === "sent").length,
    skipped: allForCounts.filter((r) => r.sendQueueStatus === "skipped").length,
    failed: allForCounts.filter((r) => r.sendQueueStatus === "failed").length,
    total: allForCounts.length,
  };

  const sendsToday = countSendsToday(index.reports.filter((r) => r.status === "completed"));
  const dailyCap = GTM.dailySendCap;
  const softExtra = GTM.dailySendCapSoftExtra;

  return {
    items,
    counts,
    sendsToday,
    dailyCap,
    softExtra,
    sendLocked: sendsToday >= dailyCap,
    hardLocked: sendsToday >= dailyCap + softExtra,
    nextUnlockAt: nextLocalMidnightIso(),
    alreadySentExcluded,
  };
}

export async function updateSendQueueStatus(
  id: string,
  patch: {
    status: SendQueueStatus;
    lastSendError?: string;
    /** When confirming sent while soft-locked, allow up to cap+softExtra. */
    allowSoftOvershoot?: boolean;
  }
): Promise<{ report: ReportRecord | null; error?: string; sendsToday?: number }> {
  const report = await getReport(id);
  if (!report) return { report: null, error: "Not found" };

  if (patch.status === "opened_gmail" || patch.status === "sent") {
    const indexEarly = await loadIndex();
    const prior = findPriorSentReport(
      report.email,
      id,
      indexEarly.reports.filter((r) => r.status === "completed")
    );
    if (prior) {
      return {
        report,
        error: `Already sent previously to ${prior.email || prior.company}. Skipped from send queue.`,
        sendsToday: countSendsToday(indexEarly.reports.filter((r) => r.status === "completed")),
      };
    }
  }

  const index = await loadIndex();
  const completed = index.reports.filter((r) => r.status === "completed");
  const sendsToday = countSendsToday(completed);
  const dailyCap = GTM.dailySendCap;
  const softExtra = GTM.dailySendCapSoftExtra;

  if (patch.status === "sent" && sendsToday >= dailyCap + softExtra) {
    return {
      report,
      error: `Daily send hard cap reached (${dailyCap + softExtra}). Next window: ${nextLocalMidnightIso()}`,
      sendsToday,
    };
  }
  if (patch.status === "opened_gmail" && sendsToday >= dailyCap) {
    return {
      report,
      error: `Daily send goal reached (${dailyCap}). Finish opened drafts only, or wait until ${nextLocalMidnightIso()}`,
      sendsToday,
    };
  }
  if (
    patch.status === "sent" &&
    report.sendQueueStatus !== "opened_gmail" &&
    sendsToday >= dailyCap &&
    !patch.allowSoftOvershoot
  ) {
    return {
      report,
      error: `Daily send goal reached (${dailyCap}). Next window unlocks at local midnight.`,
      sendsToday,
    };
  }

  const now = new Date().toISOString();
  const updates: Partial<ReportRecord> = {
    sendQueueStatus: patch.status,
    lastSendError: patch.lastSendError,
  };
  if (patch.status === "sent") {
    updates.sentAt = now;
  }

  await updateReport(id, updates);

  // Map to outreachOutcome for proof metrics (confirm sent only — not opened_gmail)
  if (patch.status === "sent") {
    const current = report.outreachOutcome?.status;
    const keep =
      current === "replied" || current === "meeting" || current === "not_interested" || current === "bounced";
    if (!keep) {
      await updateOutreachOutcome(id, {
        status: "sent",
        note: "Confirmed sent via browser queue",
      });
    }
  } else if (patch.status === "skipped") {
    const data = await getReportJson(id);
    if (data && report.jsonPath) {
      const nowIso = new Date().toISOString();
      data.outreachOutcome = {
        status: data.outreachOutcome?.status && data.outreachOutcome.status !== "not_sent"
          ? data.outreachOutcome.status
          : "not_sent",
        note: "Skipped in send queue",
        updatedAt: nowIso,
      };
      await durableWriteFile(report.jsonPath, JSON.stringify(data, null, 2), "application/json; charset=utf-8");
    }
  }

  return { report: await getReport(id), sendsToday: countSendsToday((await loadIndex()).reports.filter((r) => r.status === "completed")) };
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

/** Bulk delete for the "select multiple reports" UI. Never throws on a bad
 * id — collects per-id success/failure so the caller can report both. */
export async function deleteReports(ids: string[]): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const ok = await deleteReport(id);
      if (ok) deleted.push(id);
      else failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { deleted, failed };
}

/** Bundles the DOCX for each requested report id into a single .zip buffer
 * for the "download selected" bulk action. Skips (and reports) any id whose
 * DOCX isn't available instead of failing the whole download. */
export async function getReportsDocxZip(
  ids: string[]
): Promise<{ buffer: Buffer; filename: string; included: string[]; missing: string[] } | null> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const included: string[] = [];
  const missing: string[] = [];
  const usedNames = new Set<string>();

  for (const id of [...new Set(ids)]) {
    const file = await getReportDocxBuffer(id);
    if (!file) {
      missing.push(id);
      continue;
    }
    const report = await getReport(id);
    const base = (report?.company || path.basename(file.filename, ".docx") || id)
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim()
      .slice(0, 80) || id;
    let name = `${base}.docx`;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${base} (${n}).docx`;
      n += 1;
    }
    usedNames.add(name);
    zip.file(name, file.buffer);
    included.push(id);
  }

  if (included.length === 0) return null;
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const filename = `prospect-reports-${new Date().toISOString().slice(0, 10)}.zip`;
  return { buffer, filename, included, missing };
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
  // PHASE 3.7 — annotate contacts sharing a root domain. Purely informational:
  // every lead still gets its own report (no merging/dropping happens here).
  try {
    engine.annotateCompanyGroups(leads);
  } catch {
    /* best-effort annotation only */
  }
  return { leads, rowIndexes };
}

export async function createBatchJob(input: {
  csvUploadId: string;
  filename: string;
  csvPath: string;
  options: GenerateOptions;
  /** When true, delete prior completed reports that match these leads before creating the batch. */
  replaceExisting?: boolean;
}) {
  ensureDirs();
  const { leads, rowIndexes } = resolveLeads(input.csvPath, input.options);
  if (!leads.length) throw new Error("No leads selected for generation.");

  let replacedIds: string[] = [];
  if (input.replaceExisting) {
    const result = await replacePriorAnalysesForLeads(leads);
    replacedIds = result.deleted;
  }

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
    `Batch ${batchId} created with ${leads.length} report(s)${replacedIds.length ? `; replaced ${replacedIds.length} prior` : ""}${blobEnabled() ? " [blob]" : ""}`
  );
  return { batch, reports, replacedIds };
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
    const offerUsage = batchOfferUsage.get(batchId) || {};
    batchOfferUsage.set(batchId, offerUsage);

    const result = await engine.processLead(lead, {
      timeout,
      outDir: PATHS.reports(),
      jsonDir: PATHS.json(),
      saveJson: batch.options.saveJson !== false,
      icpProfile: batch.options.icpProfile,
      offerFocus: batch.options.offerFocus,
      offerUsageCounts: offerUsage,
      onProgress: () => undefined,
    });

    const data = result.data;
    const card = data.actionCard;
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
      message: card?.decision === "SKIP" ? `SKIP — ${card.skipReason || "skipped"}` : "Completed",
      progress: 100,
      docxPath: docxRel,
      jsonPath: jsonRel,
      websiteScore: result.analysis.overallScore,
      firstOffer: card?.firstOffer || result.strat.best.name,
      priority: card?.priority || result.strat.priority,
      confidence: card?.confidence ?? result.strat.confidence,
      verdict: data.finalRecommendation?.verdict || data.executiveSummary?.verdict,
      bucket: data.pipelineBucket || "STANDARD",
      decision: card?.decision,
      reviewFlag: !!card?.reviewFlag,
      emailSubject: card?.email?.subject,
    });

    appendLog("jobs", `Report ${next.id} completed → ${docxRel} (${card?.decision || "n/a"})`);
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

/** In-batch offer frequency for diversity re-rank (lives for the runBatch lifetime). */
const batchOfferUsage = new Map<string, Record<string, number>>();

export async function runBatch(batchId: string) {
  batchOfferUsage.set(batchId, batchOfferUsage.get(batchId) || {});
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
  batchOfferUsage.delete(batchId);
}

export async function updateOutreachOutcome(
  id: string,
  outcome: Omit<OutreachOutcome, "updatedAt"> & { updatedAt?: string }
): Promise<ReportRecord | null> {
  const report = await getReport(id);
  if (!report) return null;
  const full: OutreachOutcome = {
    status: outcome.status,
    note: outcome.note,
    updatedAt: outcome.updatedAt || new Date().toISOString(),
  };

  // Persist on JSON if present.
  const data = await getReportJson(id);
  if (data && report.jsonPath) {
    data.outreachOutcome = full;
    await durableWriteFile(report.jsonPath, JSON.stringify(data, null, 2), "application/json; charset=utf-8");
  }

  await updateReport(id, { outreachOutcome: full });
  return getReport(id);
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function actionFromData(data: ProspectData | null, report: ReportRecord): ActionCard | null {
  if (data?.actionCard) return data.actionCard;
  if (!report.decision && !data) return null;
  // Graceful degrade for pre-actionCard reports.
  return null;
}

export async function buildSequencerCsv(opts: {
  batchId?: string;
  reportIds?: string[];
  decisions?: Array<"CONTACT" | "NURTURE" | "SKIP">;
  includeSkip?: boolean;
}): Promise<{ csv: string; filename: string; rowCount: number; actionCards: ActionCard[] }> {
  const index = await loadIndex();
  let reports = index.reports.filter((r) => r.status === "completed");
  if (opts.batchId) reports = reports.filter((r) => r.batchId === opts.batchId);
  if (opts.reportIds?.length) {
    const set = new Set(opts.reportIds);
    reports = reports.filter((r) => set.has(r.id));
  }

  const decisions = new Set(
    (opts.decisions?.length
      ? opts.decisions
      : opts.includeSkip
        ? (["CONTACT", "NURTURE", "SKIP"] as const)
        : (["CONTACT"] as const)
    ).map((d) => d.toUpperCase())
  );

  const header = [
    "email",
    "firstName",
    "lastName",
    "company",
    "title",
    "website",
    "linkedin",
    "subject",
    "body",
    "offer",
    "whyNow",
    "priority",
    "confidence",
    "decision",
    "reportId",
  ];

  const lines = [header.join(",")];
  const cards: ActionCard[] = [];

  for (const report of reports) {
    const data = await getReportJson(report.id);
    const card = actionFromData(data, report);
    const decision = (card?.decision || report.decision || "").toUpperCase();
    if (!decision || !decisions.has(decision)) continue;
    if (decision === "SKIP" && !opts.includeSkip && !opts.decisions?.includes("SKIP")) continue;

    const lead = (data?.lead || {}) as Lead;
    const email = card?.email;
    const row = [
      email?.to || report.email || lead.email || "",
      email?.firstName || lead.firstName || "",
      lead.lastName || "",
      email?.company || report.company || lead.company || "",
      lead.title || "",
      report.website || lead.website || "",
      report.linkedin || lead.linkedin || "",
      email?.subject || report.emailSubject || "",
      email?.body || "",
      card?.firstOffer || report.firstOffer || "",
      card?.whyNow || "",
      card?.priority || report.priority || "",
      card?.confidence ?? report.confidence ?? "",
      decision,
      report.id,
    ].map(csvEscape);
    lines.push(row.join(","));
    if (card) cards.push(card);
  }

  const tag = [...decisions].sort().join("_") || "CONTACT";
  const stamp = opts.batchId || new Date().toISOString().slice(0, 10);
  return {
    csv: lines.join("\n") + "\n",
    filename: `sequencer_${tag}_${stamp}.csv`,
    rowCount: lines.length - 1,
    actionCards: cards,
  };
}

/** @deprecated local helper kept for typing */
export function _localAbsReports() {
  return localAbs("reports");
}
