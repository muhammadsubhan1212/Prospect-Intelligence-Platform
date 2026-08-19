"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FilePlus2,
  CheckCircle2,
  Loader2,
  XCircle,
  Files,
  Trash2,
  Download,
  AlertTriangle,
  Mail,
} from "lucide-react";
import { Card, Button, Checkbox, Badge } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { formatDate } from "@/lib/utils";
import { GTM, PRODUCT } from "@/lib/gtm-defaults";
import { CopyLinkedin } from "@/components/copy-linkedin";

type Report = {
  id: string;
  batchId?: string;
  company: string;
  fullName: string;
  linkedin?: string;
  status: string;
  createdAt: string;
  decision?: string;
  priority?: string;
  firstOffer?: string;
  reviewFlag?: boolean;
};

type OfferRow = {
  offer: string;
  sent: number;
  replied: number;
  meeting: number;
  replyRate: number;
};

type Stats = {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  needsReview?: number;
  lastBatch?: {
    id: string;
    filename: string;
    contact: number;
    nurture: number;
    skip: number;
    needsReview: number;
    total: number;
  } | null;
  outcomes30d?: {
    sent: number;
    replied: number;
    meeting: number;
    not_interested?: number;
    bounced?: number;
    replyRate?: number;
    meetingRate?: number;
    byOffer?: OfferRow[];
  };
  ruleOf100?: { target: number; progress: number };
  sendToday?: {
    sendsToday: number;
    dailyCap: number;
    sendLocked: boolean;
    nextUnlockAt: string;
  };
  sendQueue?: {
    pending: number;
    openedGmail: number;
    sent: number;
    continueBatchId: string | null;
  };
};

