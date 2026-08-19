"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, Card, Progress, Button } from "@/components/ui/primitives";
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
  decision?: string;
  priority?: string;
  firstOffer?: string;
  emailSubject?: string;
  confidence?: number;
  reviewFlag?: boolean;
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
  const done = reports.filter((r) => r.status === "completed");
  const contact = done.filter((r) => r.decision === "CONTACT").length;
  const nurture = done.filter((r) => r.decision === "NURTURE").length;
  const skip = done.filter((r) => r.decision === "SKIP").length;
  const review = done.filter((r) => r.reviewFlag).length;
  const batchDone = batch?.status === "completed" || batch?.status === "failed";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {batchDone ? "Batch results" : "Processing"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Batch {params.id.slice(0, 8)}… · {batch?.filename || "CSV"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {batchDone ? (
            <>
              {contact > 0 ? (
                <Link href={`/reports/sending/${params.id}`}>
                  <Button>
                    Open Send Queue ({contact} CONTACT)
                  </Button>
                </Link>
              ) : null}
              <a href={`/api/reports/export/sequencer?batchId=${params.id}&decision=CONTACT`}>
                <Button variant="outline">
                  <Download className="h-4 w-4" />
                  Download Instantly CSV
                </Button>
              </a>
            </>
          ) : null}
          <Button variant="outline" disabled={removing || reports.length === 0} onClick={() => void removeAll()}>
            {removing ? "Removing…" : "Remove from queue"}
          </Button>
        </div>
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
          <div>
            CONTACT: <span className="font-medium text-success">{contact}</span>
          </div>
          <div>
            NURTURE: <span className="font-medium text-warning">{nurture}</span>
          </div>
          <div>
            SKIP: <span className="font-medium text-danger">{skip}</span>
          </div>
          <div>
            Needs review: <span className="font-medium">{review}</span>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-3 font-medium">Action list</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Decision</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Offer</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Conf.</th>
                <th className="px-4 py-3 font-medium">Review?</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{r.company}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.fullName || "—"}</td>
                  <td className="px-4 py-3">
                    {r.decision ? (
                      <Badge
                        tone={r.decision === "CONTACT" ? "success" : r.decision === "SKIP" ? "danger" : "warning"}
                      >
                        {r.decision}
                      </Badge>
                    ) : (
                      <StatusBadge status={r.status} />
                    )}
                  </td>
                  <td className="px-4 py-3">{r.priority || "—"}</td>
                  <td className="max-w-[140px] truncate px-4 py-3 text-muted-foreground">{r.firstOffer || "—"}</td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">{r.emailSubject || "—"}</td>
                  <td className="px-4 py-3">{r.confidence != null ? `${r.confidence}%` : "—"}</td>
                  <td className="px-4 py-3">{r.reviewFlag ? <Badge tone="warning">Yes</Badge> : "—"}</td>
                  <td className="px-4 py-3">
                    {r.status === "completed" ? (
                      <Link href={`/reports/${r.id}`} className="text-accent hover:underline">
                        Action
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.message}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {batchDone ? (
        <div className="flex flex-wrap gap-2">
          {contact > 0 ? (
            <Link href={`/reports/sending/${params.id}`}>
              <Button>Continue to Send Queue</Button>
            </Link>
          ) : null}
          <Link href="/reports">
            <Button variant="outline">All lists</Button>
          </Link>
          <a href={`/api/reports/export/sequencer?batchId=${params.id}&includeSkip=true`}>
            <Button variant="outline">Export all decisions CSV</Button>
          </a>
        </div>
      ) : null}
    </div>
  );
}
