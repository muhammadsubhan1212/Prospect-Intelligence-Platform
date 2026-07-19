"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, CheckCircle2, Loader2, XCircle, Files, Trash2 } from "lucide-react";
import { Card, Button, Checkbox } from "@/components/ui/primitives";
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
};

type Stats = {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Report[]>([]);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    const res = await fetch("/api/reports?page=1&pageSize=12");
    const json = await res.json();
    setStats(json.stats || null);
    setItems(json.items || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onDelete(id: string, company: string) {
    if (!confirm(`Remove “${company}” from reports? This deletes queued/stuck jobs too.`)) return;
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    startTransition(() => {
      void load();
      router.refresh();
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = items.length > 0 && items.every((r) => selected.has(r.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const r of items) next.delete(r.id);
      } else {
        for (const r of items) next.add(r.id);
      }
      return next;
    });
  }

  const cards = [
    { label: "Total Reports", value: stats?.total ?? "—", icon: Files, tone: "text-foreground" },
    {
      label: "Processing",
      value: stats ? stats.processing + stats.queued : "—",
      icon: Loader2,
      tone: "text-warning",
    },
    { label: "Completed", value: stats?.completed ?? "—", icon: CheckCircle2, tone: "text-success" },
    { label: "Failed", value: stats?.failed ?? "—", icon: XCircle, tone: "text-danger" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Prospect intelligence pipeline overview</p>
        </div>
        <Link href="/reports/new">
          <Button>
            <FilePlus2 className="h-4 w-4" />
            New Report
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} className="p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">{c.label}</div>
                <Icon className={`h-4 w-4 ${c.tone}`} />
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight">{c.value}</div>
            </Card>
          );
        })}
      </div>

      <BulkActionBar selectedIds={[...selected]} onClear={() => setSelected(new Set())} onDeleted={() => void load()} />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-medium">Recent reports</h2>
          <Link href="/reports" className="text-sm text-accent hover:underline">
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">
                  {items.length > 0 ? <Checkbox checked={allSelected} onChange={toggleSelectAll} /> : null}
                </th>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium">Manage</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                    No reports yet. Upload a CSV to generate your first dossier.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className={`border-t border-border hover:bg-muted/40 ${selected.has(r.id) ? "bg-accent/5" : ""}`}>
                    <td className="px-5 py-3">
                      <Checkbox checked={selected.has(r.id)} onChange={() => toggleSelected(r.id)} />
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/reports/${r.id}`} className="font-medium hover:text-accent">
                        {r.company}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{r.fullName || "—"}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(r.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-2">
                        {r.status === "completed" ? (
                          <Link href={`/reports/${r.id}`} className="text-accent hover:underline">
                            Open
                          </Link>
                        ) : r.status === "queued" || r.status === "processing" ? (
                          <Link
                            href={`/reports/processing/${r.batchId || r.id}`}
                            className="text-accent hover:underline"
                          >
                            Progress
                          </Link>
                        ) : (
                          <Link href={`/reports/${r.id}`} className="text-accent hover:underline">
                            Details
                          </Link>
                        )}
                        <button
                          type="button"
                          disabled={pending}
                          className="inline-flex items-center gap-1 text-danger hover:underline disabled:opacity-50"
                          onClick={() => void onDelete(r.id, r.company)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
