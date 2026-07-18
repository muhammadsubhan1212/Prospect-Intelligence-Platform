/**
 * Migration plan (complete)
 *
 * 1. Scaffold Next.js 15 App Router app at prospect-platform/
 * 2. Copy existing CLI engine → server/engine/ (unchanged logic)
 * 3. Extract processLead → server/engine/pipeline.js (shared by CLI + web)
 * 4. Bridge via server/services/engine-bridge.cjs (no second implementation)
 * 5. Services: csv, report/jobs, auth, paths/storage
 * 6. API routes wrap the same pipeline
 * 7. UI: login, dashboard, new report, processing, reports, details
 * 8. Vercel-ready (vercel.json maxDuration, env vars)
 * 9. CLI kept: npm run engine -- --csv … --row N
 */

export {};
