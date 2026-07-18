"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DocumentViewChrome, ReportDocumentView } from "@/components/report-document-view";
import { Button } from "@/components/ui/primitives";
import { loadCachedReport } from "@/lib/report-cache";

type Props = { params: Promise<{ id: string }> };

export default function ReportDocumentPage({ params }: Props) {
  const { id } = use(params);
  const [company, setCompany] = useState("");
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/reports/${id}`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (!alive) return;
          setCompany(json.report?.company || "Report");
          setReady(true);
          return;
        }
        const cached = loadCachedReport(id);
        if (cached) {
          if (!alive) return;
          setCompany(cached.report.company || "Report");
          setReady(true);
          return;
        }
        if (alive) setMissing(true);
      } catch {
        const cached = loadCachedReport(id);
        if (cached && alive) {
          setCompany(cached.report.company || "Report");
          setReady(true);
          return;
        }
        if (alive) setMissing(true);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [id]);

  if (missing) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Report not found.</p>
        <Link href="/reports">
          <Button variant="outline">Back</Button>
        </Link>
      </div>
    );
  }

  if (!ready) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <DocumentViewChrome reportId={id}>
      <ReportDocumentView reportId={id} company={company} />
    </DocumentViewChrome>
  );
}
