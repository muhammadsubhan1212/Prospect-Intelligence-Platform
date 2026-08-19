"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, FileText, Mail, Maximize2 } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { SendEmailDialog } from "@/components/send-email-dialog";

export type ActionCardData = {
  decision: "CONTACT" | "NURTURE" | "SKIP";
  priority: "High" | "Medium" | "Low";
  confidence: number;
  whyNow: string;
  firstOffer: string;
  offerWhy: string;
  channel?: string;
  email?: {
    to?: string;
    firstName?: string;
    company?: string;
    subject?: string;
    body?: string;
  };
  skipReason?: string;
  reviewFlag?: boolean;
  reviewNote?: string;
};

type OutcomeStatus = "not_sent" | "sent" | "replied" | "meeting" | "not_interested" | "bounced";

type Props = {
  reportId?: string;
  company?: string;
  actionCard?: ActionCardData | null;
  outcomeStatus?: OutcomeStatus;
  onOutcomeChange?: (status: OutcomeStatus) => void;
  /** Hide Instantly/report chrome — used on the operator desk. */
  compact?: boolean;
};

function decisionTone(d: string): "success" | "warning" | "danger" | "muted" {
  if (d === "CONTACT") return "success";
  if (d === "NURTURE") return "warning";
  if (d === "SKIP") return "danger";
  return "muted";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export function ActionCardPanel({
  reportId,
  company,
  actionCard,
  outcomeStatus,
  onOutcomeChange,
  compact = false,
}: Props) {
  const [copied, setCopied] = useState<"subject" | "body" | "email" | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  if (!actionCard) {
    return (
      <Card className="space-y-3 border-warning/40 bg-warning/5 p-5">
        <h2 className="font-medium">Action Card unavailable</h2>
        <p className="text-sm text-muted-foreground">
          This report was generated before Action Cards. Regenerate to get CONTACT / SKIP decisions and
          Instantly-ready email fields.
        </p>
        <Link href="/reports/new">
          <Button size="sm">Regenerate</Button>
        </Link>
      </Card>
    );
  }

  const email = actionCard.email || { subject: "", body: "" };
  const canSend = actionCard.decision !== "SKIP" && !!(email.subject || email.body);

  async function onCopy(kind: "subject" | "body" | "email") {
    const text =
      kind === "subject"
        ? email.subject || ""
        : kind === "body"
          ? email.body || ""
          : `Subject: ${email.subject || ""}\n\n${email.body || ""}`;
    await copyText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <>
      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={decisionTone(actionCard.decision)}>{actionCard.decision}</Badge>
              <Badge tone="muted">
                {actionCard.priority} · {actionCard.confidence}%
              </Badge>
              {actionCard.channel ? <Badge tone="muted">{actionCard.channel}</Badge> : null}
            </div>
            <h2 className="text-lg font-semibold tracking-tight">{company || "Action"}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSend && !compact ? (
              <Button size="sm" onClick={() => setSendOpen(true)}>
                <Mail className="h-3.5 w-3.5" />
                Send email
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void onCopy("email")}>
              {copied === "email" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "email" ? "Copied" : "Copy email"}
            </Button>
            {!compact ? (
              <a href={`/api/reports/export/sequencer?decision=CONTACT`}>
                <Button size="sm" variant="outline">
                  <Download className="h-3.5 w-3.5" />
                  Instantly CSV
                </Button>
              </a>
            ) : null}
          </div>
        </div>

        {actionCard.reviewFlag ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {actionCard.reviewNote || "Signal conflict — manual review before treating as High"}
          </div>
        ) : null}

        {actionCard.decision === "SKIP" ? (
          <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            Skip reason: {actionCard.skipReason || "Disqualified"}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Why now</div>
            <p className="mt-1 text-sm">{actionCard.whyNow}</p>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">First offer</div>
            <p className="mt-1 text-sm font-medium text-accent">{actionCard.firstOffer}</p>
            <p className="mt-1 text-sm text-muted-foreground">{actionCard.offerWhy}</p>
          </div>
        </div>

        {actionCard.decision !== "SKIP" ? (
          <div className="space-y-3 rounded-lg bg-muted/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</div>
              <div className="flex flex-wrap gap-2">
                {canSend ? (
                  <Button size="sm" variant="ghost" onClick={() => setSendOpen(true)}>
                    <Mail className="h-3.5 w-3.5" />
                    Send email
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => void onCopy("subject")}>
                  {copied === "subject" ? "Copied subject" : "Copy subject"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void onCopy("body")}>
                  {copied === "body" ? "Copied body" : "Copy body"}
                </Button>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Subject</div>
              <p className="mt-0.5 text-sm font-medium">{email.subject || "—"}</p>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Body</div>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
                {email.body || "—"}
              </pre>
            </div>
          </div>
        ) : null}

        {!compact && onOutcomeChange ? (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-accent">Outreach outcome</div>
            <p className="mt-1 text-xs text-muted-foreground">
              After Instantly/Gmail send — mark status so the dashboard can prove reply & meeting rates.
            </p>
            <select
              className="mt-3 h-10 w-full max-w-xs rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground"
              value={outcomeStatus || "not_sent"}
              onChange={(e) => onOutcomeChange(e.target.value as OutcomeStatus)}
            >
              <option value="not_sent">Not sent</option>
              <option value="sent">Sent</option>
              <option value="replied">Replied</option>
              <option value="meeting">Meeting booked</option>
              <option value="not_interested">Not interested</option>
              <option value="bounced">Bounced</option>
            </select>
          </div>
        ) : null}

        {!compact && reportId ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
          <Link href={`/reports/${reportId}/view`} className="inline-flex items-center gap-1 text-accent hover:underline">
            <Maximize2 className="h-3.5 w-3.5" />
            Full research
          </Link>
          <Link
            href={`/reports/${reportId}/document`}
            className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            Full dossier (optional archive)
          </Link>
          <a
            href={`/api/reports/${reportId}/download`}
            className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
          >
            <Download className="h-3.5 w-3.5" />
            DOCX (optional)
          </a>
        </div>
        ) : null}
      </Card>

      <SendEmailDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        to={email.to || ""}
        subject={email.subject || ""}
        body={email.body || ""}
        company={company || email.company}
        onOpenedInGmail={() => {
          if (onOutcomeChange && (outcomeStatus === "not_sent" || !outcomeStatus)) {
            onOutcomeChange("sent");
          }
        }}
      />
    </>
  );
}