function pct(rate: number | undefined) {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

function StatLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`block transition-colors hover:bg-muted/50 ${className || ""}`}>
      {children}
    </Link>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Report[]>([]);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    const res = await fetch("/api/reports?page=1&pageSize=12");
    const json = await res.json();
    setStats(json.stats || null);
    setItems(json.items || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onDelete(id: string, company: string) {
    if (!confirm(`Remove “${company}” from lists? This deletes queued/stuck jobs too.`)) return;
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    startTransition(() => {
      void load();
      router.refresh();
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = items.length > 0 && items.every((r) => selected.has(r.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const r of items) next.delete(r.id);
      } else {
        for (const r of items) next.add(r.id);
      }
      return next;
    });
  }

  const lb = stats?.lastBatch;
  const o = stats?.outcomes30d;
  const rule = stats?.ruleOf100;
  const ruleTarget = rule?.target ?? GTM.ruleOf100Target;
  const ruleProgress = rule?.progress ?? 0;
  const rulePct = Math.min(100, Math.round((ruleProgress / ruleTarget) * 100));
  const hasProof = (o?.sent ?? 0) > 0;
  const st = stats?.sendToday;
  const sq = stats?.sendQueue;
  const continueId = sq?.continueBatchId || lb?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{PRODUCT.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{PRODUCT.promise}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {continueId && (sq?.pending ?? 0) > 0 ? (
            <Link href={`/reports/sending/${continueId}`}>
              <Button>
                <Mail className="h-4 w-4" />
                Continue Send Queue ({sq?.pending})
              </Button>
            </Link>
          ) : null}
          {lb ? (
            <a href={`/api/reports/export/sequencer?batchId=${lb.id}&decision=CONTACT`}>
              <Button variant={sq?.pending ? "outline" : "default"}>
                <Download className="h-4 w-4" />
                Export last CONTACT CSV
              </Button>
            </a>
          ) : null}
          <Link href="/reports/new">
            <Button variant="outline">
              <FilePlus2 className="h-4 w-4" />
              New run
            </Button>
          </Link>
        </div>
      </div>

      {st?.sendLocked ? (
        <Card className="border-warning/40 bg-warning/5 p-4 text-sm">
          Daily send goal reached ({st.sendsToday}/{st.dailyCap}). Next unlock:{" "}
          {st.nextUnlockAt ? new Date(st.nextUnlockAt).toLocaleString() : "local midnight"}. Analysis & Instantly
          export still work.
        </Card>
      ) : null}

      <StatLink href={continueId ? `/reports/sending/${continueId}` : "/reports?outcome=sent&page=1"}>
        <Card className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-medium">Rule of {ruleTarget}</h2>
              <p className="text-sm text-muted-foreground">
                Sent today {st?.sendsToday ?? 0}/{st?.dailyCap ?? GTM.dailySendCap} · Pending in queue{" "}
                {sq?.pending ?? 0} · Done (queue sent) {sq?.sent ?? 0}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tracking-tight">
                {ruleProgress}
                <span className="text-base font-normal text-muted-foreground"> / {ruleTarget}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${rulePct}%` }} />
          </div>
        </Card>
      </StatLink>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatLink href="/reports?outcome=sent&page=1">
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">Sent today</div>
            <div className="mt-2 text-3xl font-semibold">{st?.sendsToday ?? 0}</div>
          </Card>
        </StatLink>
        <StatLink href={continueId ? `/reports/sending/${continueId}` : "/reports?decision=CONTACT&page=1"}>
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">Pending in queue</div>
            <div className="mt-2 text-3xl font-semibold text-warning">{sq?.pending ?? 0}</div>
          </Card>
        </StatLink>
        <StatLink href="/reports?sendQueueStatus=sent&page=1">
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">Done (confirmed sent)</div>
            <div className="mt-2 text-3xl font-semibold text-success">{sq?.sent ?? 0}</div>
          </Card>
        </StatLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatLink href="/reports?outcome=replied&page=1">
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">Reply rate (30d)</div>
            <div className="mt-2 text-4xl font-semibold tracking-tight">{hasProof ? pct(o?.replyRate) : "—"}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasProof ? `${o?.replied ?? 0} replied / ${o?.sent ?? 0} sent` : "Mark outcomes after you send"}
            </p>
          </Card>
        </StatLink>
        <StatLink href="/reports?outcome=meeting&page=1">
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">Meeting rate (30d)</div>
            <div className="mt-2 text-4xl font-semibold tracking-tight">{hasProof ? pct(o?.meetingRate) : "—"}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasProof ? `${o?.meeting ?? 0} meetings / ${o?.sent ?? 0} sent` : "Meetings unlock pricing proof"}
            </p>
          </Card>
        </StatLink>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-medium">Proof by offer (30d)</h2>
          <p className="text-xs text-muted-foreground">Click a row to open filtered lists.</p>
        </div>
        {!hasProof ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No outcomes yet.{" "}
            <Link href="/reports/new" className="text-accent hover:underline">
              New run
            </Link>
            {" · "}
            {lb ? (
              <Link href={`/reports/sending/${lb.id}`} className="text-accent hover:underline">
                Open queue
              </Link>
            ) : (
              <span>Open queue</span>
            )}
            {" · "}
            {lb ? (
              <a
                href={`/api/reports/export/sequencer?batchId=${lb.id}&decision=CONTACT`}
                className="text-accent hover:underline"
              >
                Export
              </a>
            ) : (
              "Export"
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Offer</th>
                  <th className="px-5 py-3 font-medium">Sent</th>
                  <th className="px-5 py-3 font-medium">Replied</th>
                  <th className="px-5 py-3 font-medium">Meetings</th>
                  <th className="px-5 py-3 font-medium">Reply %</th>
                </tr>
              </thead>
              <tbody>
                {(o?.byOffer || []).map((row) => (
                  <tr key={row.offer} className="border-t border-border hover:bg-muted/40">
                    <td className="px-5 py-3 font-medium">
                      <Link
                        href={`/reports?offer=${encodeURIComponent(row.offer)}&page=1`}
                        className="hover:text-accent"
                      >
                        {row.offer}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{row.sent}</td>
                    <td className="px-5 py-3">{row.replied}</td>
                    <td className="px-5 py-3">{row.meeting}</td>
                    <td className="px-5 py-3">{pct(row.replyRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
              Also (30d): not interested {o?.not_interested ?? 0} · bounced {o?.bounced ?? 0}
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatLink href={lb ? `/reports?batchId=${lb.id}&decision=CONTACT&page=1` : "/reports?decision=CONTACT&page=1"}>
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">Last batch · CONTACT</div>
            <div className="mt-3 text-3xl font-semibold tracking-tight text-success">{lb?.contact ?? "—"}</div>
          </Card>
        </StatLink>
        <StatLink href={lb ? `/reports?batchId=${lb.id}&decision=NURTURE&page=1` : "/reports?decision=NURTURE&page=1"}>
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">Last batch · NURTURE</div>
            <div className="mt-3 text-3xl font-semibold tracking-tight text-warning">{lb?.nurture ?? "—"}</div>
          </Card>
        </StatLink>
        <StatLink href={lb ? `/reports?batchId=${lb.id}&decision=SKIP&page=1` : "/reports?decision=SKIP&page=1"}>
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">Last batch · SKIP</div>
            <div className="mt-3 text-3xl font-semibold tracking-tight text-danger">{lb?.skip ?? "—"}</div>
          </Card>
        </StatLink>
        <StatLink href="/reports?reviewOnly=true&page=1">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Needs review</div>
              <AlertTriangle className="h-4 w-4 text-warning" />
            </div>
            <div className="mt-3 text-3xl font-semibold tracking-tight">
              {stats?.needsReview ?? lb?.needsReview ?? "—"}
            </div>
          </Card>
        </StatLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            Total <Files className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1 text-xl font-semibold">{stats?.total ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            Processing <Loader2 className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1 text-xl font-semibold">{stats ? stats.processing + stats.queued : "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            Completed <CheckCircle2 className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1 text-xl font-semibold">{stats?.completed ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            Failed <XCircle className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1 text-xl font-semibold">{stats?.failed ?? "—"}</div>
        </Card>
      </div>

      <BulkActionBar selectedIds={[...selected]} onClear={() => setSelected(new Set())} onDeleted={() => void load()} />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-medium">Recent action cards</h2>
          <Link href="/reports" className="text-sm text-accent hover:underline">
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">
                  {items.length > 0 ? <Checkbox checked={allSelected} onChange={toggleSelectAll} /> : null}
                </th>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-5 py-3 font-medium">LinkedIn</th>
                <th className="px-5 py-3 font-medium">Decision</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium">Manage</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                    No lists yet.{" "}
                    <Link href="/reports/new" className="text-accent hover:underline">
                      Upload a CSV
                    </Link>
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-t border-border hover:bg-muted/40 ${selected.has(r.id) ? "bg-accent/5" : ""}`}
                  >
                    <td className="px-5 py-3">
                      <Checkbox checked={selected.has(r.id)} onChange={() => toggleSelected(r.id)} />
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/reports/${r.id}`} className="font-medium hover:text-accent">
                        {r.company}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{r.fullName || "—"}</td>
                    <td className="px-5 py-3">
                      <CopyLinkedin url={r.linkedin} compact />
                    </td>
                    <td className="px-5 py-3">
                      {r.decision ? (
                        <Badge
                          tone={
                            r.decision === "CONTACT" ? "success" : r.decision === "SKIP" ? "danger" : "warning"
                          }
                        >
                          {r.decision}
                          {r.reviewFlag ? " · review" : ""}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(r.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/reports/${r.id}`} className="text-accent hover:underline">
                          Action
                        </Link>
                        <button
                          type="button"
                          disabled={pending}
                          className="inline-flex items-center gap-1 text-danger hover:underline disabled:opacity-50"
                          onClick={() => void onDelete(r.id, r.company)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    </td>
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
