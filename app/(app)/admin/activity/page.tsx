"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Input } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";

type Event = {
  id: string;
  type: string;
  timestamp: string;
  metadata?: {
    note?: string;
    message?: { to?: string; subject?: string; body?: string };
    reset?: boolean;
    resetAt?: string;
  };
};

type Thread = {
  id: string;
  operatorId: string;
  operatorName: string;
  leadId: string;
  leadName: string;
  company: string;
  actionCount: number;
  lastType: string;
  lastAt: string;
  types: string[];
  reset?: boolean;
  events: Event[];
};

function label(type: string) {
  const names: Record<string, string> = {
    email_sent: "email sent",
    email_failed: "email not sent / failed",
    lead_opened: "opened lead",
    email_opened: "opened Gmail",
    call_clicked: "call clicked",
    call_no_answer: "call not connected",
    called: "called",
    called_cleared: "called undone",
    replied: "replied",
    replied_cleared: "replied undone",
    meeting: "meeting",
    meeting_cleared: "meeting undone",
    not_interested: "not interested",
    not_interested_cleared: "not interested undone",
    bounced: "bounced",
    bounced_cleared: "bounced undone",
    skipped: "skipped",
    skipped_cleared: "skipped undone",
    lead_reset: "lead reset — returned to pool",
    lead_deleted: "lead deleted from master pool",
  };
  return names[type] || type.replace(/_/g, " ");
}

export default function AdminActivityPage() {
  const [items, setItems] = useState<Thread[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [open, setOpen] = useState<Thread | null>(null);

  async function load() {
    const params = new URLSearchParams({ grouped: "1", pageSize: "80" });
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    const res = await fetch(`/api/ops/activity?${params}`);
    const data = await res.json();
    setItems(data.items || []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  return (
    <div>
      <OpsNav />
      <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        One row per operator and client. Open a row to see everything they did with that lead. Reset leads keep this history, marked Reset.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Input placeholder="Search operator or company" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Button variant="outline" onClick={() => void load()}>
          Search
        </Button>
        <select
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">Any action in the thread</option>
          {["lead_opened", "email_opened", "email_sent", "email_failed", "call_clicked", "call_no_answer", "called", "replied", "meeting", "skipped", "audit_created", "lead_reset", "lead_deleted"].map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </select>
      </div>
      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Operator</th>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Actions</th>
              <th className="px-3 py-2">Last</th>
              <th className="px-3 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr
                key={t.id}
                className="cursor-pointer border-b border-border/70 hover:bg-muted/40"
                onClick={() => setOpen(t)}
              >
                <td className="px-3 py-3 font-medium">{t.operatorName || "—"}</td>
                <td className="px-3 py-3">
                  {t.leadName || "—"}
                  {t.company ? <span className="text-muted-foreground"> · {t.company}</span> : null}
                </td>
                <td className="px-3 py-3">{t.actionCount}</td>
                <td className="px-3 py-3">
                  {label(t.lastType)}
                  {t.reset ? (
                    <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                      Reset
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {t.lastAt ? new Date(t.lastAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>
                  No operator–client activity yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16"
          onClick={() => setOpen(null)}
        >
          <Card
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {open.operatorName} → {open.leadName || "Lead"}
                </h2>
                <p className="text-sm text-muted-foreground">{open.company}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
            <Link href={`/admin/leads/${open.leadId}`} className="mt-2 inline-block text-sm text-accent hover:underline">
              Open lead
            </Link>
            <ol className="mt-4 space-y-3">
              {open.events.map((e) => (
                <li
                  key={e.id}
                  className={`rounded-lg border p-3 text-sm ${
                    e.type === "lead_reset"
                      ? "border-warning bg-warning/10"
                      : e.metadata?.reset
                        ? "border-border bg-muted/30 opacity-70"
                        : "border-border"
                  }`}
                >
                  <div className="flex justify-between gap-3">
                    <span className={`font-medium ${e.metadata?.reset && e.type !== "lead_reset" ? "line-through" : ""}`}>
                      {label(e.type)}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</span>
                  </div>
                  {e.metadata?.reset && e.type !== "lead_reset" ? (
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide text-warning">
                      Reset {e.metadata.resetAt ? `· ${new Date(e.metadata.resetAt).toLocaleString()}` : ""}
                    </p>
                  ) : null}
                  {e.metadata?.note ? <p className="mt-1 text-muted-foreground">{e.metadata.note}</p> : null}
                  {e.type.startsWith("email_") && e.metadata?.message?.body ? (
                    <div className="mt-2 rounded-md bg-muted/50 p-2">
                      <div className="text-xs text-muted-foreground">To {e.metadata.message.to}</div>
                      <div className="font-medium">{e.metadata.message.subject}</div>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{e.metadata.message.body}</pre>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
