import { Badge } from "@/components/ui/primitives";

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "success"
      : status === "failed"
        ? "danger"
        : status === "processing"
          ? "warning"
          : "muted";
  return <Badge tone={tone as "success" | "danger" | "warning" | "muted"}>{status}</Badge>;
}
