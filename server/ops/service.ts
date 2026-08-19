import fs from "fs";
import path from "path";
import { engine, type ActionCard, type Lead, type ProspectData } from "@/server/services/engine";
import { durableDelete, durableEnsureLocal, durableWriteFile, durableWriteJson } from "@/server/services/durable-store";
import { PATHS } from "@/server/services/paths";
import { getReportJson, listReports } from "@/server/services/report-service";
import { GTM } from "@/lib/gtm-defaults";
import type { ActionCardData } from "@/components/action-card-panel";
import {
  newActivityId,
  newAllocBatchId,
  newAllocId,
  newImportId,
  newLeadId,
  newOperatorId,
} from "./ids";
import {
  locationFrom,
  normalizeCompany,
  normalizeDomain,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from "./normalize";
import {
  loadActivities,
  loadAllocations,
  loadAudits,
  loadImports,
  loadLeads,
  loadOperators,
  saveActivities,
  saveAllocations,
  saveAudits,
  saveImports,
  saveLeads,
  saveOperators,
  withOpsLock,
  writeOpsFile,
} from "./store";
import type { Activity, ActivityType, LeadStatus, MasterLead, Operator } from "./types";
import { buildAuditDocument, renderAuditHtml } from "./audit";

function nowIso() {
  return new Date().toISOString();
}

function todayStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isToday(iso?: string | null) {
  if (!iso) return false;
  return todayStamp(new Date(iso)) === todayStamp();
}

type Idx = {
  email: Map<string, MasterLead>;
  phone: Map<string, MasterLead>;
  companyEmail: Map<string, MasterLead>;
  domainName: Map<string, MasterLead>;
};

function buildIdx(leads: MasterLead[]): Idx {
  const idx: Idx = { email: new Map(), phone: new Map(), companyEmail: new Map(), domainName: new Map() };
  for (const lead of leads) addToIdx(lead, idx);
  return idx;
}

function addToIdx(lead: MasterLead, idx: Idx) {
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone);
  const company = normalizeCompany(lead.company);
  const domain = normalizeDomain(lead.website);
  const name = normalizeName(lead.name);
  if (email) idx.email.set(email, lead);
  if (phone) idx.phone.set(phone, lead);
  if (company && email) idx.companyEmail.set(`${company}|${email}`, lead);
  if (domain && name) idx.domainName.set(`${domain}|${name}`, lead);
}

function findDup(row: MasterLead, idx: Idx): MasterLead | null {
  const email = normalizeEmail(row.email);
  const phone = normalizePhone(row.phone);
  const company = normalizeCompany(row.company);
  const domain = normalizeDomain(row.website);
  const name = normalizeName(row.name);
  if (email && idx.email.has(email)) return idx.email.get(email)!;
  if (phone && idx.phone.has(phone)) return idx.phone.get(phone)!;
  if (company && email && idx.companyEmail.has(`${company}|${email}`)) {
    return idx.companyEmail.get(`${company}|${email}`)!;
  }
  if (domain && name && idx.domainName.has(`${domain}|${name}`)) return idx.domainName.get(`${domain}|${name}`)!;
  return null;
}

