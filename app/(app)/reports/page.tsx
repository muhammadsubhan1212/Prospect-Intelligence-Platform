"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Eye, Trash2, Search } from "lucide-react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/utils";

type Report = {
  id: string;
  company: string;
  fullName: string;
  status: string;
  createdAt: string;
  websiteScore?: number;
  firstOffer?: string;
  industry?: string;
};

export default function ReportsPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const pageSize = 12;

  async function load(nextPage = page, nextQ = q) {
    const res = await fetch(`/api/reports?page=${nextPage}&pageSize=${pageSize}&q=${encodeURIComponent(nextQ)}`);
    const json = await res.json();
    setItems(json.items || []);
    setTotal(json.total || 0);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function onDelete(id: string) {
    if (!confirm("Delete this report and its files?")) return;
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    void load();
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">{total} total</p>
        </div>
        <Link href="/reports/new">
          <Button>New Report</Button>
        </Link>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load(1, q);
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => (
          <Card key={r.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{r.company}</div>
                <div className="text-sm text-muted-foreground">{r.fullName || "—"}</div>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <div>Created: {formatDate(r.createdAt)}</div>
              {r.websiteScore != null ? <div>Score: {r.websiteScore}/100</div> : null}
              {r.firstOffer ? <div className="line-clamp-2">Offer: {r.firstOffer}</div> : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {r.status === "completed" ? (
                <Link href={`/reports/${r.id}/document`}>
                  <Button size="sm">
                    <Eye className="h-3.5 w-3.5" />
                    Document
                  </Button>
                </Link>
              ) : null}
              {r.status === "completed" ? (
                <Link href={`/reports/${r.id}/view`}>
                  <Button size="sm" variant="outline">
                    Web view
                  </Button>
                </Link>
              ) : null}
              {r.status === "completed" ? (
                <a href={`/api/reports/${r.id}/download`}>
                  <Button size="sm" variant="outline">
                    <Download className="h-3.5 w-3.5" />
                    DOCX
                  </Button>
                </a>
              ) : null}
              <Link href={`/reports/${r.id}`}>
                <Button size="sm" variant="outline">
                  Details
                </Button>
              </Link>
              <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {items.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">No reports found.</Card>
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
