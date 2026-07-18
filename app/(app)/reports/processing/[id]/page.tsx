"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  const router = useRouter();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let alive = true;

    async function tick(onDone?: () => void) {
      const res = await fetch(`/api/reports?batchId=${params.id}`);
      if (!res.ok) return;
      const json = await res.json();
      if (!alive) return;
      setBatch(json.batch);
      setReports(json.reports || []);
      if (json.batch?.status === "completed" || json.batch?.status === "failed") {
        onDone?.();
      }
    }

    try {
      const cached = sessionStorage.getItem(`prospect_batch_${params.id}`);
      if (cached) {
        const json = JSON.parse(cached) as {
          batch?: Batch;
          reports?: Report[];
          inline?: boolean;
        };
        setBatch(json.batch || null);
        setReports(json.reports || []);
        if (json.inline || json.batch?.status === "completed" || json.batch?.status === "failed") {
          return () => {
            alive = false;
          };
        }
      }
    } catch {
      /* ignore */
    }

    void tick();
    const intervalId = setInterval(() => {
      void tick(() => clearInterval(intervalId));
    }, 2500);

    return () => {
      alive = false;
      clearInterval(intervalId);
    };
  }, [params.id]);

  async function removeAll() {
    if (!confirm("Remove these reports from the queue / list?")) return;
    setRemoving(true);
    try {
      await Promise.all(reports.map((r) => fetch(`/api/reports/${r.id}`, { method: "DELETE" })));
      try {
        sessionStorage.removeItem(`prospect_batch_${params.id}`);
      } catch {
        /* ignore */
      }
      router.push("/reports");
    } finally {
      setRemoving(false);
    }
  }

  const overall =
    batch && batch.total
      ? Math.round(((batch.completed + batch.failed) / batch.total) * 100)
      : reports[0]?.progress || 0;

  const stageLabel =
    reports.find((r) => r.status === "processing")?.message ||
    (batch?.status === "completed"
      ? "Completed."
      : batch?.status === "queued"
        ? "Waiting… (older jobs may be stuck — use Remove below)"
        : "Working…");

  const stuck = batch?.status === "queued" || reports.some((r) => r.status === "queued");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Processing</h1>
          <p className="text-sm text-muted-foreground">
            Batch {params.id.slice(0, 8)}… · {batch?.filename || "CSV"}
          </p>
        </div>
        <Button variant="outline" disabled={removing || reports.length === 0} onClick={() => void removeAll()}>
          {removing ? "Removing…" : "Remove from queue"}
        </Button>
      </div>

      {stuck ? (
        <Card className="border-warning/40 bg-warning/5 p-4 text-sm text-muted-foreground">
          This job was created under the old background-queue mode and may never start. Remove it, then generate again
          — new runs process immediately (can take 1–2 minutes while researching the website).
        </Card>
      ) : null}

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
                <button
                  type="button"
                  className="text-sm text-danger hover:underline"
                  disabled={removing}
                  onClick={async () => {
                    if (!confirm(`Remove ${r.company}?`)) return;
                    setRemoving(true);
                    try {
                      await fetch(`/api/reports/${r.id}`, { method: "DELETE" });
                      setReports((prev) => prev.filter((x) => x.id !== r.id));
                    } finally {
                      setRemoving(false);
                    }
                  }}
                >
                  Remove
                </button>
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