function fromEngineLead(mapped: Lead, source: string, importId: string): MasterLead | null {
  const name = String(mapped.fullName || "").trim();
  const company = String(mapped.company || "").trim();
  const email = normalizeEmail(mapped.email);
  const phone = String(mapped.phone || "").trim();
  if (!name && !company && !email && !phone) return null;
  const ts = nowIso();
  return {
    id: newLeadId(),
    name: name || company || email || "Unknown",
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    company,
    title: mapped.title,
    email: email || undefined,
    phone: phone || undefined,
    website: mapped.website,
    linkedin: mapped.linkedin,
    location: locationFrom({ city: mapped.city, state: mapped.state, country: mapped.country }),
    city: mapped.city,
    state: mapped.state,
    country: mapped.country,
    industry: mapped.industry,
    source: source,
    importId,
    status: "not_contacted",
    assignedTo: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

async function logActivity(partial: Omit<Activity, "id" | "timestamp"> & { timestamp?: string }) {
  const file = await loadActivities();
  file.activities.push({
    id: newActivityId(),
    timestamp: partial.timestamp || nowIso(),
    leadId: partial.leadId,
    userId: partial.userId,
    type: partial.type,
    metadata: partial.metadata,
  });
  if (file.activities.length > 20000) file.activities = file.activities.slice(-15000);
  await saveActivities(file);
}

function ingestRecords(
  records: Record<string, string>[],
  headers: string[],
  source: string,
  importId: string,
  leadsFile: { leads: MasterLead[] }
) {
  const idx = buildIdx(leadsFile.leads);
  let newLeads = 0;
  let alreadyExisting = 0;
  let invalidRows = 0;
  const duplicateSamples: { row: number; email?: string; company?: string; matchedId: string }[] = [];

  for (let i = 0; i < records.length; i++) {
    const mapped = engine.mapRecordToLead(records[i], headers);
    const draft = fromEngineLead(mapped, source, importId);
    if (!draft) {
      invalidRows += 1;
      continue;
    }
    const existing = findDup(draft, idx);
    if (existing) {
      alreadyExisting += 1;
      if (duplicateSamples.length < 40) {
        duplicateSamples.push({ row: i + 1, email: draft.email, company: draft.company, matchedId: existing.id });
      }
      continue;
    }
    leadsFile.leads.push(draft);
    addToIdx(draft, idx);
    newLeads += 1;
  }
  return { newLeads, alreadyExisting, invalidRows, duplicateSamples };
}

export async function importMasterCsv(file: { name: string; arrayBuffer: () => Promise<ArrayBuffer> }) {
  const buf = Buffer.from(await file.arrayBuffer());
  const importId = newImportId();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const rel = `ops/imports/${importId}_${safe}`;
  await durableWriteFile(rel, buf, "text/csv; charset=utf-8");
  const csvPath = await durableEnsureLocal(rel);
  if (!csvPath) throw new Error("Could not store CSV");
  const parsed = engine.readCSVObjects(csvPath);
  return importMasterRecords({
    filename: file.name,
    headers: parsed.headers,
    records: parsed.records,
    importId,
    storedPath: rel,
  });
}

/** Chunk-safe import used on Vercel (each part stays under the function payload limit). */
export async function importMasterRecords(input: {
  filename: string;
  headers: string[];
  records: Record<string, string>[];
  importId?: string;
  storedPath?: string;
  partLabel?: string;
}) {
  return withOpsLock(async () => {
    const headers = input.headers || [];
    const records = input.records || [];
    if (!headers.length) {
      throw new Error("Could not read CSV headers. Save the file as CSV (not Excel) and try again.");
    }
    const imports = await loadImports();
    let rec = input.importId ? imports.imports.find((i) => i.id === input.importId) : undefined;
    const importId = rec?.id || input.importId || newImportId();
    const leadsFile = await loadLeads();
    const stats = ingestRecords(records, headers, input.filename, importId, leadsFile);
    await saveLeads(leadsFile);

    if (rec) {
      rec.totalRows += records.length;
      rec.newLeads += stats.newLeads;
      rec.alreadyExisting += stats.alreadyExisting;
      rec.invalidRows += stats.invalidRows;
    } else {
      rec = {
        id: importId,
        filename: input.filename,
        createdAt: nowIso(),
        totalRows: records.length,
        newLeads: stats.newLeads,
        alreadyExisting: stats.alreadyExisting,
        invalidRows: stats.invalidRows,
        storedPath: input.storedPath,
      };
      imports.imports.unshift(rec);
    }
    await saveImports(imports);
    await logActivity({
      type: "lead_imported",
      metadata: {
        importId,
        filename: input.filename,
        partLabel: input.partLabel,
        newLeads: stats.newLeads,
        alreadyExisting: stats.alreadyExisting,
        invalidRows: stats.invalidRows,
        totalRows: records.length,
      },
    });
    return { ...rec, ...stats, partLabel: input.partLabel };
  });
}

export async function listMasterLeads(opts: {
  q?: string;
  status?: string;
  assignedTo?: string;
  available?: boolean;
  importId?: string;
  page?: number;
  pageSize?: number;
}) {
  const { leads } = await loadLeads();
  const { allocations } = await loadAllocations();
  const taken = new Set(allocations.map((a) => a.leadId));
  const q = (opts.q || "").trim().toLowerCase();
  let rows = leads;
  if (q) {
    rows = rows.filter((l) =>
      [l.name, l.company, l.email, l.phone, l.website, l.title, l.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  if (opts.status) rows = rows.filter((l) => l.status === opts.status);
  if (opts.assignedTo) rows = rows.filter((l) => l.assignedTo === opts.assignedTo);
  if (opts.importId) rows = rows.filter((l) => l.importId === opts.importId);
  if (opts.available) rows = rows.filter((l) => !taken.has(l.id));
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize || 50));
  const { operators } = await loadOperators();
  const names = new Map(operators.map((o) => [o.id, o.name]));
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize).map((l) => ({
      ...l,
      allocated: taken.has(l.id),
      assignedName: l.assignedTo ? names.get(l.assignedTo) || l.assignedTo : null,
    })),
    total: rows.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
  };
}

export async function getMasterLead(id: string) {
  const { leads } = await loadLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return null;
  const { allocations } = await loadAllocations();
  const { operators } = await loadOperators();
  const { activities } = await loadActivities();
  const { audits } = await loadAudits();
  return {
    lead,
    allocated: allocations.some((a) => a.leadId === id),
    allocationHistory: allocations.filter((a) => a.leadId === id),
    assignedName: lead.assignedTo ? operators.find((o) => o.id === lead.assignedTo)?.name : null,
    activities: activities.filter((a) => a.leadId === id).slice(-120).reverse(),
    audits: audits.filter((a) => a.leadId === id),
    actionCard: await resolveActionCard(lead),
  };
}

const LEAD_EDIT_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "company",
  "title",
  "email",
  "phone",
  "website",
  "linkedin",
  "location",
  "city",
  "state",
  "country",
  "industry",
] as const;

