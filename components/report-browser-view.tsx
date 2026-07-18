"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, X, Download, Printer, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { Lead, ProspectData } from "@/server/services/engine";

type Props = {
  reportId: string;
  company: string;
  data: ProspectData;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="scroll-mt-20 border-b border-border py-8 last:border-0">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function Kv({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr]">
      <dt className="font-medium text-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

export function ReportBrowserView({ reportId, company, data }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setFullscreen(true);
      } else {
        await document.exitFullscreen();
        setFullscreen(false);
      }
    } catch {
      // Fallback: CSS immersive mode if Fullscreen API blocked
      setFullscreen((v) => !v);
    }
  }, []);

  const copyJson = useCallback(async () => {
    const text = JSON.stringify(data, null, 2);
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
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [data]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const lead: Partial<Lead> = data.lead || {};
  const exec = data.executiveSummary || {};
  const overview = (data.companyOverview || {}) as Record<string, unknown>;
  const offer = data.bestFirstOffer || {};
  const finalRec = data.finalRecommendation || {};
  const audit = data.websiteAudit || {};
  const strategy = (data.salesStrategy || {}) as Record<string, string>;
  const messages = (data.messages || {}) as Record<string, unknown>;
  const coldEmail = (messages.coldEmail || {}) as { subjectLines?: string[]; body?: string };
  const pains = data.painPoints || [];
  const aiOps = (data.aiOpportunities || []) as {
    name?: string;
    description?: string;
    priority?: string;
  }[];
  const ice = (data.icebreakers || []) as string[];
  const nextSteps = (data.nextSteps || []) as string[];
  const dm = (data.decisionMaker || {}) as Record<string, unknown>;
  const psych = (data.salesPsychology || {}) as Record<string, unknown>;
  const channels = (data.channels || []) as [string, number, string][];
  const buying = (data.buyingIntent || []) as [string, number][];
  const objections = (messages.objectionHandling || []) as [string, string][];

  return (
    <div
      ref={rootRef}
      className={
        fullscreen
          ? "fixed inset-0 z-50 overflow-y-auto bg-background"
          : "rounded-xl border border-border bg-card"
      }
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur md:px-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Prospect Intelligence Report</div>
          <div className="font-semibold">{company}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void copyJson()}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied!" : "Copy JSON"}
          </Button>
          <a href={`/api/reports/${reportId}/download`}>
            <Button size="sm" variant="outline">
              <Download className="h-3.5 w-3.5" />
              DOCX
            </Button>
          </a>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
          <Button size="sm" onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {fullscreen ? "Exit full screen" : "Full screen"}
          </Button>
          {fullscreen ? (
            <Button size="sm" variant="ghost" onClick={() => void toggleFullscreen()}>
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      <article className="mx-auto max-w-3xl px-4 py-8 md:px-8 print:max-w-none">
        <header className="mb-8 border-b border-border pb-6">
          <p className="text-sm text-accent">Prospect Intelligence Dossier</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{company}</h1>
          <p className="mt-2 text-muted-foreground">
            {[lead.fullName, lead.title, lead.industry].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-muted px-2 py-1">Verdict: {finalRec.verdict || exec.verdict || "—"}</span>
            <span className="rounded-md bg-muted px-2 py-1">Priority: {finalRec.priority || exec.priority || "—"}</span>
            <span className="rounded-md bg-muted px-2 py-1">
              Score: {audit.overallScore != null ? `${audit.overallScore}/100` : "—"}
            </span>
            <span className="rounded-md bg-muted px-2 py-1">
              Confidence: {finalRec.confidence != null ? `${finalRec.confidence}%` : "—"}
            </span>
          </div>
        </header>

        <Section title="1. Executive Summary">
          {(exec.paragraphs || []).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {Array.isArray(exec.keyFacts) && exec.keyFacts.length ? (
            <dl className="mt-4 space-y-2 rounded-lg bg-muted/40 p-4">
              {exec.keyFacts.map(([k, v], i) => (
                <Kv key={i} label={k} value={v} />
              ))}
            </dl>
          ) : null}
        </Section>

        <Section title="2. Company Overview">
          <dl className="space-y-2">
            <Kv label="Who they are" value={String(overview.whoTheyAre || "—")} />
            <Kv label="What they sell" value={String(overview.whatTheySell || "—")} />
            <Kv label="Who they serve" value={String(overview.whoTheyServe || "—")} />
            <Kv label="How they make money" value={String(overview.howTheyMakeMoney || "—")} />
            <Kv label="Ideal customers" value={String(overview.idealCustomers || "—")} />
            <Kv label="Digital maturity" value={String(overview.digitalMaturity || "—")} />
          </dl>
        </Section>

        <Section title="3. Decision Maker">
          <dl className="space-y-2">
            <Kv label="Name" value={lead.fullName} />
            <Kv label="Role" value={lead.title} />
            <Kv label="Email" value={lead.email} />
            <Kv label="Phone" value={lead.phone} />
            <Kv label="LinkedIn" value={lead.linkedin} />
            <Kv label="Buying style" value={String(dm.buyingStyle || "")} />
          </dl>
          {Array.isArray(dm.caresAbout) ? (
            <ul className="mt-3 list-disc pl-5">
              {(dm.caresAbout as string[]).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="4. Website Audit">
          <p>{audit.summary || "—"}</p>
          {audit.analyzedUrl ? <p className="font-mono text-xs text-accent">{audit.analyzedUrl}</p> : null}
          {Array.isArray(audit.sections) ? (
            <ul className="mt-3 space-y-1">
              {(audit.sections as [string, number, string][]).map(([name, score, note], i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{name}</span>: {score}/10 — {note}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="5. Best First Offer">
          <p className="text-base font-medium text-accent">{offer.offer || "—"}</p>
          <p>{offer.why}</p>
        </Section>

        <Section title="6. Sales Strategy">
          <dl className="space-y-2">
            <Kv label="Primary angle" value={strategy.primaryAngle} />
            <Kv label="Secondary angle" value={strategy.secondaryAngle} />
            <Kv label="Business outcome" value={strategy.businessOutcome} />
            <Kv label="Value proposition" value={strategy.valueProp} />
            <Kv label="Why it matters" value={strategy.whyMatters} />
          </dl>
        </Section>

        <Section title="7. Pain Points">
          {pains.length ? (
            <ul className="space-y-3">
              {pains.map((p, i) => (
                <li key={i} className="rounded-lg bg-muted/40 p-3">
                  <div className="font-medium text-foreground">{p.pain}</div>
                  <div className="text-xs">Evidence: {p.evidence}</div>
                  <div className="text-xs">Impact: {p.impact}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p>Not enough public information.</p>
          )}
        </Section>

        <Section title="8. AI Opportunities">
          {aiOps.length ? (
            <ul className="space-y-3">
              {aiOps.map((o, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{o.name}</span>
                  {o.priority ? ` (${o.priority})` : ""} — {o.description}
                </li>
              ))}
            </ul>
          ) : (
            <p>—</p>
          )}
        </Section>

        <Section title="9. Channels">
          <ol className="list-decimal space-y-1 pl-5">
            {channels
              .slice()
              .sort((a, b) => (a[1] || 99) - (b[1] || 99))
              .map(([name, rank, why], i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{name}</span> (#{rank}) — {why}
                </li>
              ))}
          </ol>
        </Section>

        <Section title="10. Outreach Messages">
          <div className="space-y-4">
            <div>
              <div className="mb-1 font-medium text-foreground">WhatsApp</div>
              <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{String(messages.whatsapp || "—")}</pre>
            </div>
            <div>
              <div className="mb-1 font-medium text-foreground">Cold email</div>
              {coldEmail.subjectLines?.length ? (
                <ul className="mb-2 list-disc pl-5 text-xs">
                  {coldEmail.subjectLines.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : null}
              <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{coldEmail.body || "—"}</pre>
            </div>
            <div>
              <div className="mb-1 font-medium text-foreground">LinkedIn</div>
              <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{String(messages.linkedin || "—")}</pre>
            </div>
            <div>
              <div className="mb-1 font-medium text-foreground">Call opener</div>
              <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{String(messages.callOpener || "—")}</pre>
            </div>
          </div>
        </Section>

        <Section title="11. Icebreakers">
          <ol className="list-decimal space-y-1 pl-5">
            {ice.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </Section>

        <Section title="12. Buying Intent">
          <ul className="space-y-1">
            {buying
              .slice()
              .sort((a, b) => (b[1] || 0) - (a[1] || 0))
              .map(([svc, pct], i) => (
                <li key={i}>
                  {svc}: <span className="font-medium text-foreground">{pct}%</span>
                </li>
              ))}
          </ul>
        </Section>

        <Section title="13. Sales Psychology">
          <dl className="space-y-2">
            <Kv label="Fear" value={String(psych.fear || "")} />
            <Kv label="Desire" value={String(psych.desire || "")} />
            <Kv label="Motivation" value={String(psych.motivation || "")} />
          </dl>
        </Section>

        <Section title="14. Objection Handling">
          <ul className="space-y-3">
            {objections.map(([q, a], i) => (
              <li key={i} className="rounded-lg bg-muted/40 p-3">
                <div className="font-medium text-foreground">{q}</div>
                <div>{a}</div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="15. Next Steps & Final Recommendation">
          <ol className="mb-4 list-decimal space-y-1 pl-5">
            {nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <dl className="space-y-2 rounded-lg bg-muted/40 p-4">
            <Kv label="Channel" value={finalRec.channel} />
            <Kv label="First offer" value={finalRec.firstOffer} />
            <Kv label="Next step" value={finalRec.nextStep} />
            <Kv label="Reasoning" value={finalRec.reasoning} />
          </dl>
        </Section>
      </article>
    </div>
  );
}
