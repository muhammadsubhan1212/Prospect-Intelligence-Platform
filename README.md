# Outreach Action

Upload a lead CSV → get an **Instantly-ready CONTACT list** (who to skip, who to email, subject + body) → track replies and meetings.

DOCX / full research dossiers stay available as **optional archive** — they are not the product.

## What you get

1. **Action Card** per lead: `CONTACT` | `NURTURE` | `SKIP`
2. One offer angle + Instantly/Apollo-friendly email fields
3. **Download Instantly CSV** for CONTACT rows (one click from batch / dashboard)
4. Mark outcomes (`sent` → `replied` → `meeting`) and see reply/meeting rates on the dashboard

## Quick start

```bash
cd prospect-platform
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000 → **New run** → upload CSV → set ICP (defaults prefilled for UK property SMBs) → **Generate action list** → **Download Instantly CSV**.

### Operator loop (Rule of 100)

1. Generate a batch  
2. Export last CONTACT CSV from the dashboard  
3. Send in Instantly (or Gmail from the Action Card)  
4. Mark outcomes on each Action Card  
5. Watch reply % / meeting % and progress toward 100 touches  

## Architecture

```
Browser UI (Action Cards + Instantly export)
  → API Routes (/api/…)
    → Services (csv / report)
      → server/engine (research → strategy → actionCard → optional DOCX)
```

No login — private/internal deploy. Suitable for a single operator team.

## CLI (unchanged)

```bash
npm run engine -- --csv path/to/leads.csv --row 1
```

Still writes JSON + DOCX including `actionCard`.

## Deploy to Vercel

1. Push this repo (project root = `prospect-platform`).
2. **Create a Blob store** (Storage → Blob → Connect) so uploads/reports persist across serverless instances.
3. Deploy. Pro recommended for multi-row batches (`maxDuration` 300s).

## Features

| Goal | Where |
|------|--------|
| CONTACT / SKIP / NURTURE | Action Card on report detail |
| Instantly CSV | Dashboard, batch results, bulk bar |
| ICP + offer focus (max 3) | New run |
| Reply / meeting proof | Dashboard scoreboard (30d) |
| Full dossier DOCX | Secondary link — optional archive |