export async function listImports() {
  const { imports } = await loadImports();
  const { leads } = await loadLeads();
  const { allocations } = await loadAllocations();
  const taken = new Set(allocations.map((a) => a.leadId));
  return imports.map((imp) => {
    const inFile = leads.filter((l) => l.importId === imp.id);
    return {
      ...imp,
      leadCount: inFile.length,
      allocatedCount: inFile.filter((l) => taken.has(l.id)).length,
      availableCount: inFile.filter((l) => !taken.has(l.id)).length,
    };
  });
}

export async function updateImport(id: string, patch: { filename?: string }) {
  return withOpsLock(async () => {
    const file = await loadImports();
    const rec = file.imports.find((i) => i.id === id);
    if (!rec) throw new Error("File not found");
    if (patch.filename?.trim()) rec.filename = patch.filename.trim();
    await saveImports(file);
    return rec;
  });
}

export async function deleteImport(id: string, opts?: { deleteLeads?: boolean }) {
  return withOpsLock(async () => {
    const file = await loadImports();
    const rec = file.imports.find((i) => i.id === id);
    if (!rec) throw new Error("File not found");
    let deletedLeads = 0;
    let keptAllocated = 0;
    if (opts?.deleteLeads) {
      const leadsFile = await loadLeads();
      const allocFile = await loadAllocations();
      const taken = new Set(allocFile.allocations.map((a) => a.leadId));
      const next: MasterLead[] = [];
      for (const lead of leadsFile.leads) {
        if (lead.importId !== id) {
          next.push(lead);
          continue;
        }
        if (taken.has(lead.id)) {
          keptAllocated += 1;
          next.push(lead);
        } else {
          deletedLeads += 1;
        }
      }
      leadsFile.leads = next;
      await saveLeads(leadsFile);
    }
    file.imports = file.imports.filter((i) => i.id !== id);
    await saveImports(file);
    if (rec.storedPath) {
      try {
        await durableDelete(rec.storedPath);
      } catch {
        /* ignore missing csv */
      }
    }
    await logActivity({
      type: "import_deleted",
      metadata: { importId: id, filename: rec.filename, deletedLeads, keptAllocated },
    });
    return { ok: true as const, deletedLeads, keptAllocated };
  });
}

