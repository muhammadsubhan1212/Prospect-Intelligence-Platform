import fs from "fs";
import path from "path";
import { PATHS, ensureDirs } from "@/server/services/paths";
import { durableReadJson, durableWriteJson, durableWriteFile } from "@/server/services/durable-store";
import type {
  Activity,
  AllocationBatch,
  AllocationRecord,
  FreeAudit,
  ImportRecord,
  MasterLead,
  Operator,
} from "./types";

export type LeadsFile = { leads: MasterLead[] };
export type OperatorsFile = { operators: Operator[] };
export type AllocationsFile = { allocations: AllocationRecord[]; batches: AllocationBatch[] };
export type ActivitiesFile = { activities: Activity[] };
export type ImportsFile = { imports: ImportRecord[] };
export type AuditsFile = { audits: FreeAudit[] };

const REL = {
  leads: "ops/leads.json",
  operators: "ops/operators.json",
  allocations: "ops/allocations.json",
  activities: "ops/activities.json",
  imports: "ops/imports.json",
  audits: "ops/audits.json",
};

let chain: Promise<unknown> = Promise.resolve();

/** In-process mutex so import/allocate cannot interleave on this instance. */
export function withOpsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function opsDir() {
  ensureDirs();
  const dir = PATHS.ops();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const sub of ["research", "audits", "imports"]) {
    const p = path.join(dir, sub);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
  return dir;
}

export async function loadLeads(): Promise<LeadsFile> {
  opsDir();
  return durableReadJson<LeadsFile>(REL.leads, { leads: [] });
}

export async function saveLeads(data: LeadsFile) {
  await durableWriteJson(REL.leads, data);
}

export async function loadOperators(): Promise<OperatorsFile> {
  opsDir();
  return durableReadJson<OperatorsFile>(REL.operators, { operators: [] });
}

export async function saveOperators(data: OperatorsFile) {
  await durableWriteJson(REL.operators, data);
}

export async function loadAllocations(): Promise<AllocationsFile> {
  opsDir();
  return durableReadJson<AllocationsFile>(REL.allocations, { allocations: [], batches: [] });
}

export async function saveAllocations(data: AllocationsFile) {
  await durableWriteJson(REL.allocations, data);
}

export async function loadActivities(): Promise<ActivitiesFile> {
  opsDir();
  return durableReadJson<ActivitiesFile>(REL.activities, { activities: [] });
}

export async function saveActivities(data: ActivitiesFile) {
  await durableWriteJson(REL.activities, data);
}

export async function loadImports(): Promise<ImportsFile> {
  opsDir();
  return durableReadJson<ImportsFile>(REL.imports, { imports: [] });
}

export async function saveImports(data: ImportsFile) {
  await durableWriteJson(REL.imports, data);
}

export async function loadAudits(): Promise<AuditsFile> {
  opsDir();
  return durableReadJson<AuditsFile>(REL.audits, { audits: [] });
}

export async function saveAudits(data: AuditsFile) {
  await durableWriteJson(REL.audits, data);
}

export async function writeOpsFile(relFromOps: string, data: Buffer | string, contentType: string) {
  opsDir();
  const rel = `ops/${relFromOps.replace(/^\/+/, "")}`;
  await durableWriteFile(rel, data, contentType);
  return rel;
}
