"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";
import {
  assessEmailDeliverability,
  scrubEmailSubject,
  scrubEmailText,
} from "@/lib/email-deliverability";

const SENDER_NAME_KEY = "prospect_sender_name_v1";

/** Match [Your Name], [Name], {{var}}, and bare [placeholders]. */
const PLACEHOLDER_RE = /\[([^\]]+)\]|\{\{\s*([^}]+?)\s*\}\}/g;

export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  const s = String(text || "");
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(s))) {
    const key = (m[1] || m[2] || "").trim();
    if (key) found.add(key);
  }
  return [...found];
}

export function applyPlaceholders(text: string, values: Record<string, string>): string {
  return String(text || "").replace(PLACEHOLDER_RE, (_full, bracket, mustache) => {
    const key = String(bracket || mustache || "").trim();
    const v = values[key];
    return v != null && v !== "" ? v : _full;
  });
}

export function buildGmailComposeUrl(opts: { to: string; subject: string; body: string }): string {
  const params = new URLSearchParams();
  params.set("view", "cm");
  params.set("fs", "1");
  if (opts.to) params.set("to", opts.to);
  if (opts.subject) params.set("su", opts.subject);
  if (opts.body) params.set("body", opts.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function getSavedSenderName(): string {
  try {
    return localStorage.getItem(SENDER_NAME_KEY) || "";
  } catch {
    return "";
  }
}

export function saveSenderName(name: string) {
  try {
    localStorage.setItem(SENDER_NAME_KEY, name.trim());
  } catch {
    /* ignore */
  }
}

/** Build scrubbed Gmail compose fields using saved sender name for [Your Name]. */
export function buildReadyCompose(opts: {
  to: string;
  subject: string;
  body: string;
  company?: string;
  senderName?: string;
}): {
  to: string;
  subject: string;
  body: string;
  url: string;
  missing: string[];
  ready: boolean;
} {
  const senderName = opts.senderName ?? (typeof window !== "undefined" ? getSavedSenderName() : "");
  const safeSubject = scrubEmailSubject(opts.subject, opts.company);
  const safeBody = scrubEmailText(opts.body);
  const placeholders = new Set([...extractPlaceholders(safeSubject), ...extractPlaceholders(safeBody)]);
  if (![...placeholders].some((k) => /your\s*name|sender|signature/i.test(k))) {
    placeholders.add("Your Name");
  }
  const vars: Record<string, string> = {};
  for (const key of placeholders) {
    if (/your\s*name|sender|signature/i.test(key) && senderName) vars[key] = senderName;
    else vars[key] = "";
  }
  const subject = scrubEmailSubject(applyPlaceholders(safeSubject, vars), opts.company);
  const body = scrubEmailText(applyPlaceholders(safeBody, vars));
  const missing = [...placeholders].filter((k) => !String(vars[k] || "").trim());
  const to = opts.to.trim();
  const url = buildGmailComposeUrl({ to, subject, body });
  return { to, subject, body, url, missing, ready: !!to && missing.length === 0 };
}

/** Open Gmail compose; returns null window if blocked (caller should show fallback link). */
export function openGmailComposeWindow(url: string): Window | null {
  const win = window.open(url, "_blank");
  if (win) {
    try {
      win.opener = null;
    } catch {
      /* ignore */
    }
  }
  return win;
}

type Props = {
  open: boolean;
  onClose: () => void;
  to: string;
  subject: string;
  body: string;
  company?: string;
  onOpenedInGmail?: () => void;
  /** Pace label e.g. "2 of 5" */
  paceLabel?: string;
};

export function SendEmailDialog({ open, onClose, to, subject, body, company, onOpenedInGmail, paceLabel }: Props) {
  const safeSubject = useMemo(() => scrubEmailSubject(subject, company), [subject, company]);
  const safeBody = useMemo(() => scrubEmailText(body), [body]);

  const placeholders = useMemo(() => {
    const keys = new Set([...extractPlaceholders(safeSubject), ...extractPlaceholders(safeBody)]);
    if (![...keys].some((k) => /your\s*name|sender|signature/i.test(k))) {
      keys.add("Your Name");
    }
    return [...keys];
  }, [safeSubject, safeBody]);

  const [toEdit, setToEdit] = useState(to);
  const [subjectEdit, setSubjectEdit] = useState(safeSubject);
  const [bodyEdit, setBodyEdit] = useState(safeBody);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setToEdit(to);
    setSubjectEdit(safeSubject);
    setBodyEdit(safeBody);
    setError("");
    setFallbackUrl("");
    const savedName = getSavedSenderName();
    const next: Record<string, string> = {};
    for (const key of placeholders) {
      if (/your\s*name|sender|signature/i.test(key) && savedName) next[key] = savedName;
      else next[key] = "";
    }
    setVars(next);
  }, [open, to, safeSubject, safeBody, placeholders]);

  if (!open) return null;

  const previewSubject = scrubEmailSubject(applyPlaceholders(subjectEdit, vars), company);
  const previewBody = scrubEmailText(applyPlaceholders(bodyEdit, vars));
  const missing = placeholders.filter((k) => !String(vars[k] || "").trim());
  const deliverability = assessEmailDeliverability(previewSubject, previewBody);

  function openGmail() {
    setError("");
    setFallbackUrl("");
    if (!toEdit.trim()) {
      setError("Add a recipient email before opening Gmail.");
      return;
    }
    if (missing.length) {
      setError(`Fill remaining variables: ${missing.join(", ")}`);
      return;
    }

    const nameKey = placeholders.find((k) => /your\s*name|sender|signature/i.test(k));
    if (nameKey && vars[nameKey]) {
      saveSenderName(vars[nameKey]);
    }

    const url = buildGmailComposeUrl({
      to: toEdit.trim(),
      subject: previewSubject,
      body: previewBody,
    });

    if (url.length > 7500) {
      setError("Email is long — Gmail may truncate the body. Shorten if the draft looks cut off.");
    }

    const win = openGmailComposeWindow(url);
    if (!win) {
      setFallbackUrl(url);
      setError("Pop-up blocked. Click the Gmail link below (or allow pop-ups for this site).");
      return;
    }
    onOpenedInGmail?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Send email via Gmail{paceLabel ? ` · ${paceLabel}` : ""}
            </h2>
            <p className="text-sm text-muted-foreground">
              Inbox-safer copy applied automatically. Fill variables, edit if needed, then open Gmail.
              {company ? ` · ${company}` : ""}
            </p>
          </div>
          <button type="button" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              deliverability.ok
                ? "border-success/30 bg-success/10 text-success"
                : "border-warning/40 bg-warning/10 text-warning"
            }`}
          >
            {deliverability.ok ? (
              <p>
                Copy looks filter-safe (plain, short, no links/hype). Still: no wording can guarantee 100%
                inbox — your mailbox reputation matters too.
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                {deliverability.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs opacity-80">{deliverability.tip}</p>
          </div>

          {placeholders.length ? (
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Variables</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {placeholders.map((key) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`var-${key}`}>{key}</Label>
                    <Input
                      id={`var-${key}`}
                      value={vars[key] || ""}
                      onChange={(e) => setVars((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={`Enter ${key}`}
                      autoComplete={/name/i.test(key) ? "name" : "off"}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="send-to">To</Label>
            <Input id="send-to" type="email" value={toEdit} onChange={(e) => setToEdit(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="send-subject">Subject</Label>
            <Input id="send-subject" value={subjectEdit} onChange={(e) => setSubjectEdit(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="send-body">Body</Label>
            <textarea
              id="send-body"
              value={bodyEdit}
              onChange={(e) => setBodyEdit(e.target.value)}
              rows={12}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Keep it personal and short. Avoid links, ALL CAPS, and sales hype in the first email.
            </p>
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview (what Gmail will get)
            </div>
            <div className="mt-2 text-sm font-medium">{previewSubject || "(no subject)"}</div>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-sm text-muted-foreground">
              {previewBody || "(empty body)"}
            </pre>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {fallbackUrl ? (
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm font-medium text-accent hover:underline"
              onClick={() => onOpenedInGmail?.()}
            >
              Open Gmail compose in a new tab →
            </a>
          ) : null}
        </div>

        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={openGmail}>
            <Mail className="h-4 w-4" />
            Open in Gmail
          </Button>
        </div>
      </div>
    </div>
  );
}
