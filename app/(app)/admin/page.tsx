"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";

type Stats = {
  pool: { total: number; allocated: number; available: number; assigned: number; contacted: number };
  outreach: { emailsSent: number; calls: number; replies: number; meetings: number };
  operators: { total: number; active: number };
  today: { assigned: number; contacted: number; remaining: number; emails: number; calls: number; target: number };
  performance: { replyRate: number; meetingRate: number };
  byOperator: { id: string; name: string; allocated: number; assignedNow: number }[];
  batches: { id: string; userName: string; count: number; createdAt: string }[];
};

function pct(n: number) {
  return `${Math.round((n || 0) * 1000) / 10}%`;
}

export default function AdminHomePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/ops/stats")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setStats(d)))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <OpsNav />
      <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
      <p className="mt-1 text-sm text-muted-foreground">Master lead pool, operators, and outreach activity.</p>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {!stats ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Master leads" value={stats.pool.total} href="/admin/leads" />
            <Stat label="Allocated for outreach" value={stats.pool.allocated} />
            <Stat label="Available for outreach" value={stats.pool.available} />
            <Stat label="Active operators" value={stats.operators.active} href="/admin/operators" />
            <Stat label="Emails sent" value={stats.outreach.emailsSent} />
            <Stat label="Calls" value={stats.outreach.calls} />
            <Stat label="Replies" value={stats.outreach.replies} />
            <Stat label="Meetings" value={stats.outreach.meetings} />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-medium">Today</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Assigned {stats.today.assigned} · Contacted {stats.today.contacted} · Remaining {stats.today.remaining}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Target {stats.today.target} · Emails {stats.today.emails} · Calls {stats.today.calls}
              </p>
              <p className="mt-3 text-sm">
                Reply rate {pct(stats.performance.replyRate)} · Meeting rate {pct(stats.performance.meetingRate)}
              </p>
            </Card>
            <Card className="p-5">
              <h2 className="font-medium">Operators</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {stats.byOperator.length ? (
                  stats.byOperator.map((op) => (
                    <li key={op.id} className="flex justify-between gap-3">
                      <Link href={`/operator/${op.id}`} className="text-accent hover:underline">
                        {op.name}
                      </Link>
                      <span className="text-muted-foreground">
                        {op.assignedNow} assigned · {op.allocated} allocated
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-muted-foreground">No operators yet.</li>
                )}
              </ul>
            </Card>
          </div>
          {stats.batches?.length ? (
            <Card className="mt-4 p-5">
              <h2 className="font-medium">Recent allocation batches</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {stats.batches.map((b) => (
                  <li key={b.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {b.userName} · {b.count} leads
                    </span>
                    <span className="text-muted-foreground">
                      {b.id} · {new Date(b.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
