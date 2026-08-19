import type { ProspectData } from "@/server/services/engine";
import type { AuditDocument, MasterLead } from "./types";
import { newAuditId } from "./ids";
import { GTM } from "@/lib/gtm-defaults";

function text(v: unknown): string {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function looksInternal(s: string) {
  return /CONTACT|NURTURE|SKIP|confidence|action card|verdict|ICP|disqualif/i.test(s);
}

function takeSentences(s: string, max = 2) {
  const parts = s.split(/(?<=[.!?])\s+/).filter((p) => p && !looksInternal(p));
  return parts.slice(0, max).join(" ");
}

function sectionNote(sections: unknown, key: string): string {
  if (!Array.isArray(sections)) return "";
  const hit = sections.find((row) => {
    const name = Array.isArray(row) ? String(row[0] || "") : String((row as { name?: string }).name || "");
    return name.toLowerCase().includes(key.toLowerCase());
  });
  if (!hit) return "";
  if (Array.isArray(hit)) return text(hit[2] || hit[1]);
  return text((hit as { comment?: string; note?: string }).comment || (hit as { note?: string }).note);
}

function sectionScore(sections: unknown, key: string): number | null {
  if (!Array.isArray(sections)) return null;
  const hit = sections.find((row) => {
    const name = Array.isArray(row) ? String(row[0] || "") : String((row as { name?: string }).name || "");
    return name.toLowerCase().includes(key.toLowerCase());
  });
  if (!hit) return null;
  if (Array.isArray(hit) && typeof hit[1] === "number") return hit[1];
  const n = Number((hit as { score?: number }).score);
  return Number.isFinite(n) ? n : null;
}

function weak(s: string) {
  return /no |not |none|missing|weak|unclear|limited|fail|unreachable|broken|absent|slow/i.test(s);
}

export function buildAuditDocument(lead: MasterLead, data: ProspectData | null): AuditDocument {
  const audit = data?.websiteAudit;
  const sections = audit?.sections;
  const summary = takeSentences(text(audit?.summary), 4);
  const company = lead.company || text(data?.lead?.company) || "Your company";
  const website = lead.website || text(audit?.analyzedUrl) || "";
  const overview = data?.companyOverview || {};
  const siteDown = /could not load|fetch failed|unreachable|status 0/i.test(
    `${audit?.summary || ""} ${JSON.stringify(data?.painPoints || [])}`
  );

  const whatsWorking: string[] = [];
  const conversion: { heading: string; body: string }[] = [];
  const keys: [string, string][] = [
    ["homepage", "Offer and homepage clarity"],
    ["cta", "Calls to action"],
    ["call", "Calls to action"],
    ["form", "Lead capture"],
    ["contact", "Contact path"],
    ["proof", "Trust and proof"],
    ["testimonial", "Social proof"],
    ["nav", "Navigation"],
  ];
  const seen = new Set<string>();
  for (const [key, heading] of keys) {
    const note = sectionNote(sections, key);
    if (!note || seen.has(heading)) continue;
    seen.add(heading);
    conversion.push({ heading, body: note });
    const score = sectionScore(sections, key);
    if ((score != null && score >= 7) || (!weak(note) && score == null && note.length > 40)) {
      whatsWorking.push(`${heading}: ${takeSentences(note, 1)}`);
    }
  }
  if (!conversion.length && summary) {
    conversion.push({ heading: "Public website review", body: summary });
  }

  const followUp: string[] = [];
  const forms = sectionNote(sections, "form") || sectionNote(sections, "contact") || sectionNote(sections, "lead");
  const chat = sectionNote(sections, "chat") || sectionNote(sections, "response");
  if (forms && weak(forms)) {
    followUp.push("Capture looks thin or manual. Enquiries that are not followed up in minutes are usually lost, not delayed.");
  }
  if (chat && weak(chat)) {
    followUp.push("No live response path was visible. After-hours and busy-hour traffic currently waits.");
  }
  for (const p of data?.painPoints || []) {
    const blob = `${p.pain} ${p.evidence} ${p.impact}`;
    if (/follow|nurture|speed to lead|response time|crm/i.test(blob) && !looksInternal(blob)) {
      const line = takeSentences(text(p.evidence || p.pain), 1);
      if (line) followUp.push(line);
    }
  }

  const booking: string[] = [];
  const bookNote = sectionNote(sections, "book") || sectionNote(sections, "appoint") || sectionNote(sections, "calend");
  const cta = sectionNote(sections, "cta") || sectionNote(sections, "call");
  if (bookNote) booking.push(bookNote);
  else if (cta && /contact|email|call/i.test(cta) && !/book|schedul|calendly|demo/i.test(cta)) {
    booking.push("The site asks people to get in touch, but no diary/booking path was observed. Ready buyers have to wait.");
  }

  const technical: string[] = [];
  const mobile = sectionNote(sections, "mobile");
  const speed = sectionNote(sections, "performance") || sectionNote(sections, "speed");
  const ux = sectionNote(sections, "ux") || sectionNote(sections, "desktop");
  if (mobile) technical.push(mobile);
  if (speed) technical.push(speed);
  if (ux) technical.push(ux);

  const notObserved: string[] = [];
  if (siteDown) {
    notObserved.push("The live website could not be fetched during this review, so page-level conversion claims were not invented.");
  }
  if (!mobile) notObserved.push("Mobile usability was not independently measured.");
  if (!speed) notObserved.push("Lab page-speed tests were not run.");
  if (!data) notObserved.push("Public website data was limited at review time.");

  const priorities: AuditDocument["priorities"] = [];
  if (siteDown) {
    priorities.push({
      finding: "Live site could not be reviewed",
      impact: "High",
      urgency: "Now",
      evidence: "Fetch failed. Until the URL is reachable, every paid click and referral is unverified.",
    });
  }
  if (forms && weak(forms)) {
    priorities.push({
      finding: "Lead capture is leaking demand",
      impact: "High",
      urgency: "Now",
      evidence: takeSentences(forms, 1),
    });
  }
  if (cta && weak(cta)) {
    priorities.push({
      finding: "The next step on the page is unclear",
      impact: "High",
      urgency: "Now",
      evidence: takeSentences(cta, 1),
    });
  }
  if (followUp.length) {
    priorities.push({
      finding: "Follow-up after an enquiry looks manual",
      impact: "High",
      urgency: "This week",
      evidence: followUp[0],
    });
  }
  if (booking.length) {
    priorities.push({
      finding: "No obvious appointment path",
      impact: "Medium",
      urgency: "This month",
      evidence: booking[0],
    });
  }
  if (!priorities.length && summary) {
    priorities.push({
      finding: "Conversion path can be tightened",
      impact: "Medium",
      urgency: "This month",
      evidence: takeSentences(summary, 1),
    });
  }

  const recommendedActions: string[] = [];
  if (siteDown) recommendedActions.push(`Confirm ${website || "the website URL"} loads, then re-run this review on the live pages.`);
  if (priorities.some((p) => /capture|next step|cta/i.test(p.finding))) {
    recommendedActions.push("Put one primary action above the fold: call, short form, or book — not three competing asks.");
  }
  if (followUp.length) {
    recommendedActions.push("Reply to every new enquiry automatically within minutes, then hand the warm ones to a person.");
  }
  if (booking.length) {
    recommendedActions.push("Add a 15-minute booking slot for people who are ready, instead of ‘we’ll call you back’.");
  }
  const proof = sectionNote(sections, "proof") || sectionNote(sections, "testimonial");
  if (proof && weak(proof)) {
    recommendedActions.push("Place one specific result, review, or project next to the main button.");
  }
  if (!recommendedActions.length) {
    recommendedActions.push("Keep the current story and shorten the path from interest to a conversation.");
  }

  const thirtyDayPlan: string[] = [];
  if (siteDown) thirtyDayPlan.push("Day 1–2: restore or correct the public URL.");
  thirtyDayPlan.push("Week 1: one primary CTA on the homepage and contact page.");
  if (followUp.length) thirtyDayPlan.push("Week 1–2: same-day follow-up sequence on every new lead.");
  if (booking.length) thirtyDayPlan.push("Week 2: calendar link or scheduler on the contact path.");
  thirtyDayPlan.push("Week 3–4: measure enquiries, reply time, and booked calls — not vanity traffic.");

  let offer: string = GTM.primaryOffers[0].label;
  let why = "Speed-to-lead is usually the cheapest revenue recover for service businesses.";
  if (siteDown) {
    why = "Until the site is reachable, paid traffic and referrals cannot be converted. Fix visibility first, then conversion.";
  } else if (booking.length && !followUp.length) {
    offer = GTM.primaryOffers[2]?.label || offer;
    why = "Ready buyers currently have to wait. A booking path captures the ones who would have gone quiet.";
  } else if (cta && /landing|convert|unclear|weak/i.test(cta + (sectionNote(sections, "homepage") || ""))) {
    offer = GTM.primaryOffers[1]?.label || offer;
    why = "If the page does not make the next step obvious, more traffic will not create more conversations.";
  }

  const who = text(overview.whoTheyAre as string) || text(overview.whatTheySell as string);
  const top = priorities[0];
  const hookQuestion = siteDown
    ? `If a stranger Googles ${company} right now and the site does not load — what happens to that job?`
    : followUp.length
      ? `When someone enquires after hours, who answers them — your process, or your competitor?`
      : booking.length
        ? `If a ready buyer wants a time today, can they book it without waiting for you?`
        : `If this page had to create one conversation this week, would a first-time visitor know exactly what to do?`;

  const visitorStory = siteDown
    ? `A visitor types the URL. Nothing useful happens. They do not email to complain. They leave. You never hear about it, so it feels like “quiet week” instead of lost demand.`
    : `A first-time visitor lands${website ? ` on ${website}` : ""}. They scan. ${
        top
          ? `The public evidence points to this friction: ${top.finding.toLowerCase()}.`
          : "They decide in seconds whether this looks easy or like work."
      } If the next step is fuzzy, they do not argue. They close the tab.`;

  const uncomfortableQuestions = siteDown
    ? [
        "How many paid clicks landed on a URL that did not respond this month?",
        "If this happened to a competitor, would you still trust their operation?",
        "Who on the team is actually responsible for “the site just working”?",
      ]
    : [
        followUp.length ? "What is your real reply time on a Tuesday at 9:14pm — not the intended one?" : "Which page is supposed to create the enquiry: home, services, or contact?",
        booking.length ? "Can a hot lead book you without a phone tag?" : "If you removed the logo, would a stranger still know what to do next?",
        "If enquiries dropped 20% and traffic stayed flat, would you notice the leak or blame the market?",
        "Are you paying for attention the page cannot convert?",
      ].filter(Boolean);

  const exec = siteDown
    ? `${company} was reviewed. The live website could not be loaded. That is not a design nit. It is a commercial stop: ads, referrals, and returning customers cannot convert on a page that does not answer. This note does not invent on-page issues. It asks the only useful question: is this what your buyers also hit?`
    : [
        `${company} was reviewed as a ${lead.industry || "service"} business${website ? ` (${website})` : ""}.`,
        who ? takeSentences(who, 1) : "",
        top
          ? `The sharpest public issue is not “the brand”. It is ${top.finding.toLowerCase()} — ${top.evidence || "from what the page actually shows"}.`
          : summary,
        "Read this as a buyer would: impatient, comparing, and one tap from leaving.",
      ]
        .filter(Boolean)
        .join(" ");

  const commercialCost = siteDown
    ? "Silence is not “no demand”. It is demand you cannot see. Every failed load looks like a quiet pipeline."
    : followUp.length
      ? "Most lost work dies between first click and first human reply. You do not need more leads until the ones you already paid for are answered."
      : "A vague next step taxes every campaign. You keep buying traffic. The page keeps wasting it.";

  const ifNothingChanges = siteDown
    ? "If nothing changes, next month looks like this month: spend, silence, and a story about “the market”."
    : "If nothing changes, the same leaks keep running. Traffic reports stay busy. The diary does not.";

  const conversationAngle = siteDown
    ? `I tried to open ${company}'s site the way a customer would. It did not load. If that is what buyers see, fifteen minutes to confirm the live URL is cheaper than another month of guesswork.`
    : `I went through ${company}'s public pages as a first-time buyer. One friction stood out${top ? ` — ${top.finding.toLowerCase()}` : ""}. The useful conversation is not “do you want marketing?”. It is: what happens to the next ten visitors who almost enquired?`;

  return {
    id: newAuditId(),
    company,
    website,
    preparedFor: lead.name || company,
    date: new Date().toISOString(),
    title: `Website & conversion review — ${company}`,
    executiveSummary: exec,
    hookQuestion,
    visitorStory,
    uncomfortableQuestions,
    whatsWorking,
    conversion,
    followUp,
    booking,
    technical,
    priorities,
    recommendedActions,
    thirtyDayPlan,
    conversationAngle,
    commercialCost,
    ifNothingChanges,
    nextStep: { offer, why },
    notObserved,
  };
}

export function renderAuditHtml(doc: AuditDocument): string {
    const rows = doc.priorities
    .map(
      (p) =>
        `<tr><td>${esc(p.finding)}</td><td>${esc(p.impact)}</td><td>${esc(p.urgency)}</td><td>${esc(p.evidence || "—")}</td></tr>`
    )
    .join("");
  const conv = doc.conversion
    .map((c) => `<h3>${esc(c.heading)}</h3><p>${esc(c.body)}</p>`)
    .join("");
  const ul = (items: string[]) =>
    items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "<p>None observed in this review.</p>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(doc.title)}</title>
  <style>
    :root { --ink:#122033; --muted:#5b6b7c; --line:#d7dee8; --accent:#0e7c7b; --paper:#f7f8fa; }
    * { box-sizing: border-box; }
    body { margin:0; font: 15px/1.55 Georgia, "Times New Roman", serif; color:var(--ink); background:var(--paper); }
    .page { max-width: 820px; margin: 0 auto; background:#fff; padding: 48px 56px; }
    header { border-bottom: 3px solid var(--accent); padding-bottom: 18px; margin-bottom: 28px; }
    .kicker { font: 11px/1.3 ui-sans-serif, system-ui; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
    h1 { font-size: 28px; margin: 8px 0 6px; }
    .meta { color: var(--muted); font: 13px/1.4 ui-sans-serif, system-ui; }
    h2 { font-size: 18px; margin: 28px 0 10px; color: var(--ink); }
    h3 { font-size: 15px; margin: 16px 0 6px; }
    p, li { color: #1c2a3a; }
    table { width:100%; border-collapse: collapse; margin: 8px 0 16px; font: 13px/1.4 ui-sans-serif, system-ui; }
    th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; }
    th { background: #f3f6f8; }
    footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font: 12px/1.45 ui-sans-serif, system-ui; }
    .next { background: #f2faf9; border: 1px solid #cde8e6; padding: 14px 16px; }
    .hook { font-size: 20px; line-height: 1.35; margin: 0 0 22px; color: #0b1c2c; }
    @media print { body { background:#fff; } .page { padding: 0; } }
  </style>
</head>
<body>
  <article class="page">
    <header>
      <div class="kicker">Confidential client review</div>
      <h1>${esc(doc.title)}</h1>
      <div class="meta">
        Prepared for ${esc(doc.preparedFor || doc.company)}
        ${doc.website ? ` · ${esc(doc.website)}` : ""}
        · ${esc(new Date(doc.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }))}
      </div>
    </header>
    ${doc.hookQuestion ? `<p class="hook">${esc(doc.hookQuestion)}</p>` : ""}
    <h2>1. Executive summary</h2>
    <p>${esc(doc.executiveSummary)}</p>
    ${doc.visitorStory ? `<p>${esc(doc.visitorStory)}</p>` : ""}
    ${doc.commercialCost ? `<p><strong>What this costs you.</strong> ${esc(doc.commercialCost)}</p>` : ""}
    ${doc.ifNothingChanges ? `<p><strong>If nothing changes.</strong> ${esc(doc.ifNothingChanges)}</p>` : ""}
    ${
      doc.uncomfortableQuestions?.length
        ? `<h2>Questions worth sitting with</h2>${ul(doc.uncomfortableQuestions)}`
        : ""
    }
    ${doc.whatsWorking?.length ? `<h2>2. What is already working</h2>${ul(doc.whatsWorking)}` : ""}
    <h2>3. Website / conversion review</h2>
    ${conv || "<p>Public pages were limited; only verified observations are listed below.</p>"}
    <h2>4. Lead follow-up opportunities</h2>
    ${ul(doc.followUp)}
    <h2>5. Appointment booking opportunities</h2>
    ${ul(doc.booking)}
    <h2>6. Technical / UX observations</h2>
    ${ul(doc.technical)}
    <h2>7. Priority findings</h2>
    <table>
      <thead><tr><th>Finding</th><th>Impact</th><th>Urgency</th><th>Evidence</th></tr></thead>
      <tbody>${rows || "<tr><td colspan=4>No high-confidence findings beyond the summary.</td></tr>"}</tbody>
    </table>
    <h2>8. Recommended actions</h2>
    ${ul(doc.recommendedActions)}
    ${doc.thirtyDayPlan?.length ? `<h2>9. 30-day plan</h2>${ul(doc.thirtyDayPlan)}` : ""}
    ${doc.conversationAngle ? `<h2>10. How to raise this</h2><p>${esc(doc.conversationAngle)}</p>` : ""}
    <h2>11. Suggested next step</h2>
    <div class="next">
      <p><strong>${esc(doc.nextStep.offer)}</strong></p>
      <p>${esc(doc.nextStep.why)}</p>
    </div>
    ${
      doc.notObserved.length
        ? `<h2>Scope notes</h2><p class="meta">The following were not verified and are omitted rather than guessed:</p>${ul(doc.notObserved)}`
        : ""
    }
    <footer>
      Prepared as a complimentary review for ${esc(doc.company)}. Observations are based on publicly visible website evidence at the review date. This document is not a sales pitch and does not include internal scoring or targeting notes.
    </footer>
  </article>
</body>
</html>`;
}

function esc(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function buildAuditDocx(doc: AuditDocument): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = await import("docx");
  const p = (t: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
    new Paragraph({
      heading,
      spacing: { after: 160 },
      children: [new TextRun({ text: t, font: "Calibri" })],
    });

  const bullets = (items: string[]) =>
    (items.length ? items : ["None observed in this review."]).map(
      (t) =>
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80 },
          children: [new TextRun({ text: t, font: "Calibri" })],
        })
    );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: ["Finding", "Impact", "Urgency"].map(
          (h) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, font: "Calibri" })] })],
            })
        ),
      }),
      ...doc.priorities.map(
        (row) =>
          new TableRow({
            children: [row.finding, row.impact, row.urgency].map(
              (c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, font: "Calibri" })] })] })
            ),
          })
      ),
    ],
  });

  const document = new Document({
    sections: [
      {
        properties: {},
        children: [
          p("CONFIDENTIAL CLIENT REVIEW"),
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: doc.title, font: "Calibri" })],
          }),
          p(`Prepared for ${doc.preparedFor || doc.company}${doc.website ? ` · ${doc.website}` : ""} · ${new Date(doc.date).toLocaleDateString()}`),
          p("1. Executive summary", HeadingLevel.HEADING_1),
          p(doc.hookQuestion || doc.executiveSummary),
          p(doc.executiveSummary),
          ...(doc.visitorStory ? [p(doc.visitorStory)] : []),
          ...(doc.commercialCost ? [p(`What this costs you. ${doc.commercialCost}`)] : []),
          ...(doc.ifNothingChanges ? [p(`If nothing changes. ${doc.ifNothingChanges}`)] : []),
          ...(doc.uncomfortableQuestions?.length
            ? [p("Questions worth sitting with", HeadingLevel.HEADING_1), ...bullets(doc.uncomfortableQuestions)]
            : []),
          p("2. Website / conversion review", HeadingLevel.HEADING_1),
          ...doc.conversion.flatMap((c) => [p(c.heading, HeadingLevel.HEADING_2), p(c.body)]),
          p("3. Lead follow-up opportunities", HeadingLevel.HEADING_1),
          ...bullets(doc.followUp),
          p("4. Appointment booking opportunities", HeadingLevel.HEADING_1),
          ...bullets(doc.booking),
          p("5. Technical / UX observations", HeadingLevel.HEADING_1),
          ...bullets(doc.technical),
          p("6. Priority findings", HeadingLevel.HEADING_1),
          table,
          p("7. Recommended actions", HeadingLevel.HEADING_1),
          ...bullets(doc.recommendedActions),
          p("8. Suggested next step", HeadingLevel.HEADING_1),
          p(doc.nextStep.offer, HeadingLevel.HEADING_2),
          p(doc.nextStep.why),
          p("This complimentary review is based on publicly visible website evidence. Internal targeting notes are not included."),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

export async function renderAuditPdf(html: string): Promise<Buffer> {
  const puppeteer = await import("puppeteer").then((m) => m.default || m).catch(() => null);
  if (!puppeteer) {
    throw new Error("PDF engine unavailable — download Word or print the preview to PDF.");
  }
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
