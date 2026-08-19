"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, Trash2, X, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { formatBytes } from "@/lib/utils";
import {
  LARGE_CSV_ROW_THRESHOLD,
  LARGE_CSV_SIZE_BYTES,
  VERCEL_SAFE_UPLOAD_BYTES,
  OFFER_FOCUS_OPTIONS,
  MAX_OFFER_FOCUS,
  DEFAULT_ICP,
  clearNewReportSession,
  estimateCsvRows,
  icpFormToOptions,
  loadIcpLocal,
  loadNewReportSession,
  readUploadError,
  saveIcpLocal,
  saveNewReportSession,
  truncateCsvFile,
  type IcpFormState,
  type NewReportSession,
} from "@/lib/new-report-session";
import { GTM } from "@/lib/gtm-defaults";
import {
  deleteCsvText,
  loadCsvText,
  paginateClient,
  saveCsvText,
} from "@/lib/csv-workspace";
import { cacheReportsFromGenerate } from "@/lib/report-cache";
import { CopyLinkedin } from "@/components/copy-linkedin";

type UploadMeta = {
  id: string;
  filename: string;
  size: number;
  rowCount: number;
  headers: string[];
  truncated?: boolean;
  originalRowCount?: number;
};

type MappedRow = {
  fullName: string;
  company: string;
  email: string;
  website: string;
  title?: string;
  phone?: string;
  linkedin?: string;
  _rowIndex?: number;
};

type LargePrompt = { file: File; estimatedRows: number };

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

