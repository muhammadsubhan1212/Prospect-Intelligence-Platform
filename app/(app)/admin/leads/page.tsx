"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, Input } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";
import { StatusBadge } from "@/components/ops/status-badge";

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

  async function loadFiles() {
    const res = await fetch("/api/ops/imports");
    const data = await res.json();
    setFiles(data.imports || []);
  }

  async function loadLeads(p = 1) {
    const params = new URLSearchParams({ page: String(p), pageSize: "50" });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (available) params.set("available", "1");
    if (importId) params.set("importId", importId);
    const res = await fetch(`/api/ops/leads?${params}`);
    const data = await res.json();
    if (data.error) setError(data.error);
    else {
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
    }
  }

  async function refresh(p = 1) {
    await Promise.all([loadFiles(), loadLeads(p)]);
  }

  useEffect(() => {
    void refresh(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, available, importId]);

  async function onUpload(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError("");
    setResult("");
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/ops/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || `Upload failed (${res.status})`);
      } else {
        setResult(
          `Imported ${data.filename || file.name}: ${data.totalRows} rows → ${data.newLeads} new, ${data.alreadyExisting} already in the pool (skipped), ${data.invalidRows} invalid.`
        );
        setImportId(data.id || "");
        await refresh(1);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
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
            onChange={(e) => void onUpload(e.target.files?.[0] || null)}
          />
          <Button type="button" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? "Importing…" : "Upload CSV"}
          </Button>
          <Button type="button" variant="outline" onClick={() => { setCreating(true); setEditing(null); }}>
            Add lead
          </Button>
        </div>
      </div>
      {result ? <p className="mt-3 text-sm text-success">{result}</p> : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

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
      </div>

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
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
                    <Button type="button" size="sm" variant="ghost" onClick={() => void removeLead(l.id)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={10}>
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