export async function createLead(input: {
  name?: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  website?: string;
  location?: string;
  importId?: string;
}) {
  return withOpsLock(async () => {
    const name = String(input.name || "").trim();
    const company = String(input.company || "").trim();
    const email = normalizeEmail(input.email);
    const phone = String(input.phone || "").trim();
    if (!name && !company && !email && !phone) throw new Error("Need a name, company, email, or phone");
    const leadsFile = await loadLeads();
    const draft: MasterLead = {
      id: newLeadId(),
      name: name || company || email || "Unknown",
      company,
      title: input.title?.trim() || undefined,
      email: email || undefined,
      phone: phone || undefined,
      website: input.website?.trim() || undefined,
      location: input.location?.trim() || undefined,
      source: "manual",
      importId: input.importId,
      status: "not_contacted",
      assignedTo: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (findDup(draft, buildIdx(leadsFile.leads))) {
      throw new Error("A matching lead already exists in the master pool");
    }
    leadsFile.leads.push(draft);
    await saveLeads(leadsFile);
    await logActivity({ type: "lead_created", leadId: draft.id, metadata: { importId: input.importId } });
    return draft;
  });
}

export async function updateLead(id: string, patch: Partial<MasterLead>) {
  return withOpsLock(async () => {
    const leadsFile = await loadLeads();
    const lead = leadsFile.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead not found");
    for (const key of LEAD_EDIT_FIELDS) {
      if (patch[key] !== undefined) {
        (lead as Record<string, unknown>)[key] = patch[key] ? String(patch[key]).trim() : undefined;
      }
    }
    if (patch.email !== undefined) lead.email = normalizeEmail(patch.email) || undefined;
    lead.updatedAt = nowIso();
    await saveLeads(leadsFile);
    await logActivity({ type: "lead_updated", leadId: id });
    return lead;
  });
}

export async function deleteLead(id: string) {
  return withOpsLock(async () => {
    const leadsFile = await loadLeads();
    const lead = leadsFile.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead not found");
    const allocFile = await loadAllocations();
    if (allocFile.allocations.some((a) => a.leadId === id)) {
      throw new Error("This lead is allocated for outreach. Reassign or leave it; allocated leads stay in history.");
    }
    leadsFile.leads = leadsFile.leads.filter((l) => l.id !== id);
    await saveLeads(leadsFile);
    await logActivity({ type: "lead_deleted", leadId: id, metadata: { name: lead.name, company: lead.company } });
    return { ok: true as const };
  });
}

export async function createOperator(input: { name: string; email?: string; phone?: string }) {
  return withOpsLock(async () => {
    const name = String(input.name || "").trim();
    if (!name) throw new Error("Name is required");
    const file = await loadOperators();
    const op: Operator = {
      id: newOperatorId(),
      name,
      email: input.email?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      active: true,
      createdAt: nowIso(),
    };
    file.operators.push(op);
    await saveOperators(file);
    return op;
  });
}

export async function listOperators() {
  const { operators } = await loadOperators();
  const { allocations } = await loadAllocations();
  const { leads } = await loadLeads();
  return operators.map((op) => ({
    ...op,
    assignedCount: leads.filter((l) => l.assignedTo === op.id).length,
    allocatedCount: allocations.filter((a) => a.originalUserId === op.id).length,
    url: `/operator/${op.id}`,
  }));
}

export async function setOperatorActive(id: string, active: boolean) {
  return withOpsLock(async () => {
    const file = await loadOperators();
    const op = file.operators.find((o) => o.id === id);
    if (!op) throw new Error("Operator not found");
    op.active = active;
    await saveOperators(file);
    return op;
  });
}

export async function getOperator(id: string) {
  const { operators } = await loadOperators();
  return operators.find((o) => o.id === id) || null;
}

export async function previewAllocation(count: number) {
  const { leads } = await loadLeads();
  const { allocations } = await loadAllocations();
  const taken = new Set(allocations.map((a) => a.leadId));
  const available = leads.filter((l) => !taken.has(l.id)).length;
  const n = Math.max(0, count);
  return { available, requested: n, willAssign: Math.min(n, available) };
}

export async function allocateLeads(input: {
  operatorId: string;
  count?: number;
  leadIds?: string[];
  dailyTarget?: number;
  reassign?: boolean;
}) {
  return withOpsLock(async () => {
    const { operators } = await loadOperators();
    const op = operators.find((o) => o.id === input.operatorId);
    if (!op) throw new Error("Operator not found");
    if (!op.active) throw new Error("Operator is inactive");

    const leadsFile = await loadLeads();
    const allocFile = await loadAllocations();
    const taken = new Set(allocFile.allocations.map((a) => a.leadId));
    const ts = nowIso();
    const batchId = newAllocBatchId();

    let selected: MasterLead[] = [];
    if (input.leadIds?.length) {
      for (const id of input.leadIds) {
        const lead = leadsFile.leads.find((l) => l.id === id);
        if (!lead) throw new Error(`Lead not found: ${id}`);
        if (taken.has(id) && !input.reassign) {
          throw new Error(`Already allocated for outreach: ${lead.company || lead.name}`);
        }
        selected.push(lead);
      }
    } else {
      const n = Math.max(1, Math.min(500, input.count || 0));
      selected = leadsFile.leads.filter((l) => !taken.has(l.id)).slice(0, n);
      if (!selected.length) throw new Error("No unallocated leads remain in the master pool");
    }

    for (const lead of selected) {
      const already = taken.has(lead.id);
      lead.assignedTo = op.id;
      lead.assignedAt = ts;
      lead.assignedBatchId = already ? lead.assignedBatchId : batchId;
      lead.updatedAt = ts;
      if (!already) {
        allocFile.allocations.push({
          id: newAllocId(),
          leadId: lead.id,
          userId: op.id,
          allocatedAt: ts,
          allocationBatchId: batchId,
          purpose: "sales_outreach",
          originalUserId: op.id,
          currentUserId: op.id,
        });
        taken.add(lead.id);
        await logActivity({ type: "lead_assigned", leadId: lead.id, userId: op.id, timestamp: ts, metadata: { batchId } });
      } else {
        const rec = allocFile.allocations.find((a) => a.leadId === lead.id);
        if (rec) rec.currentUserId = op.id;
        await logActivity({ type: "lead_reassigned", leadId: lead.id, userId: op.id, timestamp: ts, metadata: { batchId } });
      }
    }

    allocFile.batches.unshift({
      id: batchId,
      userId: op.id,
      userName: op.name,
      count: selected.length,
      createdAt: ts,
      dailyTarget: input.dailyTarget || GTM.dailySendCap,
    });
    await saveLeads(leadsFile);
    await saveAllocations(allocFile);
    return { batchId, operatorId: op.id, operatorName: op.name, count: selected.length, leadIds: selected.map((l) => l.id) };
  });
}

export async function reassignLead(leadId: string, operatorId: string) {
  return allocateLeads({ operatorId, leadIds: [leadId], reassign: true });
}

export async function listActivityThreads(opts: { userId?: string; type?: string; q?: string; page?: number; pageSize?: number }) {
  const { activities } = await loadActivities();
  const { leads } = await loadLeads();
  const { operators } = await loadOperators();
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const opMap = new Map(operators.map((o) => [o.id, o.name]));

  const groups = new Map<
    string,
    {
      operatorId: string;
      operatorName: string;
      leadId: string;
      leadName: string;
      company: string;
      events: typeof activities;
    }
  >();

  for (const a of activities) {
    if (!a.userId || !a.leadId) continue;
    const key = `${a.userId}::${a.leadId}`;
    const lead = leadMap.get(a.leadId);
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(a);
    } else {
      groups.set(key, {
        operatorId: a.userId,
        operatorName: opMap.get(a.userId) || a.userId,
        leadId: a.leadId,
        leadName: lead?.name || "",
        company: lead?.company || "",
        events: [a],
      });
    }
  }

  let threads = [...groups.values()].map((g) => {
    const events = [...g.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const last = events[events.length - 1];
    return {
      id: `${g.operatorId}::${g.leadId}`,
      operatorId: g.operatorId,
      operatorName: g.operatorName,
      leadId: g.leadId,
      leadName: g.leadName,
      company: g.company,
      actionCount: events.length,
      lastType: last?.type || "",
      lastAt: last?.timestamp || "",
      types: [...new Set(events.map((e) => e.type))],
      events: events.map((a) => ({
        id: a.id,
        type: a.type,
        timestamp: a.timestamp,
        metadata: a.metadata,
      })),
    };
  });

  threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  if (opts.userId) threads = threads.filter((t) => t.operatorId === opts.userId);
  if (opts.type) threads = threads.filter((t) => t.types.includes(opts.type!));
  if (opts.q) {
    const q = opts.q.toLowerCase();
    threads = threads.filter((t) =>
      [t.operatorName, t.leadName, t.company].join(" ").toLowerCase().includes(q)
    );
  }

  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize || 50));
  const total = threads.length;
  return {
    items: threads.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listActivities(opts: { userId?: string; type?: string; q?: string; page?: number; pageSize?: number }) {
  const { activities } = await loadActivities();
  const { leads } = await loadLeads();
  const { operators } = await loadOperators();
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const opMap = new Map(operators.map((o) => [o.id, o.name]));
  let rows = [...activities].reverse();
  if (opts.userId) rows = rows.filter((a) => a.userId === opts.userId);
  if (opts.type) rows = rows.filter((a) => a.type === opts.type);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((a) => {
      const lead = a.leadId ? leadMap.get(a.leadId) : null;
      return [lead?.name, lead?.company, a.userId ? opMap.get(a.userId) : "", a.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize || 50));
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize).map((a) => {
      const lead = a.leadId ? leadMap.get(a.leadId) : null;
      return {
        ...a,
        operatorName: a.userId ? opMap.get(a.userId) || a.userId : "",
        leadName: lead?.name || "",
        company: lead?.company || "",
      };
    }),
    total: rows.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
  };
}

