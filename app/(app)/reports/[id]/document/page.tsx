import { notFound } from "next/navigation";
import { DocumentViewChrome, ReportDocumentView } from "@/components/report-document-view";
import { getReport } from "@/server/services/report-service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function ReportDocumentPage({ params }: Props) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();

  return (
    <DocumentViewChrome reportId={report.id}>
      <ReportDocumentView reportId={report.id} company={report.company} />
    </DocumentViewChrome>
  );
}
