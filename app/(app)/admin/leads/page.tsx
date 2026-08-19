"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, Input } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";
import { StatusBadge } from "@/components/ops/status-badge";
import { splitCsvIntoParts, type SplitPlan } from "@/lib/ops-import-split";

type LeadRow = {
  id: string;
  name: string;
  company: string;
  title?: string;
  email?: string;
  phone?: string;
  website?: string;
  location?: string;
  status: string;
  assignedTo?: string | null;
  assignedName?: string | null;
  allocated: boolean;
  lastAction?: string;
  importId?: string;
  source?: string;
};

type ImportFile = {
  id: string;
  filename: string;
  createdAt: string;
  totalRows: number;
  newLeads: number;
  alreadyExisting: number;
  invalidRows: number;
  leadCount: number;
  allocatedCount: number;
  availableCount: number;
};

export default function AdminLeadsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [items, setItems] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [available, setAvailable] = useState(false);
  const [importId, setImportId] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", company: "", title: "", email: "", phone: "", website: "", location: "" });
  const [split, setSplit] = useState<SplitPlan | null>(null);
  const [batchImportId, setBatchImportId] = useState("");
  const [uploadingPart, setUploadingPart] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [resetting, setResetting] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  async function readJson(res: Response) {
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (res.status === 413 || /^Request En/i.test(text)) {
        throw new Error("This part is over Vercel’s size limit. Use a smaller L-part.");
      }
      throw new Error(text.slice(0, 180) || `Request failed (${res.status})`);
    }
  }

  async function loadFiles() {
    const res = await fetch("/api/ops/imports");
    const data = await readJson(res);
    setFiles((data.imports as ImportFile[]) || []);
  }

  async function loadLeads(p = 1) {
    const params = new URLSearchParams({ page: String(p), pageSize: "50" });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (available) params.set("available", "1");
    if (importId) params.set("importId", importId);
    const res = await fetch(`/api/ops/leads?${params}`);
    const data = await readJson(res);
    if (data.error) setError(String(data.error));
    else {
      setItems((data.items as LeadRow[]) || []);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || 1));
    }
  }

  async function refresh(p = 1) {
    try {
      await Promise.all([loadFiles(), loadLeads(p)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    setSelected([]);
    void refresh(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, available, importId]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const pageIds = items.map((l) => l.id);
    const n = pageIds.filter((id) => selected.includes(id)).length;
    el.checked = pageIds.length > 0 && n === pageIds.length;
    el.indeterminate = n > 0 && n < pageIds.length;
  }, [items, selected]);

  function filterQuery() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (available) params.set("available", "1");
    if (importId) params.set("importId", importId);
    return params;
  }

  function toggleOne(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function togglePage(checked: boolean) {
    const pageIds = items.map((l) => l.id);
    setSelected((cur) => {
      if (checked) return Array.from(new Set([...cur, ...pageIds]));
      return cur.filter((id) => !pageIds.includes(id));
    });
  }

  async function selectAllInView() {
    const params = filterQuery();
    params.set("idsOnly", "1");
    const res = await fetch(`/api/ops/leads?${params}`);
    const data = await readJson(res);
    if (data.error) setError(String(data.error));
    else setSelected((data.ids as string[]) || []);
  }

  async function resetLeads(body: Record<string, unknown>, confirmText: string) {
    if (!confirm(confirmText)) return;
    setResetting(true);
    setError("");
    setResult("");
    try {
      const res = await fetch("/api/ops/leads/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (data.error) setError(String(data.error));
      else {
        setSelected([]);
        setResult(
          `Reset ${data.reset} lead${data.reset === 1 ? "" : "s"}. They stay in the master pool, unassigned. Activity logs stay and are marked Reset.`
        );
        await refresh(page);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setError("");
    setResult("");
    setImporting(true);
    try {
      const text = await file.text();
      const plan = splitCsvIntoParts(file.name, text);
      if (!plan.totalRows) throw new Error("No data rows found. Save as CSV (not Excel) and try again.");
      setSplit(plan);
      setBatchImportId("");
      setResult(
        `${file.name}: ${plan.totalRows} rows split into ${plan.parts.length} part${plan.parts.length === 1 ? "" : "s"} (L1${plan.parts.length > 1 ? `–L${plan.parts.length}` : ""}). Upload each part separately.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSplit(null);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function uploadPart(partId: string) {
    if (!split) return;
    const part = split.parts.find((p) => p.id === partId);
    if (!part || part.uploaded) return;
    setUploadingPart(partId);
    setError("");
    try {
      const res = await fetch("/api/ops/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: split.filename,
          headers: split.headers,
          records: part.records,
          importId: batchImportId || undefined,
          partLabel: part.label,
        }),
      });
      const data = await readJson(res);
      if (!res.ok || data.error) {
        setError(String(data.error || `Upload failed (${res.status})`));
        return;
      }
      const newId = String(data.id || batchImportId);
      setBatchImportId(newId);
      setImportId(newId);
      setSplit({
        ...split,
        parts: split.parts.map((p) => (p.id === partId ? { ...p, uploaded: true } : p)),
      });
      setResult(
        `${part.label} (rows ${part.rowFrom}–${part.rowTo}) imported → ${data.newLeads} new, ${data.alreadyExisting} already in pool, ${data.invalidRows} invalid.`
      );
      await refresh(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingPart("");
    }
  }

  async function saveLead() {
    setError("");
    const url = editing ? `/api/ops/leads/${editing.id}` : "/api/ops/leads";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, importId: importId || undefined }),
    });
    const data = await res.json();
    if (data.error) setError(data.error);
    else {
      setEditing(null);
      setCreating(false);
      setDraft({ name: "", company: "", title: "", email: "", phone: "", website: "", location: "" });
      await refresh(page);
    }
  }

  async function removeLead(id: string) {
    if (!confirm("Delete this lead from the master pool?")) return;
    const res = await fetch(`/api/ops/leads/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) setError(data.error);
    else await refresh(page);
  }

  async function renameFile(imp: ImportFile) {
    const filename = prompt("File name", imp.filename);
    if (!filename || filename === imp.filename) return;
    const res = await fetch(`/api/ops/imports/${imp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.error) setError(data.error);
    else await loadFiles();
  }

  async function removeFile(imp: ImportFile) {
    const also = confirm(
      `Remove file “${imp.filename}” from the list?\n\nOK = also delete unallocated leads from this file\nCancel = stop`
    );
    if (!also) return;
    const res = await fetch(`/api/ops/imports/${imp.id}?deleteLeads=1`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) setError(data.error);
    else {
      if (importId === imp.id) setImportId("");
      setResult(`Removed ${imp.filename}. Deleted ${data.deletedLeads} leads. Kept ${data.keptAllocated} allocated leads.`);
      await refresh(1);
    }
  }

  const activeFile = files.find((f) => f.id === importId);

  return (
    <div>
      <OpsNav />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Master leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} showing{activeFile ? ` from ${activeFile.filename}` : " in the pool"}. Upload here — New run does not fill this list.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
          />
          <Button type="button" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? "Reading file…" : "Choose CSV"}
          </Button>
          <Button type="button" variant="outline" onClick={() => { setCreating(true); setEditing(null); }}>
            Add lead
          </Button>
        </div>
      </div>
      {result ? <p className="mt-3 text-sm text-success">{result}</p> : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      {split ? (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">
                {split.filename} = {split.parts.map((p) => p.label).join(" + ")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {split.totalRows} rows in {split.parts.length} part{split.parts.length === 1 ? "" : "s"}. Each part stays
                under Vercel’s upload limit. Upload the ones you want, in any order.
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setSplit(null); setBatchImportId(""); }}>
              Clear split
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {split.parts.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant={p.uploaded ? "secondary" : "outline"}
                disabled={!!uploadingPart || p.uploaded}
                onClick={() => void uploadPart(p.id)}
              >
                {uploadingPart === p.id
                  ? `Uploading ${p.label}…`
                  : p.uploaded
                    ? `${p.label} uploaded`
                    : `${p.label} · rows ${p.rowFrom}–${p.rowTo}`}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => setImportId("")}
          className={`rounded-xl border p-4 text-left ${!importId ? "border-accent bg-accent/5" : "border-border bg-card"}`}
        >
          <div className="text-sm font-medium">All files</div>
          <div className="mt-1 text-xs text-muted-foreground">{files.reduce((n, f) => n + f.leadCount, 0)} leads across {files.length} files</div>
        </button>
        {files.map((f) => (
          <div
            key={f.id}
            className={`rounded-xl border p-4 ${importId === f.id ? "border-accent bg-accent/5" : "border-border bg-card"}`}
          >
            <button type="button" className="w-full text-left" onClick={() => setImportId(f.id)}>
              <div className="truncate text-sm font-medium">{f.filename}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(f.createdAt).toLocaleString()} · {f.leadCount} leads · {f.newLeads} new / {f.alreadyExisting} skipped
              </div>
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void renameFile(f)}>
                Rename
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resetting}
                onClick={() =>
                  void resetLeads(
                    { allMatching: true, importId: f.id },
                    `Reset all leads in “${f.filename}”?\n\nThey stay in the master pool. Assignment, Sent/Called, and outreach history on the operator desk are cleared. Admin activity stays, marked Reset.\n\nThis does not delete the contacts.`
                  )
                }
              >
                Reset file
              </Button>
              <Button type="button" size="sm" variant="danger" onClick={() => void removeFile(f)}>
                Delete file
              </Button>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) ? (
        <Card className="mt-4 grid gap-3 p-5 sm:grid-cols-2">
          <h2 className="sm:col-span-2 font-medium">{editing ? "Edit lead" : "Add lead"}</h2>
          {(["name", "company", "title", "email", "phone", "website", "location"] as const).map((key) => (
            <Input
              key={key}
              placeholder={key}
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          ))}
          <div className="sm:col-span-2 flex gap-2">
            <Button type="button" onClick={() => void saveLead()}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Input
          placeholder="Search name, company, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void loadLeads(1)}
          className="max-w-sm"
        />
        <Button type="button" variant="outline" onClick={() => void loadLeads(1)}>
          Search
        </Button>
        <select
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {["not_contacted", "sent", "called", "replied", "meeting", "not_interested", "bounced", "skipped"].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
          Available only
        </label>
        <Button type="button" variant="outline" onClick={() => void selectAllInView()} disabled={!total || resetting}>
          Select all {total} in this view
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={!selected.length || resetting}
          onClick={() =>
            void resetLeads(
              { leadIds: selected },
              `Reset ${selected.length} selected lead${selected.length === 1 ? "" : "s"}?\n\nContacts stay in master data. Operators lose these assignments. Sent/Called is cleared so they can be assigned again.\n\nAdmin activity for these leads stays, with a Reset mark.`
            )
          }
        >
          {resetting ? "Resetting…" : `Reset selected (${selected.length})`}
        </Button>
      </div>
      {selected.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {selected.length} selected. Reset unassigns and clears outreach. It does not delete the lead.
        </p>
      ) : null}

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all on this page"
                  onChange={(e) => togglePage(e.target.checked)}
                />
              </th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Website</th>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Assigned</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} className="border-b border-border/70">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(l.id)}
                    onChange={() => toggleOne(l.id)}
                    aria-label={`Select ${l.name}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/admin/leads/${l.id}`} className="text-accent hover:underline">
                    {l.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{l.company || "—"}</td>
                <td className="px-3 py-2">{l.title || "—"}</td>
                <td className="px-3 py-2">{l.email || "—"}</td>
                <td className="px-3 py-2">{l.phone || "—"}</td>
                <td className="px-3 py-2">{l.website || "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {files.find((f) => f.id === l.importId)?.filename || l.source || "—"}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={l.status} />
                </td>
                <td className="px-3 py-2">{l.assignedName || (l.allocated ? "Allocated" : "—")}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(l);
                        setCreating(false);
                        setDraft({
                          name: l.name || "",
                          company: l.company || "",
                          title: l.title || "",
                          email: l.email || "",
                          phone: l.phone || "",
                          website: l.website || "",
                          location: l.location || "",
                        });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={resetting}
                      onClick={() =>
                        void resetLeads(
                          { leadIds: [l.id] },
                          `Reset ${l.name}?\n\nThey stay in the master pool, unassigned. Activity stays, marked Reset.`
                        )
                      }
                    >
                      Reset
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void removeLead(l.id)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={11}>
                  No leads in this view. Use Upload CSV on this page (not New run).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" disabled={page <= 1} onClick={() => void loadLeads(page - 1)}>
          Previous
        </Button>
        <Button type="button" variant="outline" disabled={page * 50 >= total} onClick={() => void loadLeads(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