export async function getOpsStats() {
  const { leads } = await loadLeads();
  const { allocations, batches } = await loadAllocations();
  const { operators } = await loadOperators();
  const { activities } = await loadActivities();
  const { imports } = await loadImports();
  const taken = new Set(allocations.map((a) => a.leadId));
  const count = (s: LeadStatus) => leads.filter((l) => l.status === s).length;
  const todayActs = activities.filter((a) => isToday(a.timestamp));
  const sentish = leads.filter((l) => l.status !== "not_contacted" && l.status !== "skipped").length;
  const replies = count("replied") + count("meeting");
  const assignedToday = leads.filter((l) => isToday(l.assignedAt)).length;
  const contactedToday = todayActs.filter((a) => a.type === "email_sent" || a.type === "called").length;
  return {
    pool: {
      total: leads.length,
      allocated: taken.size,
      available: Math.max(0, leads.length - taken.size),
      assigned: leads.filter((l) => l.assignedTo).length,
      contacted: leads.filter((l) => l.status !== "not_contacted").length,
    },
    statuses: {
      not_contacted: count("not_contacted"),
      sent: count("sent"),
      called: count("called"),
      replied: count("replied"),
      meeting: count("meeting"),
      not_interested: count("not_interested"),
      bounced: count("bounced"),
      skipped: count("skipped"),
    },
    outreach: {
      emailsSent: activities.filter((a) => a.type === "email_sent").length,
      calls: activities.filter((a) => a.type === "called" || a.type === "call_clicked").length,
      replies: count("replied"),
      meetings: count("meeting"),
    },
    operators: { total: operators.length, active: operators.filter((o) => o.active).length },
    today: {
      assigned: assignedToday,
      contacted: contactedToday,
      remaining: Math.max(0, assignedToday - contactedToday),
      emails: todayActs.filter((a) => a.type === "email_sent").length,
      calls: todayActs.filter((a) => a.type === "called" || a.type === "call_clicked").length,
      target: GTM.dailySendCap,
    },
    performance: {
      replyRate: sentish > 0 ? replies / sentish : 0,
      meetingRate: sentish > 0 ? count("meeting") / sentish : 0,
    },
    byOperator: operators.map((op) => ({
      id: op.id,
      name: op.name,
      allocated: allocations.filter((a) => a.originalUserId === op.id).length,
      assignedNow: leads.filter((l) => l.assignedTo === op.id).length,
    })),
    batches: batches.slice(0, 12),
    imports: imports.slice(0, 8),
  };
}

