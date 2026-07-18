import Link from "next/link";
import { FilePlus2, CheckCircle2, Loader2, XCircle, Files } from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { getDashboardStats, listReports } from "@/server/services/report-service";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const stats = getDashboardStats();
  const { items } = listReports({ pageSize: 8 });

  const cards = [
    { label: "Total Reports", value: stats.total, icon: Files, tone: "text-foreground" },
    { label: "Processing", value: stats.processing + stats.queued, icon: Loader2, tone: "text-warning" },
    { label: "Completed", value: stats.completed, icon: CheckCircle2, tone: "text-success" },
    { label: "Failed", value: stats.failed, icon: XCircle, tone: "text-danger" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Prospect intelligence pipeline overview</p>
        </div>
        <Link href="/reports/new">
          <Button>
            <FilePlus2 className="h-4 w-4" />
            New Report
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} className="p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">{c.label}</div>
                <Icon className={`h-4 w-4 ${c.tone}`} />
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight">{c.value}</div>
            </Card>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-medium">Recent reports</h2>
          <Link href="/reports" className="text-sm text-accent hover:underline">
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">
                    No reports yet. Upload a CSV to generate your first dossier.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <Link href={`/reports/${r.id}`} className="font-medium hover:text-accent">
                        {r.company}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{r.fullName || "—"}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(r.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
