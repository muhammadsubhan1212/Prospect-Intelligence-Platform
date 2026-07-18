"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, Progress, Button } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";

type Report = {
  id: string;
  company: string;
  fullName: string;
  status: string;
  stage: string;
  message: string;
  progress: number;
  error?: string;
};

type Batch = {
  id: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  processing: number;
  queued: number;
  filename: string;
};

export default function ProcessingPage() {
  const params = useParams<{ id: string }>();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    let alive = true;
    async function tick() {
      const res = await fetch(`/api/reports?batchId=${params.id}`);
      if (!res.ok) return;
      const json = await res.json();
      if (!alive) return;
      setBatch(json.batch);
      setReports(json.reports || []);
    }
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [params.id]);

  const overall =
    batch && batch.total
      ? Math.round(((batch.completed + batch.failed) / batch.total) * 100)
      : reports[0]?.progress || 0;

  const stageLabel =
    reports.find((r) => r.status === "processing")?.message ||
    (batch?.status === "completed" ? "Completed." : batch?.status === "queued" ? "Queued…" : "Working…");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Processing</h1>
        <p className="text-sm text-muted-foreground">
          Live progress for batch {params.id.slice(0, 8)}… · {batch?.filename || "CSV"}
        </p>
      </div>

      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">{stageLabel}</div>
          {batch ? <StatusBadge status={batch.status} /> : null}
        </div>
        <Progress value={overall} />
        <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground sm:grid-cols-4">
          <div>Total: {batch?.total ?? "—"}</div>
          <div>Done: {batch?.completed ?? 0}</div>
          <div>Failed: {batch?.failed ?? 0}</div>
          <div>Queued: {batch?.queued ?? 0}</div>
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>Uploading CSV… ✓</li>
          <li>Reading rows… ✓</li>
          <li>Researching company…</li>
          <li>Analyzing…</li>
          <li>Generating DOCX…</li>
          <li>{batch?.status === "completed" ? "Completed." : "In progress…"}</li>
        </ul>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-3 font-medium">Reports in this batch</div>
        <div className="divide-y divide-border">
          {reports.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="font-medium">{r.company}</div>
                <div className="text-xs text-muted-foreground">
                  {r.fullName} · {r.message}
                </div>
                {r.error ? <div className="mt-1 text-xs text-danger">{r.error}</div> : null}
              </div>
              <div className="flex items-center gap-3">
                <div className="w-24">
                  <Progress value={r.progress} />
                </div>
                <StatusBadge status={r.status} />
                {r.status === "completed" ? (
                  <Link href={`/reports/${r.id}`} className="text-sm text-accent hover:underline">
                    Open
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {batch?.status === "completed" ? (
        <Link href="/reports">
          <Button>Back to reports</Button>
        </Link>
      ) : null}
    </div>
  );
}
