"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Card, Input } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ops/status-badge";
import { ActionCardPanel, type ActionCardData } from "@/components/action-card-panel";
import { buildGmailComposeUrl, openGmailComposeWindow } from "@/components/send-email-dialog";
import { CopyLinkedin } from "@/components/copy-linkedin";

const OUTCOMES = [
  { action: "email_sent", label: "Sent", status: "sent" },
  { action: "called", label: "Called", status: "called" },
  { action: "replied", label: "Replied", status: "replied" },
  { action: "meeting", label: "Meeting", status: "meeting" },
  { action: "not_interested", label: "Not interested", status: "not_interested" },
  { action: "bounced", label: "Bounced", status: "bounced" },
  { action: "skipped", label: "Skipped", status: "skipped" },
];

export default function OperatorLeadPage() {
  const params = useParams<{ operatorId: string; leadId: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [auditId, setAuditId] = useState("");
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [callOpen, setCallOpen] = useState(false);
  const [callNotes, setCallNotes] = useState("");
  const [callError, setCallError] = useState("");

  async function load() {
    const res = await fetch(`/api/ops/leads/${params.leadId}`);
    const json = await res.json();
    if (json.error) setError(json.error);
    else {
      setData(json);
      const lead = json.lead || {};
      const card = json.actionCard as ActionCardData | null;
      setTo((prev) => prev || lead.email || card?.email?.to || "");
      setSubject((prev) => prev || card?.email?.subject || "");
      setBody((prev) => prev || card?.email?.body || "");
    }
  }

  useEffect(() => {
    void load();
    void fetch(`/api/ops/leads/${params.leadId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorId: params.operatorId, action: "lead_opened" }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.leadId]);

  const lead = data?.lead as {
    id: string;
    name: string;
    company: string;
    title?: string;
    email?: string;
    phone?: string;
    website?: string;
    linkedin?: string;
    location?: string;
    status: string;
    statuses?: string[];
  } | null;
  const card = (data?.actionCard || null) as ActionCardData | null;
  const marked = new Set(
    lead?.statuses?.length ? lead.statuses : lead?.status && lead.status !== "not_contacted" ? [lead.status] : []
  );

  function ping(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2500);
  }

  async function act(action: string, extra?: { openEmail?: boolean; note?: string; closeCall?: boolean; toggle?: boolean }) {
    setBusy(action);
    setError("");
    try {
      const res = await fetch(`/api/ops/leads/${params.leadId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorId: params.operatorId,
          action,
          note: extra?.note ?? note,
          toggle: extra?.toggle,
          message:
            action === "email_sent" || action === "email_opened" || extra?.openEmail
              ? { to, subject, body }
              : undefined,
        }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return false;
      }
      if (extra?.openEmail) {
        const url = buildGmailComposeUrl({ to, subject, body });
        const win = openGmailComposeWindow(url);
        if (!win) window.open(url, "_blank");
      }
      if (extra?.closeCall) {
        setCallOpen(false);
        setCallNotes("");
        setCallError("");
      }
      await load();
      return true;
    } finally {
      setBusy("");
    }
  }

  async function call() {
    const phone = lead?.phone || "";
    if (phone) {
      try {
        await navigator.clipboard.writeText(phone);
        ping("Phone number copied");
      } catch {
        ping(phone);
      }
    } else {
      ping("No phone on this lead — still log the call");
    }
    setCallNotes(note);
    setCallError("");
    setCallOpen(true);
  }

  async function saveCall(connected: boolean) {
    const discussed = callNotes.trim();
    if (connected && discussed.length < 4) {
      setCallError("Enter what was discussed, then press Yes.");
      return;
    }
    if (!connected && discussed.length < 2) {
      setCallError("Enter why the call did not happen, then press No.");
      return;
    }
    const ok = await act(connected ? "called" : "call_no_answer", {
      note: discussed,
      closeCall: true,
      toggle: false,
    });
    if (ok) ping(connected ? "Call saved" : "Logged as no answer / not connected");
  }

  async function research() {
    setBusy("research");
    try {
      const res = await fetch(`/api/ops/leads/${params.leadId}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId: params.operatorId }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else await load();
    } finally {
      setBusy("");
    }
  }

  async function audit() {
    setBusy("audit");
    try {
      const res = await fetch(`/api/ops/leads/${params.leadId}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId: params.operatorId }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setAuditId(json.audit?.id || "");
        ping("Audit ready");
      }
    } finally {
      setBusy("");
    }
  }

  if (!lead && !error) return <p className="text-muted-foreground">Loading lead…</p>;
  if (!lead) return <p className="text-danger">{error}</p>;

  return (
    <div>
      <Link href={`/operator/${params.operatorId}`} className="text-sm text-muted-foreground hover:underline">
        ← Queue
      </Link>
      {toast ? <div className="mt-3 rounded-md bg-success/15 px-3 py-2 text-sm text-success">{toast}</div> : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{lead.name}</h1>
          <p className="text-muted-foreground">
            {lead.company}
            {lead.title ? ` · ${lead.title}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(lead.statuses?.length ? lead.statuses : [lead.status]).map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </div>

      <Card className="mt-4 grid gap-2 p-5 text-sm sm:grid-cols-2">
        <div>Email: {lead.email || "—"}</div>
        <div>Phone: {lead.phone || "—"}</div>
        <div>Website: {lead.website || "—"}</div>
        <div className="flex items-center gap-2">
          <span>LinkedIn:</span> <CopyLinkedin url={lead.linkedin} />
        </div>
        <div>Location: {lead.location || "—"}</div>
      </Card>

      <Card className="mt-4 space-y-3 p-5">
        <h2 className="font-medium">Email</h2>
        <Input placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
        <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea
          className="min-h-36 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <textarea
          className="min-h-16 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Call / outcome notes (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="lg" disabled={!!busy} onClick={() => void act("email_opened", { openEmail: true })}>
          Email
        </Button>
        <Button size="lg" variant="secondary" disabled={!!busy} onClick={() => void call()}>
          Call
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Email opens Gmail. Press Sent after you actually send.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {OUTCOMES.map((o) => {
          const on = marked.has(o.status);
          return (
            <Button
              key={o.action}
              size="sm"
              variant={on ? "default" : "outline"}
              className={on ? "ring-2 ring-accent" : ""}
              disabled={!!busy}
              onClick={() => void act(o.action)}
            >
              {on ? `✓ ${o.label}` : o.label}
            </Button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Marked statuses stay highlighted. You can tick more than one.</p>

      {callOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCallOpen(false)}>
          <Card className="w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Call {lead.name}</h2>
            <p className="text-sm text-muted-foreground">{lead.phone ? `Number copied: ${lead.phone}` : "No phone number on this lead."}</p>
            <textarea
              className="min-h-28 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="What was discussed on the call?"
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
            />
            {callError ? <p className="text-sm text-danger">{callError}</p> : null}
            <p className="text-xs text-muted-foreground">Did the call happen?</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!!busy} onClick={() => void saveCall(true)}>
                Yes — save call
              </Button>
              <Button type="button" variant="outline" disabled={!!busy} onClick={() => void saveCall(false)}>
                No — not connected
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCallOpen(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        {card ? (
          <ActionCardPanel compact company={lead.company} actionCard={card} />
        ) : (
          <Card className="p-5">
            <h2 className="font-medium">No Action Card yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">Run research for this company. Nothing is invented.</p>
            <Button className="mt-3" onClick={() => void research()} disabled={!!busy}>
              {busy === "research" ? "Researching…" : "Generate Action Card"}
            </Button>
          </Card>
        )}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="font-medium">Free website review</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Client-facing review from observed website evidence. Send it yourself after download.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void audit()} disabled={!!busy}>
            {busy === "audit" ? "Building…" : "Create Free Audit"}
          </Button>
          {auditId ? (
            <>
              <a href={`/api/ops/audits/${auditId}?format=html`} target="_blank" rel="noreferrer">
                <Button variant="outline">Preview</Button>
              </a>
              <a href={`/api/ops/audits/${auditId}/pdf?operatorId=${params.operatorId}`}>
                <Button variant="outline">Download PDF</Button>
              </a>
              <a href={`/api/ops/audits/${auditId}/docx?operatorId=${params.operatorId}`}>
                <Button variant="outline">Download Word</Button>
              </a>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
