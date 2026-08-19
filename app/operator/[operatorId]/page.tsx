"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ops/status-badge";
import { CopyLinkedin } from "@/components/copy-linkedin";

type Dash = {
  operator: { id: string; name: string; active: boolean };
  summary: {
    assignedToday: number;
    remainingToday: number;
    contactedToday: number;
    emails: number;
    calls: number;
    replies: number;
    meetings: number;
    target: number;
    completed: number;
    remainingCap: number;
  };
  leads: QueueLead[];
  queue: QueueLead[];
};

type QueueLead = {
  id: string;
  name: string;
  company: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  status: string;
  statuses?: string[];
};

export default function OperatorDeskPage() {
  const params = useParams<{ operatorId: string }>();
  const [dash, setDash] = useState<Dash | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/ops/operators/${params.operatorId}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setDash(d)))
      .catch((e) => setError(String(e)));
  }, [params.operatorId]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!dash) return <p className="text-muted-foreground">Loading desk…</p>;

  const s = dash.summary;
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted-foreground">Operator desk</p>
      <h1 className="mt-1 text-2xl font-semibold">{dash.operator.name}</h1>
      {!dash.operator.active ? (
        <p className="mt-2 text-sm text-warning">This desk is inactive. Ask admin if you still need access.</p>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Assigned today" value={s.assignedToday} />
        <Tile label="Remaining today" value={s.remainingToday} />
        <Tile label="Contacted today" value={s.contactedToday} />
        <Tile label="Daily cap left" value={s.remainingCap} />
        <Tile label="Emails" value={s.emails} />
        <Tile label="Calls" value={s.calls} />
        <Tile label="Replies" value={s.replies} />
        <Tile label="Meetings" value={s.meetings} />
      </div>
      <h2 className="mt-8 text-lg font-medium">Queue</h2>
      <div className="mt-3 space-y-2">
        {(dash.queue.length ? dash.queue : dash.leads).map((l) => (
          <Link key={l.id} href={`/operator/${params.operatorId}/leads/${l.id}`}>
            <Card className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40">
              <div className="min-w-0">
                <div className="font-medium">{l.name}</div>
                <div className="text-sm text-muted-foreground">
                  {l.company}
                  {l.title ? ` · ${l.title}` : ""}
                </div>
                <div
                  className="mt-1"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <CopyLinkedin url={l.linkedin} compact />
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                {(l.statuses?.length ? l.statuses : [l.status]).filter(Boolean).map((st) => (
                  <StatusBadge key={st} status={st} />
                ))}
              </div>
            </Card>
          </Link>
        ))}
        {!dash.leads.length ? <p className="text-sm text-muted-foreground">No leads assigned yet.</p> : null}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}
