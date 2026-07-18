"use client";

import { use } from "react";
import { ReportDetailClient } from "@/components/report-detail-client";

type Props = { params: Promise<{ id: string }> };

export default function ReportDetailPage({ params }: Props) {
  const { id } = use(params);
  return <ReportDetailClient id={id} />;
}
