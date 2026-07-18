# Prospect Intelligence Platform

Web UI around the existing CLI Prospect Intelligence engine. **Business logic is unchanged** — the same `csv.js`, `research.js`, `strategy.js`, and DOCX generator run under `server/engine/`.

## Architecture

```
Browser UI
  → API Routes (/api/…)
    → Services (csv / report)
      → server/engine (existing CommonJS pipeline)
        → research → strategy → renderReport → DOCX
```

No login — the app opens straight to the dashboard. Suitable for a private/internal deploy URL.

## Local development

```bash
cd prospect-platform
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000 — redirects to `/dashboard`.

### CLI (still available)

```bash
npm run engine -- --csv "..\google_contacts_prep\output_test\whatsapp_present_full.csv" --row 1
```

## Deploy to Vercel

1. Push this repo (or the `prospect-platform` folder as the project root).
2. No auth env vars required. You can delete `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `AUTH_SECRET` if they were set earlier.
3. Deploy. Hobby plans have shorter function timeouts — Pro recommended for multi-row batches.

**Storage note:** On Vercel the filesystem under `/tmp` is ephemeral. Local/dev uses `./storage/`. For durable production files, point `STORAGE_ROOT` at a mounted volume or swap the path helpers for Vercel Blob / S3 (services already isolate I/O).

## Features mapped from CLI

| CLI | UI |
|-----|----|
| `--row N` | Specific row |
| `--all --limit N` | All rows + limit |
| `--email` / `--company` | By email / company |
| `--timeout` | Timeout field |
| `--save-json` | Always on for web jobs |

CSV index labels (`Test-R34`, `Unnamed: 46`, …) still ignored via existing `lib/csv.js` rules.
