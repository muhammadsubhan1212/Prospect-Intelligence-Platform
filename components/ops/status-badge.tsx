import { Badge } from "@/components/ui/primitives";
import type { LeadStatus } from "@/server/ops/types";

const LABELS: Record<string, string> = {
  not_contacted: "Not contacted",
  sent: "Sent",
  called: "Called",
  replied: "Replied",
  meeting: "Meeting",
  not_interested: "Not interested",
  bounced: "Bounced",
  skipped: "Skipped",
};

export function statusLabel(status?: string) {
  return LABELS[status || ""] || status || "—";
}

export function StatusBadge({ status }: { status?: LeadStatus | string }) {
  const tone =
    status === "meeting" || status === "replied"
      ? "success"
      : status === "bounced" || status === "not_interested"
        ? "danger"
        : status === "sent" || status === "called"
          ? "warning"
          : "muted";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}