export async function getOperatorDashboard(operatorId: string) {
  const op = await getOperator(operatorId);
  if (!op) return null;
  const { leads } = await loadLeads();
  const { activities } = await loadActivities();
  const mine = leads.filter((l) => l.assignedTo === operatorId);
  const mineToday = mine.filter((l) => isToday(l.assignedAt));
  const todayActs = activities.filter((a) => a.userId === operatorId && isToday(a.timestamp));
  const contactedToday = todayActs.filter((a) => a.type === "email_sent" || a.type === "called").length;
  const queueSource = mineToday.length ? mineToday : mine;
  return {
    operator: op,
    summary: {
      assignedToday: mineToday.length,
      remainingToday: Math.max(0, (mineToday.length || mine.length) - contactedToday),
      contactedToday,
      emails: todayActs.filter((a) => a.type === "email_sent").length,
      calls: todayActs.filter((a) => a.type === "called" || a.type === "call_clicked").length,
      replies: todayActs.filter((a) => a.type === "replied").length,
      meetings: todayActs.filter((a) => a.type === "meeting").length,
      target: GTM.dailySendCap,
      completed: contactedToday,
      remainingCap: Math.max(0, GTM.dailySendCap - contactedToday),
    },
    leads: mine,
    queue: queueSource.filter((l) => l.status === "not_contacted" || l.status === "sent" || l.status === "called"),
  };
}

const ACTION_STATUS: Partial<Record<string, LeadStatus>> = {
  email_sent: "sent",
  called: "called",
  replied: "replied",
  meeting: "meeting",
  not_interested: "not_interested",
  bounced: "bounced",
  skipped: "skipped",
};

const UNDO_TYPE: Record<string, string> = {
  email_sent: "email_failed",
  called: "called_cleared",
  replied: "replied_cleared",
  meeting: "meeting_cleared",
  not_interested: "not_interested_cleared",
  bounced: "bounced_cleared",
  skipped: "skipped_cleared",
};