function NewReportInner() {
  const router = useRouter();
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState("");
  const [upload, setUpload] = useState<UploadMeta | null>(null);
  const [rows, setRows] = useState<MappedRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQ, setSearchQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loadingPage, setLoadingPage] = useState(false);
  const [mode, setMode] = useState<"row" | "range" | "all" | "email" | "company">("row");
  const [row, setRow] = useState("1");
  const [rowFrom, setRowFrom] = useState("1");
  const [rowTo, setRowTo] = useState("5");
  const [limit, setLimit] = useState("10");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("12000");
  const [generating, setGenerating] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [largePrompt, setLargePrompt] = useState<LargePrompt | null>(null);
  const [icpOpen, setIcpOpen] = useState(true);
  const [icp, setIcp] = useState<IcpFormState>(DEFAULT_ICP);

  const fetchPage = useCallback(
    async (uploadId: string, nextPage: number, nextSize: number, q: string) => {
      setLoadingPage(true);
      setError("");
      try {
        const local = await loadCsvText(uploadId);
        if (local?.text) {
          const pageData = paginateClient(local.text, { page: nextPage, pageSize: nextSize, q });
          setRows(pageData.mappedPreview as MappedRow[]);
          setPage(pageData.page);
          setPageSize(pageData.pageSize);
          setTotalRows(pageData.totalRows);
          setTotalPages(pageData.totalPages);
          return;
        }

        const params = new URLSearchParams({
          id: uploadId,
          page: String(nextPage),
          pageSize: String(nextSize),
          q,
        });
        const res = await fetch(`/api/csv/preview?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load rows");
        setUpload(json.upload);
        setRows(json.mappedPreview || []);
        setPage(json.page || nextPage);
        setPageSize(json.pageSize || nextSize);
        setTotalRows(json.totalRows ?? json.upload?.rowCount ?? 0);
        setTotalPages(json.totalPages || 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingPage(false);
      }
    },
    []
  );

  const applyUploadMeta = useCallback((meta: UploadMeta, opts?: Partial<NewReportSession>) => {
    setUpload(meta);
    const rc = meta.rowCount;
    setRowTo(opts?.rowTo ?? String(Math.min(5, rc)));
    setLimit(opts?.limit ?? String(Math.min(10, rc)));
    if (opts?.mode) setMode(opts.mode);
    if (opts?.row) setRow(opts.row);
    if (opts?.rowFrom) setRowFrom(opts.rowFrom);
    if (opts?.email) setEmail(opts.email);
    if (opts?.company) setCompany(opts.company);
    if (opts?.timeoutMs) setTimeoutMs(opts.timeoutMs);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = loadNewReportSession();
      const savedIcp = saved?.icp || loadIcpLocal() || DEFAULT_ICP;
      if (!cancelled) {
        const merged = { ...DEFAULT_ICP, ...savedIcp };
        merged.offerFocus = (merged.offerFocus || []).slice(0, MAX_OFFER_FOCUS);
        setIcp(merged);
        setIcpOpen(true);
      }
      if (!saved?.uploadId) {
        if (!cancelled) setRestoring(false);
        return;
      }
      try {
        applyUploadMeta(
          {
            id: saved.uploadId,
            filename: saved.filename,
            size: saved.size,
            rowCount: saved.rowCount,
            headers: saved.headers,
            truncated: saved.truncated,
            originalRowCount: saved.originalRowCount,
          },
          saved
        );
        setMode(saved.mode);
        setRow(saved.row);
        setRowFrom(saved.rowFrom);
        setRowTo(saved.rowTo);
        setLimit(saved.limit);
        setEmail(saved.email);
        setCompany(saved.company);
        setTimeoutMs(saved.timeoutMs);

        const local = await loadCsvText(saved.uploadId);
        if (local?.text) {
          setCsvFile(new File([local.text], saved.filename, { type: "text/csv" }));
          if (!cancelled) await fetchPage(saved.uploadId, 1, 20, "");
        } else {
          // Server preview may work when Blob is connected
          if (!cancelled) await fetchPage(saved.uploadId, 1, 20, "");
        }
      } catch {
        clearNewReportSession();
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUploadMeta, fetchPage]);

  useEffect(() => {
    if (restoring || !upload) return;
    const session: NewReportSession = {
      uploadId: upload.id,
      filename: upload.filename,
      size: upload.size,
      rowCount: upload.rowCount,
      headers: upload.headers,
      truncated: upload.truncated,
      originalRowCount: upload.originalRowCount,
      mode,
      row,
      rowFrom,
      rowTo,
      limit,
      email,
      company,
      timeoutMs,
      icp,
      savedAt: new Date().toISOString(),
    };
    saveNewReportSession(session);
    saveIcpLocal(icp);
  }, [upload, mode, row, rowFrom, rowTo, limit, email, company, timeoutMs, icp, restoring]);

  const uploadFile = useCallback(
    async (file: File, maxRows?: number) => {
      setError("");
      setUploading(true);
      setLargePrompt(null);
      try {
        let toSend = file;
        if (maxRows != null) {
          toSend = await truncateCsvFile(file, maxRows);
        } else if (file.size > VERCEL_SAFE_UPLOAD_BYTES) {
          throw new Error(
            `Full CSV is ${formatBytes(file.size)} — Vercel only accepts ~4.5MB per upload. Use “Load first ${LARGE_CSV_ROW_THRESHOLD.toLocaleString()} rows” instead.`
          );
        }

        const text = await toSend.text();
        const form = new FormData();
        form.append("file", toSend);
        if (maxRows != null) form.append("maxRows", String(maxRows));
        const res = await fetch("/api/csv/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error(await readUploadError(res));
        const json = await res.json();
        await saveCsvText(json.upload.id, json.upload.filename, text);
        setCsvFile(toSend);
        applyUploadMeta(json.upload);
        setRow("1");
        setRowFrom("1");
        setMode("row");
        setSearchQ("");
        setSearchInput("");
        setPage(1);
        setPageSize(20);
        // Prefer browser pagination (survives Vercel multi-instance /tmp)
        const pageData = paginateClient(text, { page: 1, pageSize: 20, q: "" });
        setRows(pageData.mappedPreview as MappedRow[]);
        setTotalRows(pageData.totalRows);
        setTotalPages(pageData.totalPages);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setUpload(null);
        setRows([]);
        setCsvFile(null);
      } finally {
        setUploading(false);
      }
    },
    [applyUploadMeta]
  );

  const onFile = useCallback(
    async (file: File) => {
      setError("");
      try {
        const estimatedRows = await estimateCsvRows(file);
        const looksLarge = estimatedRows > LARGE_CSV_ROW_THRESHOLD || file.size >= LARGE_CSV_SIZE_BYTES;
        if (looksLarge) {
          setLargePrompt({ file, estimatedRows });
          return;
        }
        await uploadFile(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [uploadFile]
  );

  async function onClearWorkspace() {
    if (!confirm("Remove this CSV from the current session? Generated reports in Reports stay available.")) return;
    const id = upload?.id;
    clearNewReportSession();
    setUpload(null);
    setRows([]);
    setCsvFile(null);
    setError("");
    setLargePrompt(null);
    setSearchQ("");
    setSearchInput("");
    setMode("row");
    setRow("1");
    setRowFrom("1");
    setRowTo("5");
    setLimit("10");
    setEmail("");
    setCompany("");
    if (id) {
      try {
        await deleteCsvText(id);
        await fetch(`/api/csv/${id}`, { method: "DELETE" });
      } catch {
        /* ignore */
      }
    }
  }

  function selectRow(rowIndex: number, mapped: MappedRow) {
    setMode("row");
    setRow(String(rowIndex));
    if (mapped.email) setEmail(mapped.email);
    if (mapped.company) setCompany(mapped.company);
  }

  async function onGenerate() {
    if (!upload) return;
    setGenerating(true);
    setError("");
    const options: Record<string, unknown> = {
      timeout: parseInt(timeoutMs, 10) || 12000,
      saveJson: true,
    };
    if (mode === "row") options.row = parseInt(row, 10);
    if (mode === "range") {
      options.rowFrom = parseInt(rowFrom, 10);
      options.rowTo = parseInt(rowTo, 10);
    }
    if (mode === "all") {
      options.all = true;
      options.limit = parseInt(limit, 10) || undefined;
    }
    if (mode === "email") options.email = email;
    if (mode === "company") options.company = company;

    const { icpProfile, offerFocus } = icpFormToOptions(icp);
    options.icpProfile = icpProfile;
    if (offerFocus.length) options.offerFocus = offerFocus;
    saveIcpLocal(icp);

    try {
      let file = csvFile;
      if (!file) {
        const local = await loadCsvText(upload.id);
        if (local?.text) file = new File([local.text], upload.filename, { type: "text/csv" });
      }

      // Check for already-analyzed / already-sent overlaps before spending research time
      let replaceExisting = false;
      {
        let checkRes: Response;
        if (file) {
          const form = new FormData();
          form.append("file", file);
          form.append("uploadId", upload.id);
          form.append("options", JSON.stringify(options));
          checkRes = await fetch("/api/reports/check-overlap", { method: "POST", body: form });
        } else {
          checkRes = await fetch("/api/reports/check-overlap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId: upload.id, options }),
          });
        }
        const check = await checkRes.json();
        if (checkRes.ok && (check.alreadyAnalyzed?.length || check.priorFilenameBatches?.length)) {
          const analyzed = check.alreadyAnalyzed?.length || 0;
          const sent = check.alreadySent?.length || 0;
          const samples = (check.alreadyAnalyzed || [])
            .slice(0, 8)
            .map(
              (m: { company?: string; email?: string; alreadySent?: boolean }) =>
                `• ${m.company || "—"}${m.email ? ` <${m.email}>` : ""}${m.alreadySent ? " (already sent)" : ""}`
            )
            .join("\n");
          const msg =
            `${analyzed} contact(s) in this selection were already analyzed` +
            (sent ? ` (${sent} already emailed)` : "") +
            `.\n\n` +
            (samples ? `${samples}${analyzed > 8 ? "\n• …" : ""}\n\n` : "") +
            `Re-analyzing will REPLACE prior unsent reports (old Action Cards / DOCX removed).\n` +
            (sent
              ? `Already-sent contacts are kept for tracking and will be skipped in Send Queue.\n\n`
              : `\n`) +
            `Continue?`;
          if (!confirm(msg)) {
            setGenerating(false);
            return;
          }
          replaceExisting = true;
        }
      }

      let res: Response;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("uploadId", upload.id);
        form.append("options", JSON.stringify(options));
        if (replaceExisting) form.append("replaceExisting", "1");
        res = await fetch("/api/report/generate", { method: "POST", body: form });
      } else {
        res = await fetch("/api/report/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: upload.id, options, replaceExisting }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generate failed");
      if (json.batch?.id) {
        try {
          sessionStorage.setItem(`prospect_batch_${json.batch.id}`, JSON.stringify(json));
        } catch {
          /* ignore quota */
        }
        cacheReportsFromGenerate(json);
        const completed = (json.reports || []).filter(
          (r: { status?: string }) => r.status === "completed"
        );
        if (completed.length === 1) {
          router.push(`/reports/${completed[0].id}`);
        } else {
          const contacts = completed.filter(
            (r: { decision?: string }) => (r.decision || "CONTACT") === "CONTACT"
          );
          if (contacts.length > 0) {
            router.push(`/reports/sending/${json.batch.id}`);
          } else {
            router.push(`/reports/processing/${json.batch.id}`);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  if (restoring) {
    return <div className="text-sm text-muted-foreground">Restoring your CSV workspace…</div>;
  }

  const fromRow = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRow = Math.min(page * pageSize, totalRows);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New run</h1>
        <p className="text-sm text-muted-foreground">
          Upload a lead CSV → Instantly-ready CONTACT list (who to SKIP, who to email, subject + body). DOCX is optional archive only.
        </p>
      </div>

      {largePrompt ? (
        <Card className="border-warning/40 bg-warning/5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">This CSV looks large</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{largePrompt.file.name}</span> — about{" "}
                <span className="font-medium text-foreground">{largePrompt.estimatedRows.toLocaleString()}</span>{" "}
                rows ({formatBytes(largePrompt.file.size)}). On Vercel, only ~4.5MB can be uploaded at once — choose
                the first {LARGE_CSV_ROW_THRESHOLD.toLocaleString()} rows (trimmed in your browser), or upload the full
                file only if it is under that limit.
              </p>
            </div>
            <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" onClick={() => setLargePrompt(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={uploading} onClick={() => void uploadFile(largePrompt.file, LARGE_CSV_ROW_THRESHOLD)}>
              {uploading ? "Loading…" : `Load first ${LARGE_CSV_ROW_THRESHOLD.toLocaleString()} rows`}
            </Button>
            <Button
              variant="outline"
              disabled={uploading || largePrompt.file.size > VERCEL_SAFE_UPLOAD_BYTES}
              onClick={() => void uploadFile(largePrompt.file)}
              title={
                largePrompt.file.size > VERCEL_SAFE_UPLOAD_BYTES
                  ? "File exceeds Vercel’s ~4.5MB upload limit"
                  : undefined
              }
            >
              {uploading ? "Uploading…" : "Upload full CSV"}
            </Button>
            <Button variant="ghost" disabled={uploading} onClick={() => setLargePrompt(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {!upload ? (
        <Card
          className={`flex flex-col items-center justify-center border-dashed p-10 text-center transition-colors ${
            drag ? "border-accent bg-accent/5" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void onFile(file);
          }}
        >
          <Upload className="mb-3 h-8 w-8 text-accent" />
          <p className="font-medium">Drag & drop a CSV here</p>
          <p className="mt-1 text-sm text-muted-foreground">or choose a file from your computer</p>
          <label className="mt-4">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                e.target.value = "";
              }}
            />
            <span className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground">
              {uploading ? "Uploading…" : "Select CSV"}
            </span>
          </label>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {upload ? (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-4">
              <FileSpreadsheet className="h-8 w-8 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{upload.filename}</div>
                <div className="text-sm text-muted-foreground">
                  {upload.rowCount.toLocaleString()} rows
                  {upload.truncated && upload.originalRowCount
                    ? ` (first ${upload.rowCount.toLocaleString()} of ${upload.originalRowCount.toLocaleString()})`
                    : ""}{" "}
                  · {formatBytes(upload.size)} · {upload.headers.length} columns
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onFile(file);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-border px-3 text-sm hover:bg-muted">
                    Replace CSV
                  </span>
                </label>
                <Button variant="outline" size="sm" onClick={() => void onClearWorkspace()}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear from session
                </Button>
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-medium">Bulk analyze presets</h2>
            <p className="text-sm text-muted-foreground">
              One-click sets All rows + limit. Large runs may hit serverless timeouts — use 50, then “Analyze next 50”.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const mins = Math.round(50 * GTM.analyzeMinutesPerLead);
                  if (
                    !confirm(
                      `Analyze 50 leads (~${mins} min)? May need Vercel Pro maxDuration. Prefer chunking if unsure.`
                    )
                  ) {
                    return;
                  }
                  setMode("all");
                  setLimit("50");
                }}
              >
                Analyze 50
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const mins = Math.round(100 * GTM.analyzeMinutesPerLead);
                  if (
                    !confirm(
                      `Analyze 100 leads (~${mins} min)? High timeout risk on serverless — consider two × 50 runs.`
                    )
                  ) {
                    return;
                  }
                  setMode("all");
                  setLimit("100");
                }}
              >
                Analyze 100
              </Button>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-medium">Selection (CLI parity)</h2>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["row", "Specific row"],
                  ["range", "Row range"],
                  ["all", "All rows"],
                  ["email", "By email"],
                  ["company", "By company"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    mode === id ? "border-accent bg-accent/10 text-accent" : "border-border hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "row" ? (
              <div className="max-w-xs space-y-2">
                <Label>Row number (1-based)</Label>
                <Input value={row} onChange={(e) => setRow(e.target.value)} type="number" min={1} max={upload.rowCount} />
                <p className="text-xs text-muted-foreground">Tip: click a row in the table below to select it.</p>
              </div>
            ) : null}
            {mode === "range" ? (
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input value={rowFrom} onChange={(e) => setRowFrom(e.target.value)} type="number" min={1} />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input value={rowTo} onChange={(e) => setRowTo(e.target.value)} type="number" min={1} />
                </div>
              </div>
            ) : null}
            {mode === "all" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const mins = Math.round(50 * GTM.analyzeMinutesPerLead);
                      if (
                        !confirm(
                          `Analyze first 50 rows? Roughly ~${mins} min. On Vercel this may need Pro timeout — or run Analyze 50 twice (chunking).`
                        )
                      ) {
                        return;
                      }
                      setLimit("50");
                    }}
                  >
                    Analyze 50
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const mins = Math.round(100 * GTM.analyzeMinutesPerLead);
                      if (
                        !confirm(
                          `Analyze first 100 rows? Roughly ~${mins} min / high timeout risk. Prefer Analyze 50 twice if on serverless.`
                        )
                      ) {
                        return;
                      }
                      setLimit("100");
                    }}
                  >
                    Analyze 100
                  </Button>
                </div>
                <div className="max-w-xs space-y-2">
                  <Label>Custom limit (--limit)</Label>
                  <Input value={limit} onChange={(e) => setLimit(e.target.value)} type="number" min={1} />
                  <p className="text-xs text-muted-foreground">
                    Est. ~{Math.round((parseInt(limit, 10) || 0) * GTM.analyzeMinutesPerLead)} min. Chunk with 50 if
                    timeouts.
                  </p>
                </div>
              </div>
            ) : null}
            {mode === "email" ? (
              <div className="max-w-md space-y-2">
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com" />
              </div>
            ) : null}
            {mode === "company" ? (
              <div className="max-w-md space-y-2">
                <Label>Company contains</Label>
                <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" />
              </div>
            ) : null}
            <div className="max-w-xs space-y-2">
              <Label>Fetch timeout (ms)</Label>
              <Input value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} type="number" />
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setIcpOpen((v) => !v)}
            >
              <div>
                <h2 className="font-medium">ICP & offer focus</h2>
                <p className="text-xs text-muted-foreground">
                  Defaults for {GTM.nicheLabel}. Edit anytime — saved for next run. Max {MAX_OFFER_FOCUS} offers.
                </p>
              </div>
              <span className="text-sm text-accent">{icpOpen ? "Hide" : "Show"}</span>
            </button>
            {icpOpen ? (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="space-y-2">
                  <Label>Target industries (comma-separated)</Label>
                  <Input
                    value={icp.targetIndustries}
                    onChange={(e) => setIcp((p) => ({ ...p, targetIndustries: e.target.value }))}
                    placeholder="real estate, SaaS, dental"
                  />
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-2">
                    <Label>Min employees</Label>
                    <Input
                      type="number"
                      className="w-28"
                      value={icp.minEmployees}
                      onChange={(e) => setIcp((p) => ({ ...p, minEmployees: e.target.value }))}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max employees</Label>
                    <Input
                      type="number"
                      className="w-28"
                      value={icp.maxEmployees}
                      onChange={(e) => setIcp((p) => ({ ...p, maxEmployees: e.target.value }))}
                      placeholder="50"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Geographies</Label>
                  <Input
                    value={icp.geographies}
                    onChange={(e) => setIcp((p) => ({ ...p, geographies: e.target.value }))}
                    placeholder="United Kingdom, United States"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tech must-have</Label>
                    <Input
                      value={icp.techMustHave}
                      onChange={(e) => setIcp((p) => ({ ...p, techMustHave: e.target.value }))}
                      placeholder="Shopify"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tech must-not-have</Label>
                    <Input
                      value={icp.techMustNotHave}
                      onChange={(e) => setIcp((p) => ({ ...p, techMustNotHave: e.target.value }))}
                      placeholder="Salesforce"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>
                    Offers you sell this month ({icp.offerFocus.length}/{MAX_OFFER_FOCUS})
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {OFFER_FOCUS_OPTIONS.map((o) => {
                      const on = icp.offerFocus.includes(o.id);
                      const atCap = !on && icp.offerFocus.length >= MAX_OFFER_FOCUS;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          disabled={atCap}
                          title={atCap ? `Select at most ${MAX_OFFER_FOCUS}` : undefined}
                          onClick={() =>
                            setIcp((p) => {
                              if (on) {
                                return { ...p, offerFocus: p.offerFocus.filter((x) => x !== o.id) };
                              }
                              if (p.offerFocus.length >= MAX_OFFER_FOCUS) return p;
                              return { ...p, offerFocus: [...p.offerFocus, o.id] };
                            })
                          }
                          className={`rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                            on ? "border-accent bg-accent/10 text-accent" : "border-border hover:bg-muted"
                          }`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
            <Button onClick={onGenerate} disabled={generating}>
              {generating ? "Researching & generating… (1–2 min)" : "Generate action list"}
            </Button>
          </Card>

          <Card className="overflow-hidden">
            <div className="space-y-3 border-b border-border px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-medium">CSV rows</h2>
                  <p className="text-xs text-muted-foreground">
                    Showing {fromRow.toLocaleString()}–{toRow.toLocaleString()} of {totalRows.toLocaleString()}
                    {searchQ ? ` (filtered)` : ""} · click a row to select it for generation
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Rows per page</Label>
                  <select
                    className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
                    value={pageSize}
                    onChange={(e) => {
                      const size = parseInt(e.target.value, 10);
                      setPageSize(size);
                      setPage(1);
                      void fetchPage(upload.id, 1, size, searchQ);
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearchQ(searchInput.trim());
                  setPage(1);
                  void fetchPage(upload.id, 1, pageSize, searchInput.trim());
                }}
              >
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search name, company, email, website…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="outline" disabled={loadingPage}>
                  Search
                </Button>
                {searchQ ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQ("");
                      setPage(1);
                      void fetchPage(upload.id, 1, pageSize, "");
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </form>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Row</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">LinkedIn</th>
                    <th className="px-4 py-3 font-medium">Website</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingPage ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        Loading rows…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No rows match.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const idx = r._rowIndex || 0;
                      const selected = mode === "row" && String(idx) === row;
                      return (
                        <tr
                          key={`${idx}-${r.email}`}
                          className={`cursor-pointer border-t border-border hover:bg-muted/50 ${
                            selected ? "bg-accent/10" : ""
                          }`}
                          onClick={() => selectRow(idx, r)}
                        >
                          <td className="px-4 py-2 text-muted-foreground">{idx}</td>
                          <td className="px-4 py-2">{r.fullName || "—"}</td>
                          <td className="px-4 py-2">{r.company || "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">{r.title || "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">{r.email || "—"}</td>
                          <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                            <CopyLinkedin url={r.linkedin} compact />
                          </td>
                          <td className="max-w-[220px] truncate px-4 py-2 text-muted-foreground">{r.website || "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
              <div className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loadingPage}
                  onClick={() => {
                    const p = page - 1;
                    setPage(p);
                    void fetchPage(upload.id, p, pageSize, searchQ);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loadingPage}
                  onClick={() => {
                    const p = page + 1;
                    setPage(p);
                    void fetchPage(upload.id, p, pageSize, searchQ);
                  }}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function NewReportPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <NewReportInner />
    </Suspense>
  );
}
