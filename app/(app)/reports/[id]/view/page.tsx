import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ReportBrowserView } from "@/components/report-browser-view";
import { getReport, getReportJson } from "@/server/services/report-service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function ReportViewPage({ params }: Props) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();
  const data = await getReportJson(id);
  if (!data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">No research JSON available for this report yet.</p>
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
      <ReportBrowserView reportId={report.id} company={report.company} data={data} />
    </div>
  );
}