export async function recordLeadAction(input: {
  leadId: string;
  operatorId: string;
  action: ActivityType | string;
  disclosedToAdmin?: boolean;
  note?: string;
  message?: { to?: string; subject?: string; body?: string };
}) {
  return withOpsLock(async () => {
    const op = await getOperator(input.operatorId);
    if (!op) throw new Error("Operator not found");
    if (!op.active) throw new Error("This operator desk is deactivated. The panel is locked.");
    const leadsFile = await loadLeads();
    const lead = leadsFile.leads.find((l) => l.id === input.leadId);
    if (!lead) throw new Error("Lead not found");
    if (lead.assignedTo !== input.operatorId) throw new Error("This lead is not assigned to you");
    const note = String(input.note || "").trim();
    const msg = input.message;
    const isEmail = input.action === "email_sent" || input.action === "email_opened";

    if (input.action === "lead_opened") {
      const { activities } = await loadActivities();
      const recent = [...activities].reverse().find((a) => a.leadId === lead.id && a.userId === op.id && a.type === "lead_opened");
      if (recent && Date.now() - new Date(recent.timestamp).getTime() < 2 * 60 * 1000) {
        return { ok: true as const, lead, skipped: true };
      }
      await logActivity({ type: "lead_opened", leadId: lead.id, userId: op.id });
      return { ok: true as const, lead };
    }

    const next = ACTION_STATUS[input.action];
    let logType = input.action;
    let undone = false;
    if (next) {
      const current = new Set(
        lead.statuses?.length ? lead.statuses : lead.status && lead.status !== "not_contacted" ? [lead.status] : []
      );
      undone = current.has(next);
      if (undone) {
        current.delete(next);
        logType = UNDO_TYPE[input.action] || `${input.action}_cleared`;
      } else {
        current.add(next);
      }
      lead.statuses = [...current];
      lead.status = lead.statuses[lead.statuses.length - 1] || "not_contacted";
    }
    lead.lastAction = logType;
    lead.lastActionAt = nowIso();
    lead.updatedAt = lead.lastActionAt;
    const message =
      isEmail || msg?.subject || msg?.body
        ? {
            to: String(msg?.to || lead.email || "").trim() || undefined,
            subject: String(msg?.subject || "").trim() || undefined,
            body: String(msg?.body || "").trim() || undefined,
          }
        : undefined;
    lead.lastDisclosure = {
      at: lead.lastActionAt,
      operatorId: op.id,
      action: logType,
      note: note || undefined,
      message: undone ? undefined : message,
    };
    await saveLeads(leadsFile);
    await logActivity({
      type: logType,
      leadId: lead.id,
      userId: op.id,
      metadata: {
        note: note || undefined,
        message: undone ? undefined : message,
        statuses: lead.statuses,
        undone,
        previousAction: undone ? input.action : undefined,
      },
    });
    return { ok: true as const, lead };
  });
}

function toActionCardData(card?: ActionCard | null): ActionCardData | null {
  if (!card) return null;
  const d = String(card.decision || "").toUpperCase();
  const decision: ActionCardData["decision"] = d === "SKIP" ? "SKIP" : d === "NURTURE" ? "NURTURE" : "CONTACT";
  return {
    decision,
    priority: (card.priority as ActionCardData["priority"]) || "Medium",
    confidence: Number(card.confidence || 0),
    whyNow: card.whyNow || (card as { whyNow?: string }).whyNow || "",
    firstOffer: card.firstOffer || "",
    offerWhy: card.offerWhy || (card as { offerWhy?: string }).offerWhy || "",
    channel: card.channel,
    email: card.email,
    skipReason: card.skipReason || (card as { skipReason?: string }).skipReason,
    reviewFlag: card.reviewFlag || (card as { reviewFlag?: boolean }).reviewFlag,
    reviewNote: card.reviewNote || (card as { reviewNote?: string }).reviewNote,
  };
}

async function loadResearchJson(lead: MasterLead): Promise<ProspectData | null> {
  if (lead.researchPath) {
    const local = await durableEnsureLocal(lead.researchPath);
    if (local && fs.existsSync(local)) {
      try {
        return JSON.parse(fs.readFileSync(local, "utf8")) as ProspectData;
      } catch {
        /* ignore */
      }
    }
  }
  if (lead.reportId) return getReportJson(lead.reportId);
  return null;
}

async function findExistingReport(lead: MasterLead) {
  const email = normalizeEmail(lead.email);
  const domain = normalizeDomain(lead.website);
  if (!email && !domain && !lead.company) return null;
  const { items } = await listReports({ q: email || lead.company || domain, pageSize: 80 });
  return (
    items.find((r) => email && normalizeEmail(r.email) === email) ||
    items.find((r) => domain && normalizeDomain(r.website) === domain) ||
    null
  );
}

