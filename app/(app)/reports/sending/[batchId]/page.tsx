"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Download, Mail, SkipForward, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, Checkbox } from "@/components/ui/primitives";
import { SendEmailDialog, buildReadyCompose, getSavedSenderName, openGmailComposeWindow } from "@/components/send-email-dialog";
import {
  assessEmailDeliverability,
  scrubEmailSubject,
  scrubEmailText,
} from "@/lib/email-deliverability";
import { GTM } from "@/lib/gtm-defaults";
import { CopyLinkedin } from "@/components/copy-linkedin";

type QueueStatus = "pending" | "opened_gmail" | "sent" | "skipped" | "failed";

type QueueItem = {
  id: string;
  company: string;
  fullName: string;
  linkedin?: string;
  email: string;
  firstOffer?: string;
  emailSubject?: string;
  decision?: string;
  sendQueueStatus: QueueStatus;
  sentAt?: string;
  lastSendError?: string;
  compose?: { to: string; subject: string; body: string; firstName?: string };
};

type Filter = "pending" | "sent" | "skipped" | "all" | "opened_gmail";

function unlockLabel(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function countdown(toIso: string, nowMs: number) {
  const ms = Math.max(0, new Date(toIso).getTime() - nowMs);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function SendQueuePage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params.batchId;
  const isSelection = batchId === "selection";

  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState({
    pending: 0,
    opened_gmail: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    total: 0,
  });
  const [filter, setFilter] = useState<Filter>("pending");
  const [includeNurture, setIncludeNurture] = useState(false);
  const [sendsToday, setSendsToday] = useState(0);
  const [dailyCap, setDailyCap] = useState(GTM.dailySendCap);
  const [sendLocked, setSendLocked] = useState(false);
  const [hardLocked, setHardLocked] = useState(false);
  const [nextUnlockAt, setNextUnlockAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogItem, setDialogItem] = useState<QueueItem | null>(null);
  const [confirmItem, setConfirmItem] = useState<QueueItem | null>(null);
  /** Paced batch: total goal + how many confirmed in this run */
  const [paceTotal, setPaceTotal] = useState(0);
  const [paceDone, setPaceDone] = useState(0);
  /** Next pending item waiting for a user click to open Gmail (preserves gesture / avoids popup block) */
  const [paceAwaitingOpen, setPaceAwaitingOpen] = useState<QueueItem | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [now, setNow] = useState(Date.now());
  const [alreadySentExcluded, setAlreadySentExcluded] = useState<
    Array<{ id: string; company: string; email: string; fullName: string; priorSentAt?: string }>
  >([]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setError("");
    const qs = new URLSearchParams();
    if (isSelection) {
      let ids: string[] = [];
      try {
        ids = JSON.parse(sessionStorage.getItem("send_queue_ids") || "[]");
      } catch {
        ids = [];
      }
      if (!ids.length) {
        setError("No selected leads in queue. Pick CONTACTs on Lists, then Open Send Queue.");
        setLoading(false);
        return;
      }
      qs.set("ids", ids.join(","));
    } else {
      qs.set("batchId", batchId);
    }
    if (includeNurture) qs.set("includeNurture", "1");
    const res = await fetch(`/api/send-queue?${qs}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed to load queue");
      setLoading(false);
      return;
    }
    setItems(json.items || []);
    setCounts(json.counts || { pending: 0, opened_gmail: 0, sent: 0, skipped: 0, failed: 0, total: 0 });
    setSendsToday(json.sendsToday ?? 0);
    setDailyCap(json.dailyCap ?? GTM.dailySendCap);
    setSendLocked(!!json.sendLocked);
    setHardLocked(!!json.hardLocked);
    setNextUnlockAt(json.nextUnlockAt || "");
    setAlreadySentExcluded(json.alreadySentExcluded || []);
    setLoading(false);
  }, [batchId, includeNurture, isSelection]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.sendQueueStatus === filter);
  }, [items, filter]);

  const pendingItems = useMemo(
    () => items.filter((i) => i.sendQueueStatus === "pending"),
    [items]
  );

  async function patchStatus(
    id: string,
    status: QueueStatus,
    opts?: { allowSoftOvershoot?: boolean; lastSendError?: string }
  ) {
    const res = await fetch(`/api/reports/${id}/send-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        allowSoftOvershoot: opts?.allowSoftOvershoot,
        lastSendError: opts?.lastSendError,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || "Update failed");
    }
    const report = json.report as QueueItem;
    setItems((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              sendQueueStatus: (report.sendQueueStatus || status) as QueueStatus,
              sentAt: report.sentAt,
              lastSendError: report.lastSendError,
            }
          : row
      )
    );
    if (typeof json.sendsToday === "number") {
      setSendsToday(json.sendsToday);
      setSendLocked(json.sendsToday >= dailyCap);
      setHardLocked(json.sendsToday >= dailyCap + GTM.dailySendCapSoftExtra);
    }
    // Refresh counts lightly
    setCounts((c) => {
      const next = { ...c };
      const prev = items.find((x) => x.id === id);
      if (prev) {
        const key = prev.sendQueueStatus as keyof typeof next;
        if (typeof next[key] === "number") next[key] = Math.max(0, (next[key] as number) - 1);
      }
      const nk = status as keyof typeof next;
      if (typeof next[nk] === "number") next[nk] = (next[nk] as number) + 1;
      return next;
    });
    return report;
  }

  function openComposeFor(item: QueueItem) {
    setFallbackUrl("");
    setDialogItem(item);
  }

  function composeFromItem(item: QueueItem) {
    return buildReadyCompose({
      to: item.compose?.to || item.email || "",
      subject: item.compose?.subject || item.emailSubject || "",
      body: item.compose?.body || "",
      company: item.company,
    });
  }

  /** Open Gmail from a real click. Skips edit modal when sender name is saved. */
  function openGmailNow(item: QueueItem): boolean {
    setError("");
    setFallbackUrl("");
    const ready = composeFromItem(item);
    if (!ready.ready) {
      openComposeFor(item);
      return false;
    }
    const win = openGmailComposeWindow(ready.url);
    if (!win) {
      setFallbackUrl(ready.url);
      setPaceAwaitingOpen(item);
      setError("Pop-up blocked. Click “Open Gmail link” below (or allow pop-ups), then confirm after you send.");
      return false;
    }
    void onOpenedInGmail(item);
    return true;
  }

  async function onOpenedInGmail(item: QueueItem) {
    setBusyId(item.id);
    setDialogItem(null);
    setPaceAwaitingOpen(null);
    setFallbackUrl("");
    try {
      await patchStatus(item.id, "opened_gmail");
      setConfirmItem(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmSent(item: QueueItem) {
    setBusyId(item.id);
    try {
      await patchStatus(item.id, "sent", { allowSoftOvershoot: true });
      setConfirmItem(null);
      const nextDone = paceDone + 1;
      if (paceTotal > 0 && nextDone < paceTotal) {
        setPaceDone(nextDone);
        // Wait for a real click on “Open Gmail” — auto-open is blocked by browsers.
        setItems((curr) => {
          const next = curr.find((p) => p.id !== item.id && p.sendQueueStatus === "pending");
          setPaceAwaitingOpen(next || null);
          if (!next) {
            setPaceTotal(0);
            setPaceDone(0);
          }
          return curr;
        });
      } else {
        setPaceTotal(0);
        setPaceDone(0);
        setPaceAwaitingOpen(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function skipItem(item: QueueItem) {
    setBusyId(item.id);
    try {
      await patchStatus(item.id, "skipped");
      if (paceAwaitingOpen?.id === item.id) setPaceAwaitingOpen(null);
      if (confirmItem?.id === item.id) setConfirmItem(null);
      if (paceTotal > 0) {
        setItems((curr) => {
          const next = curr.find((p) => p.id !== item.id && p.sendQueueStatus === "pending");
          setPaceAwaitingOpen(next || null);
          if (!next) {
            setPaceTotal(0);
            setPaceDone(0);
          }
          return curr;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function startPace(n: number) {
    if (sendLocked) {
      setError(`Daily send goal reached (${dailyCap}). Unlocks ${unlockLabel(nextUnlockAt)}.`);
      return;
    }
    const queue = pendingItems.slice(0, n);
    if (!queue.length) {
      setError("No pending CONTACT emails in this queue.");
      return;
    }
    setPaceTotal(queue.length);
    setPaceDone(0);
    setError("");
    const first = queue[0];
    // Same click that started the pace can open Gmail if name is saved
    if (getSavedSenderName() && composeFromItem(first).ready) {
      openGmailNow(first);
    } else {
      openComposeFor(first);
    }
  }

  function sendNext() {
    if (sendLocked && !items.some((i) => i.sendQueueStatus === "opened_gmail")) {
      setError(`Daily send goal reached (${dailyCap}). Unlocks ${unlockLabel(nextUnlockAt)}.`);
      return;
    }
    const next =
      items.find((i) => i.sendQueueStatus === "opened_gmail") ||
      pendingItems[0];
    if (!next) {
      setError("No pending CONTACT emails in this queue.");
      return;
    }
    if (next.sendQueueStatus === "opened_gmail") {
      setConfirmItem(next);
      return;
    }
    startPace(1);
  }

  function sendNextN(n: number) {
    startPace(n);
  }

  function stopPace() {
    setPaceTotal(0);
    setPaceDone(0);
    setPaceAwaitingOpen(null);
    setConfirmItem(null);
    setDialogItem(null);
    setFallbackUrl("");
  }

  const paceLabel =
    paceTotal > 0 ? `${Math.min(paceDone + 1, paceTotal)} of ${paceTotal}` : undefined;

  const deliverabilityFor = (item: QueueItem) => {
    const subject = scrubEmailSubject(item.compose?.subject || item.emailSubject || "", item.company);
    const body = scrubEmailText(item.compose?.body || "");
    return assessEmailDeliverability(subject, body);
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading send queue…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Browser Send Queue</p>
          <h1 className="text-2xl font-semibold tracking-tight">Gmail compose (paced)</h1>
          <p className="text-sm text-muted-foreground">
            Best: one Gmail tab at a time (confirm each send). Browsers block opening 5 tabs at once.
            {isSelection ? " · Selection" : ` · Batch ${batchId.slice(0, 8)}…`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isSelection ? (
            <a href={`/api/reports/export/sequencer?batchId=${batchId}&decision=CONTACT`}>
              <Button variant="outline">
                <Download className="h-4 w-4" />
                Instantly CSV
              </Button>
            </a>
          ) : null}
          <Link href="/reports">
            <Button variant="outline">Lists</Button>
          </Link>
        </div>
      </div>

      {sendLocked ? (
        <Card className="border-warning/40 bg-warning/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
            <div>
              <p className="font-medium">
                Daily send goal reached ({sendsToday}/{dailyCap})
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Next send window unlocks: <span className="text-foreground">{unlockLabel(nextUnlockAt)}</span>
                {nextUnlockAt ? ` · in ${countdown(nextUnlockAt, now)}` : ""}. You can still analyze leads,
                export Instantly CSV, and mark replies/meetings.
              </p>
              {hardLocked ? (
                <p className="mt-1 text-sm text-danger">Hard cap hit — confirm-sent also locked until unlock.</p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Already-opened Gmail drafts can still be confirmed (soft +{GTM.dailySendCapSoftExtra}).
                </p>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {alreadySentExcluded.length > 0 ? (
        <Card className="border-accent/30 bg-accent/5 p-4">
          <p className="font-medium">
            {alreadySentExcluded.length} contact{alreadySentExcluded.length === 1 ? "" : "s"} left out — already
            sent
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            These emails were confirmed sent on an earlier run, so they were skipped in this queue (won&apos;t open
            Gmail again).
          </p>
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm">
            {alreadySentExcluded.slice(0, 30).map((row) => (
              <li key={row.id}>
                <span className="font-medium">{row.company || "—"}</span>
                {row.email ? <span className="text-muted-foreground"> · {row.email}</span> : null}
                {row.fullName ? <span className="text-muted-foreground"> · {row.fullName}</span> : null}
              </li>
            ))}
            {alreadySentExcluded.length > 30 ? (
              <li className="text-muted-foreground">…and {alreadySentExcluded.length - 30} more</li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Queue progress</div>
          <div className="mt-1 text-2xl font-semibold">
            {counts.sent}
            <span className="text-base font-normal text-muted-foreground"> / {counts.total}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Pending</div>
          <div className="mt-1 text-2xl font-semibold text-warning">{counts.pending}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Sent today</div>
          <div className="mt-1 text-2xl font-semibold">
            {sendsToday}
            <span className="text-base font-normal text-muted-foreground"> / {dailyCap}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Rule of {GTM.ruleOf100Target}</div>
          <div className="mt-1 text-sm text-muted-foreground">Track on Dashboard · confirm marks Done</div>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Button disabled={!!busyId || (sendLocked && counts.opened_gmail === 0)} onClick={sendNext}>
          <Mail className="h-4 w-4" />
          Send next
        </Button>
        <Button
          variant="outline"
          disabled={!!busyId || sendLocked || pendingItems.length === 0}
          onClick={() => sendNextN(5)}
        >
          Send next 5 (paced)
        </Button>
        <Button
          variant="outline"
          disabled={!!busyId || sendLocked || pendingItems.length === 0}
          onClick={() => sendNextN(10)}
        >
          Send next 10 (paced)
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={includeNurture} onChange={(e) => setIncludeNurture(e.target.checked)} />
          Include NURTURE
        </label>
      </Card>

      {paceTotal > 0 ? (
        <Card className="border-accent/40 bg-accent/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">
                Paced send · {paceDone} confirmed · next is {paceLabel}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Each email needs your click (browser security). After Send in Gmail, confirm here, then tap Open
                next — we never open 5 tabs at once.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={stopPace}>
              Stop pacing
            </Button>
          </div>

          {confirmItem ? (
            <div className="mt-4 rounded-lg border border-border bg-card p-4">
              <p className="font-medium">Did you hit Send in Gmail?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {confirmItem.company} · {confirmItem.compose?.to || confirmItem.email}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={!!busyId} onClick={() => void confirmSent(confirmItem)}>
                  Yes — mark Done
                </Button>
                <Button variant="outline" onClick={() => setConfirmItem(null)}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : paceAwaitingOpen ? (
            <div className="mt-4 rounded-lg border border-border bg-card p-4">
              <p className="font-medium">
                Next: {paceAwaitingOpen.company}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {paceAwaitingOpen.compose?.to || paceAwaitingOpen.email}
                </span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={!!busyId} onClick={() => openGmailNow(paceAwaitingOpen)}>
                  <Mail className="h-4 w-4" />
                  Open Gmail ({paceLabel})
                </Button>
                <Button variant="outline" disabled={!!busyId} onClick={() => void skipItem(paceAwaitingOpen)}>
                  Skip
                </Button>
                <Button variant="ghost" onClick={() => openComposeFor(paceAwaitingOpen)}>
                  Edit first
                </Button>
              </div>
              {fallbackUrl ? (
                <a
                  href={fallbackUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-sm font-medium text-accent hover:underline"
                  onClick={() => void onOpenedInGmail(paceAwaitingOpen)}
                >
                  Pop-up blocked — open Gmail link here →
                </a>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {fallbackUrl && !paceTotal ? (
        <a href={fallbackUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
          Open blocked Gmail compose →
        </a>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(["pending", "opened_gmail", "sent", "skipped", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              filter === f ? "border-accent bg-accent/10 text-accent" : "border-border hover:bg-muted"
            }`}
          >
            {f === "opened_gmail" ? "Opened" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">LinkedIn</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Offer</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    No rows in this filter.{" "}
                    <Link href="/reports/new" className="text-accent hover:underline">
                      New run
                    </Link>
                  </td>
                </tr>
              ) : (
                visible.map((item) => {
                  const deliv = deliverabilityFor(item);
                  const done = item.sendQueueStatus === "sent";
                  return (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/reports/${item.id}`} className="hover:text-accent">
                          {item.company}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.fullName || "—"}</td>
                      <td className="px-4 py-3">
                        <CopyLinkedin url={item.linkedin} compact />
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">
                        {item.compose?.to || item.email || "—"}
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-3 text-muted-foreground">
                        {item.firstOffer || "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">
                        {item.compose?.subject || item.emailSubject || "—"}
                        {!deliv.ok ? (
                          <Badge tone="warning" className="ml-1">
                            weak copy
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {done ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-4 w-4" />
                            Done
                          </span>
                        ) : (
                          <Badge
                            tone={
                              item.sendQueueStatus === "pending"
                                ? "warning"
                                : item.sendQueueStatus === "failed"
                                  ? "danger"
                                  : "default"
                            }
                          >
                            {item.sendQueueStatus}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {item.sendQueueStatus === "pending" || item.sendQueueStatus === "failed" ? (
                            <button
                              type="button"
                              disabled={!!busyId || sendLocked}
                              className="text-accent hover:underline disabled:opacity-40"
                              onClick={() => openComposeFor(item)}
                            >
                              Open Gmail
                            </button>
                          ) : null}
                          {item.sendQueueStatus === "opened_gmail" ? (
                            <button
                              type="button"
                              disabled={!!busyId || hardLocked}
                              className="text-success hover:underline disabled:opacity-40"
                              onClick={() => void confirmSent(item)}
                            >
                              Confirm sent
                            </button>
                          ) : null}
                          {item.sendQueueStatus === "pending" || item.sendQueueStatus === "opened_gmail" ? (
                            <button
                              type="button"
                              disabled={!!busyId}
                              className="inline-flex items-center gap-1 text-muted-foreground hover:underline disabled:opacity-40"
                              onClick={() => void skipItem(item)}
                            >
                              <SkipForward className="h-3.5 w-3.5" />
                              Skip
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {dialogItem ? (
        <SendEmailDialog
          open={!!dialogItem}
          onClose={() => setDialogItem(null)}
          to={dialogItem.compose?.to || dialogItem.email || ""}
          subject={dialogItem.compose?.subject || dialogItem.emailSubject || ""}
          body={dialogItem.compose?.body || ""}
          company={dialogItem.company}
          paceLabel={paceLabel}
          onOpenedInGmail={() => void onOpenedInGmail(dialogItem)}
        />
      ) : null}

      {confirmItem && paceTotal === 0 ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg">
            <h2 className="text-lg font-semibold">Did you hit Send in Gmail?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {confirmItem.company} · {confirmItem.compose?.to || confirmItem.email}
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmItem(null)}>
                Not yet
              </Button>
              <Button disabled={!!busyId} onClick={() => void confirmSent(confirmItem)}>
                Yes — mark Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
