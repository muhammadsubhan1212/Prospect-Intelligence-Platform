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
  opened?: boolean;
  emailed?: boolean;
  called?: boolean;
  reset?: boolean;
  events: Event[];
};

type OperatorOpt = { id: string; name: string; active: boolean };

type Summary = {
  threads: number;
  opened: number;
  emailed: number;
  called: number;
  actions: number;
};

type OperatorBucket = {
  operatorId: string;
  operatorName: string;
  threads: number;
  opened: number;
  emailed: number;
  called: number;
  actions: number;
};

type AssignedLead = {
  leadId: string;
  leadName: string;
  company: string;
  status: string;
  operatorId: string;
  operatorName: string;
  assignedAt: string;
};

type AssignedBlock = {
  count: number;
  byOperator: { operatorId: string; operatorName: string; count: number }[];
  items: AssignedLead[];
};

type DayFilter = "today" | "yesterday" | "all";

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

function localDayRange(day: DayFilter): { from?: string; to?: string; label: string } {
  if (day === "all") return { label: "All time" };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (day === "yesterday") start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label: day === "today" ? "Today" : "Yesterday",
  };
}

export default function AdminActivityPage() {
  const [items, setItems] = useState<Thread[]>([]);
  const [operators, setOperators] = useState<OperatorOpt[]>([]);
  const [byOperator, setByOperator] = useState<OperatorBucket[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [assigned, setAssigned] = useState<AssignedBlock | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [userId, setUserId] = useState("");
  const [day, setDay] = useState<DayFilter>("today");
  const [open, setOpen] = useState<Thread | null>(null);
  const [showAssigned, setShowAssigned] = useState(true);

  async function loadOperators() {
    const res = await fetch("/api/ops/operators");
    const data = await res.json();
    setOperators((data.operators as OperatorOpt[]) || []);
  }

  async function load() {
    const range = localDayRange(day);
    const params = new URLSearchParams({ grouped: "1", pageSize: "120" });
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    if (userId) params.set("userId", userId);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const res = await fetch(`/api/ops/activity?${params}`);
    const data = await res.json();
    setItems(data.items || []);
    setSummary(data.summary || null);
    setByOperator(data.byOperator || []);
    setAssigned(data.assigned || null);
  }

  useEffect(() => {
    void loadOperators();
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, userId, day]);

  const dayLabel = localDayRange(day).label;

  return (
    <div>
      <OpsNav />
      <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Operator work only (opens, emails, calls). Admin assigning leads does not count as activity — those show
        separately under Assigned.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["today", "Today"],
          ["yesterday", "Yesterday"],
          ["all", "All time"],
        ] as const).map(([value, text]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={day === value ? "secondary" : "outline"}
            onClick={() => setDay(value)}
          >
            {text}
          </Button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <select
          className="h-10 min-w-[12rem] rounded-lg border border-border bg-card px-3 text-sm"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">All operators</option>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {!o.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
        <Input placeholder="Search operator or company" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Button variant="outline" onClick={() => void load()}>
          Search
        </Button>
        <select
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">Any work action</option>
          {[
            "lead_opened",
            "email_opened",
            "email_sent",
            "email_failed",
            "call_clicked",
            "call_no_answer",
            "called",
            "replied",
            "meeting",
            "skipped",
            "audit_created",
          ].map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </select>
      </div>

      {summary ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            ["Work threads", summary.threads],
            ["Opened", summary.opened],
            ["Email touch", summary.emailed],
            ["Call touch", summary.called],
            ["Work actions", summary.actions],
            ["Assigned", assigned?.count ?? 0],
          ].map(([name, value]) => (
            <Card key={String(name)} className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {dayLabel} · {name}
              </div>
              <div className="mt-1 text-2xl font-semibold">{value}</div>
            </Card>
          ))}
        </div>
      ) : null}

      {assigned && assigned.count > 0 ? (
        <Card className="mt-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="text-sm font-medium">
              Assigned by admin · {dayLabel}
              <span className="ml-2 font-normal text-muted-foreground">
                ({assigned.count} lead{assigned.count === 1 ? "" : "s"} — not counted as work activity)
              </span>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAssigned((v) => !v)}>
              {showAssigned ? "Hide list" : "Show list"}
            </Button>
          </div>
          {!userId && assigned.byOperator.length ? (
            <div className="flex flex-wrap gap-2 border-b border-border px-3 py-3">
              {assigned.byOperator.map((o) => (
                <button
                  key={o.operatorId}
                  type="button"
                  className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
                  onClick={() => setUserId(o.operatorId)}
                >
                  {o.operatorName}: <span className="font-semibold">{o.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {showAssigned ? (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Operator</th>
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Assigned at</th>
                </tr>
              </thead>
              <tbody>
                {assigned.items.map((row) => (
                  <tr key={`${row.operatorId}-${row.leadId}`} className="border-b border-border/70">
                    <td className="px-3 py-2 font-medium">{row.operatorName}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/leads/${row.leadId}`} className="text-accent hover:underline">
                        {row.leadName || "—"}
                      </Link>
                      {row.company ? <span className="text-muted-foreground"> · {row.company}</span> : null}
                    </td>
                    <td className="px-3 py-2">{row.status.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(row.assignedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      ) : null}

      {!userId && byOperator.length ? (
        <Card className="mt-4 overflow-x-auto">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">
            Operator work · {dayLabel}
          </div>
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Operator</th>
                <th className="px-3 py-2">Leads touched</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Call</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {byOperator.map((o) => (
                <tr
                  key={o.operatorId}
                  className="cursor-pointer border-b border-border/70 hover:bg-muted/40"
                  onClick={() => setUserId(o.operatorId)}
                >
                  <td className="px-3 py-3 font-medium">{o.operatorName}</td>
                  <td className="px-3 py-3">{o.threads}</td>
                  <td className="px-3 py-3">{o.opened}</td>
                  <td className="px-3 py-3">{o.emailed}</td>
                  <td className="px-3 py-3">{o.called}</td>
                  <td className="px-3 py-3">{o.actions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {userId ? (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Showing</span>
          <span className="font-medium">{operators.find((o) => o.id === userId)?.name || "operator"}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setUserId("")}>
            Clear operator
          </Button>
        </div>
      ) : null}

      <Card className="mt-4 overflow-x-auto">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">Work activity · {dayLabel}</div>
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
                  No operator work activity for {dayLabel.toLowerCase()}.
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
          <Card className="max-h-[80vh] w-full max-w-2xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
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