export async function resolveActionCard(lead: MasterLead): Promise<ActionCardData | null> {
  const data = await loadResearchJson(lead);
  if (data?.actionCard) return toActionCardData(data.actionCard);
  const existing = await findExistingReport(lead);
  if (existing?.id) {
    const json = await getReportJson(existing.id);
    if (json?.actionCard) return toActionCardData(json.actionCard);
  }
  return null;
}

function toEngineLead(lead: MasterLead): Lead {
  return {
    fullName: lead.name,
    firstName: lead.firstName,
    lastName: lead.lastName,
    title: lead.title,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    website: lead.website,
    linkedin: lead.linkedin,
    industry: lead.industry,
    city: lead.city,
    state: lead.state,
    country: lead.country,
  };
}

async function assertOperatorActive(operatorId?: string) {
  if (!operatorId) return;
  const op = await getOperator(operatorId);
  if (!op) throw new Error("Operator not found");
  if (!op.active) throw new Error("This operator desk is deactivated. The panel is locked.");
}

export async function generateResearchForLead(leadId: string, operatorId?: string) {
  await assertOperatorActive(operatorId);
  return withOpsLock(async () => {
    const leadsFile = await loadLeads();
    const lead = leadsFile.leads.find((l) => l.id === leadId);
    if (!lead) throw new Error("Lead not found");

    const existing = await findExistingReport(lead);
    if (existing?.id && String(existing.status) === "completed") {
      lead.reportId = existing.id;
      lead.updatedAt = nowIso();
      await saveLeads(leadsFile);
      const json = await getReportJson(existing.id);
      await logActivity({
        type: "research_generated",
        leadId,
        userId: operatorId,
        metadata: { reusedReportId: existing.id },
      });
      return { reused: true, reportId: existing.id, actionCard: json?.actionCard ? toActionCardData(json.actionCard) : null };
    }

    const result = await engine.processLead(toEngineLead(lead), {
      timeout: 20000,
      outDir: PATHS.reports(),
      jsonDir: path.join(PATHS.ops(), "research"),
      saveJson: true,
    });
    const rel = `ops/research/${lead.id}.json`;
    await durableWriteJson(rel, result.data);
    lead.researchPath = rel;
    lead.updatedAt = nowIso();
    await saveLeads(leadsFile);
    await logActivity({ type: "research_generated", leadId, userId: operatorId });
    return { reused: false, actionCard: toActionCardData(result.data.actionCard), researchPath: rel };
  });
}

export async function createFreeAudit(leadId: string, operatorId?: string) {
  await assertOperatorActive(operatorId);
  let detail = await getMasterLead(leadId);
  if (!detail) throw new Error("Lead not found");
  let data = await loadResearchJson(detail.lead);
  if (!data) {
    await generateResearchForLead(leadId, operatorId);
    detail = await getMasterLead(leadId);
    data = detail ? await loadResearchJson(detail.lead) : null;
  }
  const document = buildAuditDocument(detail!.lead, data);
  const html = renderAuditHtml(document);
  const jsonRel = `ops/audits/${document.id}.json`;
  const htmlRel = `ops/audits/${document.id}.html`;
  await durableWriteJson(jsonRel, document);
  await writeOpsFile(`audits/${document.id}.html`, html, "text/html; charset=utf-8");
  const audits = await loadAudits();
  const record = {
    id: document.id,
    leadId,
    operatorId,
    company: document.company,
    website: document.website,
    createdAt: document.date,
    title: document.title,
    htmlPath: htmlRel,
    jsonPath: jsonRel,
  };
  audits.audits.unshift(record);
  await saveAudits(audits);
  await logActivity({ type: "audit_created", leadId, userId: operatorId, metadata: { auditId: document.id } });
  return { audit: record, document, html };
}

export async function getAudit(id: string) {
  const { audits } = await loadAudits();
  const record = audits.find((a) => a.id === id);
  if (!record) return null;
  const local = await durableEnsureLocal(record.jsonPath);
  const document = local && fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, "utf8")) : null;
  const htmlLocal = await durableEnsureLocal(record.htmlPath);
  const html =
    htmlLocal && fs.existsSync(htmlLocal)
      ? fs.readFileSync(htmlLocal, "utf8")
      : document
        ? renderAuditHtml(document)
        : "";
  return { record, document, html };
}

export async function markAuditDownloaded(id: string, operatorId?: string, format?: string) {
  const found = await getAudit(id);
  if (!found) return;
  await logActivity({
    type: "audit_downloaded",
    leadId: found.record.leadId,
    userId: operatorId,
    metadata: { auditId: id, format },
  });
}
