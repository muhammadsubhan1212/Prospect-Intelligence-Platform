import { randomBytes, randomUUID } from "crypto";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randChars(n: number) {
  const buf = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHA[buf[i] % ALPHA.length];
  return out;
}

export function newLeadId() {
  return `lead_${Date.now().toString(36)}${randChars(6).toLowerCase()}`;
}

export function newOperatorId() {
  return `USR-${randChars(6)}`;
}

export function newAllocBatchId() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  return `ALLOC-${ymd}-${randChars(4)}`;
}

export function newAllocId() {
  return `alc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function newActivityId() {
  return `act_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function newImportId() {
  return `imp_${Date.now().toString(36)}${randChars(4).toLowerCase()}`;
}

export function newAuditId() {
  return `aud_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
