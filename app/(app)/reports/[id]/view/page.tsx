"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ReportBrowserView } from "@/components/report-browser-view";
import { loadCachedReport } from "@/lib/report-cache";
import type { ProspectData } from "@/server/services/engine";

type Props = { params: Promise<{ id: string }> };

export default function ReportViewPage({ params }: Props) {
  const { id } = use(params);
  const [company, setCompany] = useState("");
  const [data, setData] = useState<ProspectData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/reports/${id}`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (!alive) return;
          setCompany(json.report?.company || "");
          setData(json.data || null);
          return;
        }
        const cached = loadCachedReport(id);
        if (cached?.data) {
          if (!alive) return;
          setCompany(cached.report.company);
          setData(cached.data as ProspectData);
          return;
        }
        if (alive) setError("Report data not found. Connect Vercel Blob and generate again.");
      } catch (e) {
        const cached = loadCachedReport(id);
        if (cached?.data && alive) {
          setCompany(cached.report.company);
          setData(cached.data as ProspectData);
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

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  if (!data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{error || "No research JSON available for this report yet."}</p>
        <Link href={`/reports/${id}`}>
          <Button variant="outline">Back to details</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href={`/reports/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Details
          </Button>
        </Link>
        <p className="text-sm text-muted-foreground">View full report in the browser — no download required.</p>
        <Link href={`/reports/${id}/document`} className="text-sm text-accent hover:underline">
          Prefer Word-style document view →
        </Link>
      </div>
      <ReportBrowserView reportId={id} company={company} data={data} />
    </div>
  );
}
