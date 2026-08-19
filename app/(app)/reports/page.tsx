"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Search, Mail } from "lucide-react";
import { Badge, Button, Card, Checkbox, Input } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { formatDate } from "@/lib/utils";

type Report = {
  id: string;
  batchId?: string;
  company: string;
  fullName: string;
  status: string;
  createdAt: string;
  websiteScore?: number;
  firstOffer?: string;
  industry?: string;
  decision?: string;
  priority?: string;
  confidence?: number;
  emailSubject?: string;
  reviewFlag?: boolean;
  sendQueueStatus?: string;
  outreachOutcome?: { status?: string };
};

type Filter = "ALL" | "CONTACT" | "SKIP" | "NURTURE" | "REVIEW";

function trackingBadge(r: Report) {
  const outcome = r.outreachOutcome?.status;
  if (outcome === "meeting") return <Badge tone="success">Meeting</Badge>;
  if (outcome === "replied") return <Badge tone="success">Replied</Badge>;
  const sq = r.sendQueueStatus;
  if (sq === "sent" || outcome === "sent") return <Badge tone="success">Sent</Badge>;
  if (sq === "opened_gmail") return <Badge tone="warning">Opened Gmail</Badge>;
  if (sq === "skipped") return <Badge tone="muted">Skipped</Badge>;
  if (r.decision === "CONTACT") return <Badge tone="warning">Pending send</Badge>;
  return <span className="text-muted-foreground">—</span>;
}

function ReportsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1", 10) || 1);
  const [items, setItems] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const initialDecision = (searchParams.get("decision") || "").toUpperCase();
  const [filter, setFilter] = useState<Filter>(
    searchParams.get("reviewOnly") === "true" || searchParams.get("reviewOnly") === "1"
      ? "REVIEW"
      : initialDecision === "CONTACT" || initialDecision === "SKIP" || initialDecision === "NURTURE"
        ? initialDecision
        : "ALL"
  );
  const pageSize = 12;

  async function load(nextPage = page, nextQ = q, nextFilter = filter) {
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(pageSize),
      q: nextQ,
    });
    if (nextFilter === "REVIEW") params.set("reviewOnly", "1");
    else if (nextFilter !== "ALL") params.set("decision", nextFilter);

    const batchId = searchParams.get("batchId");
    const outcome = searchParams.get("outcome");
    const sendQueueStatus = searchParams.get("sendQueueStatus");
    const offer = searchParams.get("offer");
    if (batchId) params.set("batchId", batchId);
    if (outcome) params.set("outcome", outcome);
    if (sendQueueStatus) params.set("sendQueueStatus", sendQueueStatus);
    if (offer) params.set("offer", offer);

    const res = await fetch(`/api/reports?${params}`);
    const json = await res.json();
    setItems(json.items || []);
    setTotal(json.total || 0);
  }

  useEffect(() => {
    void load();
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filter, searchParams]);

  async function onDelete(id: string) {
    if (!confirm("Delete this report and its files?")) return;
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    void load();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = items.length > 0 && items.every((r) => selected.has(r.id));

  function toggleSelectAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const r of items) next.delete(r.id);
      } else {
        for (const r of items) next.add(r.id);
      }
      return next;
    });
  }

  function openSendQueueForSelection() {
    const ids = [...selected];
    if (!ids.length) return;
    const selectedRows = items.filter((r) => selected.has(r.id));
    const batches = new Set(selectedRows.map((r) => r.batchId).filter(Boolean));
    if (batches.size === 1) {
      const batchId = [...batches][0]!;
      router.push(`/reports/sending/${batchId}`);
      return;
    }
    try {
      sessionStorage.setItem("send_queue_ids", JSON.stringify(ids));
    } catch {
      /* ignore */
    }
    router.push("/reports/sending/selection");
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const urlFilters = [
    searchParams.get("batchId") && `batch`,
    searchParams.get("outcome") && `outcome=${searchParams.get("outcome")}`,
    searchParams.get("sendQueueStatus") && `queue=${searchParams.get("sendQueueStatus")}`,
    searchParams.get("offer") && `offer`,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Action lists</h1>
          <p className="text-sm text-muted-foreground">
            {total} matching · Instantly CSV is the deliverable
            {urlFilters.length ? ` · filtered (${urlFilters.join(", ")})` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 ? (
            <Button variant="outline" onClick={openSendQueueForSelection}>
              <Mail className="h-4 w-4" />
              Open Send Queue ({selected.size})
            </Button>
          ) : null}
          <Link href="/reports/new">
            <Button>New run</Button>
          </Link>
        </div>
      </div>

      <BulkActionBar selectedIds={[...selected]} onClear={() => setSelected(new Set())} onDeleted={() => void load()} />

      <div className="flex flex-wrap gap-2">
        {(["ALL", "CONTACT", "NURTURE", "SKIP", "REVIEW"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              filter === f ? "border-accent bg-accent/10 text-accent" : "border-border hover:bg-muted"
            }`}
          >
            {f === "ALL" ? "All" : f === "REVIEW" ? "Needs review" : f}
          </button>
        ))}
        {urlFilters.length ? (
          <Link href="/reports" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Clear URL filters
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            void load(1, q, filter);
          }}
        >
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search company, name, email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        {items.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={allOnPageSelected} onChange={toggleSelectAllOnPage} />
            Select all on this page
          </label>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium" />
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Decision</th>
                <th className="px-4 py-3 font-medium">Tracking</th>
                <th className="px-4 py-3 font-medium">Offer</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className={`border-t border-border hover:bg-muted/40 ${selected.has(r.id) ? "bg-accent/5" : ""}`}>
                  <td className="px-4 py-3">
                    <Checkbox checked={selected.has(r.id)} onChange={() => toggleSelected(r.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/reports/${r.id}`} className="font-medium hover:text-accent">
                      {r.company}
                    </Link>
                    <div className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.fullName || "—"}</td>
                  <td className="px-4 py-3">
                    {r.decision ? (
                      <Badge tone={r.decision === "CONTACT" ? "success" : r.decision === "SKIP" ? "danger" : "warning"}>
                        {r.decision}
                      </Badge>
                    ) : (
                      <StatusBadge status={r.status} />
                    )}
                  </td>
                  <td className="px-4 py-3">{trackingBadge(r)}</td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">{r.firstOffer || "—"}</td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">{r.emailSubject || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/reports/${r.id}`} className="text-accent hover:underline">
                        Action
                      </Link>
                      {r.decision === "CONTACT" && r.batchId ? (
                        <Link href={`/reports/sending/${r.batchId}`} className="text-muted-foreground hover:underline">
                          Queue
                        </Link>
                      ) : null}
                      {r.status === "completed" ? (
                        <a href={`/api/reports/${r.id}/download`} className="text-muted-foreground hover:underline inline-flex items-center gap-1">
                          <Download className="h-3 w-3" />
                          DOCX
                        </a>
                      ) : null}
                      <button type="button" className="text-danger hover:underline" onClick={() => void onDelete(r.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {items.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No action cards yet.{" "}
          <Link href="/reports/new" className="text-accent hover:underline">
            Start a run
          </Link>
        </Card>
      ) : null}

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading lists…</div>}>
      <ReportsInner />
    </Suspense>
  );
}
