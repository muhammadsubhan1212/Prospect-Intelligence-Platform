"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Card } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";
import { StatusBadge } from "@/components/ops/status-badge";
import { ActionCardPanel } from "@/components/action-card-panel";

export default function AdminLeadDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [operators, setOperators] = useState<{ id: string; name: string }[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch(`/api/ops/leads/${params.id}`);
    const json = await res.json();
    if (json.error) setError(json.error);
    else setData(json);
  }

  useEffect(() => {
    void load();
    fetch("/api/ops/operators")
      .then((r) => r.json())
      .then((d) => setOperators(d.operators || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const lead = (data?.lead || null) as {
    id: string;
    name: string;
    company: string;
    title?: string;
    email?: string;
    phone?: string;
    website?: string;
    location?: string;
    status: string;
    statuses?: string[];
    assignedTo?: string | null;
    lastDisclosure?: {
      at: string;
      action: string;
      note?: string;
      message?: { to?: string; subject?: string; body?: string };
    };
  } | null;

  async function remove() {
    if (!confirm("Delete this lead from the master pool?")) return;
    const res = await fetch(`/api/ops/leads/${params.id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.error) setError(json.error);
    else window.location.href = "/admin/leads";
  }

  async function reassign() {
    if (!operatorId) return;
    const res = await fetch(`/api/ops/leads/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorId }),
    });
    const json = await res.json();
    if (json.error) setError(json.error);
    else await load();
  }

  if (!lead && !error) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div>
      <OpsNav />
      <Link href="/admin/leads" className="text-sm text-muted-foreground hover:underline">
        ← Leads
      </Link>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {lead ? (
        <>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{lead.name}</h1>
              <p className="text-muted-foreground">{lead.company}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {(lead.statuses?.length ? lead.statuses : [lead.status]).map((s) => (
                <StatusBadge key={s} status={s} />
              ))}
            </div>
          </div>
          <Card className="mt-4 grid gap-2 p-5 text-sm sm:grid-cols-2">
            <div>Title: {lead.title || "—"}</div>
            <div>Email: {lead.email || "—"}</div>
            <div>Phone: {lead.phone || "—"}</div>
            <div>Website: {lead.website || "—"}</div>
            <div>Location: {lead.location || "—"}</div>
            <div>Assigned: {String(data?.assignedName || "—")}</div>
          </Card>
          <Card className="mt-4 p-5">
            <h2 className="font-medium">Reassign</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
                value={operatorId}
                onChange={(e) => setOperatorId(e.target.value)}
              >
                <option value="">Select operator</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <Button type="button" onClick={() => void reassign()} disabled={!operatorId}>
                Reassign
              </Button>
              <Button type="button" variant="danger" onClick={() => void remove()}>
                Delete lead
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Reassignment changes current owner. It does not make the lead available for a fresh outreach batch.
            </p>
          </Card>
          <div className="mt-4">
            <ActionCardPanel compact company={lead.company} actionCard={data?.actionCard as never} />
          </div>
          {lead.lastDisclosure ? (
            <Card className="mt-4 space-y-2 p-5">
              <h2 className="font-medium">What the operator showed admin</h2>
              <p className="text-xs text-muted-foreground">
                {lead.lastDisclosure.action.replace(/_/g, " ")} · {new Date(lead.lastDisclosure.at).toLocaleString()}
              </p>
              {lead.lastDisclosure.note ? <p className="text-sm">{lead.lastDisclosure.note}</p> : null}
              {lead.lastDisclosure.message ? (
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">To:</span> {lead.lastDisclosure.message.to}
                  </div>
                  <div className="mt-1 font-medium">{lead.lastDisclosure.message.subject}</div>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{lead.lastDisclosure.message.body}</pre>
                </div>
              ) : null}
            </Card>
          ) : null}
          <Card className="mt-4 p-5">
            <h2 className="font-medium">Operator actions on this lead</h2>
            <ul className="mt-3 space-y-3 text-sm">
              {((data?.activities as {
                id: string;
                type: string;
                timestamp: string;
                metadata?: { note?: string; message?: { to?: string; subject?: string; body?: string } };
              }[]) || []).map((a) => (
                <li key={a.id} className="rounded-lg border border-border/70 p-3">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{a.type.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">{new Date(a.timestamp).toLocaleString()}</span>
                  </div>
                  {a.metadata?.note ? <p className="mt-1 text-muted-foreground">{a.metadata.note}</p> : null}
                  {a.metadata?.message?.body ? (
                    <div className="mt-2 rounded bg-muted/40 p-2">
                      <div className="text-xs text-muted-foreground">To {a.metadata.message.to}</div>
                      <div className="font-medium">{a.metadata.message.subject}</div>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{a.metadata.message.body}</pre>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}
