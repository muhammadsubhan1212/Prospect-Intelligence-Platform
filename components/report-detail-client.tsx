"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, Maximize2, FileText } from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { ActionCardPanel, type ActionCardData } from "@/components/action-card-panel";
import { formatDate } from "@/lib/utils";
import { loadCachedReport, type CachedReportPayload } from "@/lib/report-cache";

type ProspectLike = {
  actionCard?: ActionCardData;
  outreachOutcome?: { status?: string };
  executiveSummary?: { paragraphs?: string[]; verdict?: string };
  bestFirstOffer?: { offer?: string; why?: string };
  finalRecommendation?: { priority?: string; verdict?: string };
  websiteAudit?: { overallScore?: number; analyzedUrl?: string };
  painPoints?: Array<{ pain: string; evidence: string }>;
};

type Props = { id: string };

export function ReportDetailClient({ id }: Props) {
  const [payload, setPayload] = useState<CachedReportPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [outcome, setOutcome] = useState<string>("not_sent");

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/reports/${id}`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as CachedReportPayload;
          if (!alive) return;
          setPayload(json);
          const o =
            (json.report as { outreachOutcome?: { status?: string } })?.outreachOutcome?.status ||
            (json.data as ProspectLike | undefined)?.outreachOutcome?.status ||
            "not_sent";
          setOutcome(o);
          return;
        }
        const cached = loadCachedReport(id);
        if (cached) {
          if (!alive) return;
          setPayload(cached);
          return;
        }
        if (!alive) return;
        setError(
          res.status === 404
            ? "Report not found on this server instance. If you just generated it, connect Vercel Blob (Storage → Blob → Connect) and generate again — or open the report from the same tab right after Generate."
            : `Failed to load report (${res.status})`
        );
      } catch (e) {
        const cached = loadCachedReport(id);
        if (cached && alive) {
          setPayload(cached);
          return;
        }
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [id]);

  async function copyJson() {
    const data = payload?.data;
    if (!data) return;
    const text = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function onOutcomeChange(status: "not_sent" | "sent" | "replied" | "meeting" | "not_interested" | "bounced") {
    setOutcome(status);
    try {
      await fetch(`/api/reports/${id}/outcome`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      /* keep local selection */
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading report…</div>;
  }

  if (!payload?.report) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">Report unavailable</h1>
        <p className="text-sm text-muted-foreground">{error || "Not found."}</p>
        <Link href="/reports">
          <Button variant="outline">Back to reports</Button>
        </Link>
      </div>
    );
  }

  const report = payload.report;
  const data = payload.data as ProspectLike | undefined;
  const exec = data?.executiveSummary;
  const offer = data?.bestFirstOffer;
  const finalRec = data?.finalRecommendation;
  const audit = data?.websiteAudit;
  const pains = data?.painPoints || [];
  const card = data?.actionCard;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2">
            <StatusBadge status={report.status} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{report.company}</h1>
          <p className="text-sm text-muted-foreground">
            {report.fullName} · {report.industry || "—"} · Created {formatDate(report.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {report.status === "completed" ? (
            <a
              href={`/api/reports/export/sequencer`}
              onClick={async (e) => {
                e.preventDefault();
                const res = await fetch("/api/reports/export/sequencer", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reportIds: [report.id], decisions: ["CONTACT", "NURTURE"] }),
                });
                if (!res.ok) return;
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `sequencer_${report.company || report.id}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Button>
                <Download className="h-4 w-4" />
                Download Instantly CSV
              </Button>
            </a>
          ) : null}
          {report.status === "completed" ? (
            <Link href={`/reports/${report.id}/view`}>
              <Button variant="outline">
                <Maximize2 className="h-4 w-4" />
                Full research
              </Button>
            </Link>
          ) : null}
          {report.status === "completed" ? (
            <Link href={`/reports/${report.id}/document`}>
              <Button variant="outline">
                <FileText className="h-4 w-4" />
                Full dossier (optional)
              </Button>
            </Link>
          ) : null}
          <Link href="/reports">
            <Button variant="outline">Back</Button>
          </Link>
        </div>
      </div>

      {report.status === "completed" ? (
        <ActionCardPanel
          reportId={report.id}
          company={report.company}
          actionCard={card}
          outcomeStatus={outcome as "not_sent"}
          onOutcomeChange={onOutcomeChange}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Website score</div>
          <div className="mt-1 text-2xl font-semibold">
            {report.websiteScore ?? audit?.overallScore ?? "—"}/100
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Priority / Confidence</div>
          <div className="mt-1 text-2xl font-semibold">
            {card?.priority || report.priority || finalRec?.priority || "—"}
            {(card?.confidence ?? report.confidence) != null
              ? ` · ${card?.confidence ?? report.confidence}%`
              : ""}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Decision</div>
          <div className="mt-1 text-2xl font-semibold">
            {card?.decision || report.verdict || finalRec?.verdict || "—"}
          </div>
        </Card>
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">Research snapshot</h2>
        {(exec?.paragraphs || []).map((p, i) => (
          <p key={i} className="text-sm text-muted-foreground">
            {p}
          </p>
        ))}
        {!exec?.paragraphs?.length ? (
          <p className="text-sm text-muted-foreground">No summary stored yet.</p>
        ) : null}
      </Card>

      <Card className="space-y-2 p-5">
        <h2 className="font-medium">Best first offer</h2>
        <p className="text-sm font-medium text-accent">
          {card?.firstOffer || report.firstOffer || offer?.offer || "—"}
        </p>
        {card?.offerWhy || offer?.why ? (
          <p className="text-sm text-muted-foreground">{card?.offerWhy || offer?.why}</p>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-medium">Pain points</h2>
        {pains.length ? (
          <ul className="space-y-2 text-sm">
            {pains.map((p, i) => (
              <li key={i} className="rounded-lg bg-muted/50 p-3">
                <div className="font-medium">{p.pain}</div>
                <div className="text-muted-foreground">{p.evidence}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Not enough public information.</p>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Research JSON</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Power-user archive — not the primary action surface.</p>
          </div>
          {data ? (
            <Button size="sm" variant="outline" onClick={() => void copyJson()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy JSON"}
            </Button>
          ) : null}
        </div>
        {data ? (
          <pre className="max-h-[320px] overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
            {JSON.stringify(data.actionCard || data, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">Metadata JSON not available for this report.</p>
        )}
      </Card>

      {report.error ? (
        <Card className="border-danger/40 p-5">
          <h2 className="mb-2 font-medium text-danger">Error</h2>
          <p className="text-sm">{report.error}</p>
        </Card>
      ) : null}
    </div>
  );
}
