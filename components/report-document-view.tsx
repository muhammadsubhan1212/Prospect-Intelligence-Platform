"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileText,
  LayoutList,
  Maximize2,
  Minimize2,
  Printer,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";

type Props = {
  reportId: string;
  company: string;
};

/**
 * Faithful Word preview: loads the real .docx bytes and paints them with
 * docx-preview (colors, tables, page layout) — much closer to MS Word than mammoth HTML.
 */
export function ReportDocumentView({ reportId, company }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const host = hostRef.current;
      const styleHost = styleRef.current;
      if (!host) return;
      host.innerHTML = "";

      try {
        const res = await fetch(`/api/reports/${reportId}/download?preview=1`);
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error((errJson as { error?: string }).error || `Download failed (${res.status})`);
        }
        const buffer = await res.arrayBuffer();
        if (cancelled) return;

        const { renderAsync } = await import("docx-preview");
        await renderAsync(buffer, host, styleHost || undefined, {
          className: "prospect-docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
          useBase64URL: true,
          hideWrapperOnPrint: false,
        });
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

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
      setFullscreen((v) => !v);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <div
      ref={rootRef}
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-[#525659]"
          : "flex min-h-[70vh] flex-col overflow-hidden rounded-xl border border-border bg-[#525659]"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/25 bg-[#2b2b2b] px-4 py-2.5 text-white print:hidden">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{company} — Prospect Intelligence Report.docx</div>
          <div className="text-[11px] text-white/55">
            Faithful Word preview (colors &amp; layout from the real DOCX)
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/reports/${reportId}/view`}>
            <Button size="sm" variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20">
              <LayoutList className="h-3.5 w-3.5" />
              Web view
            </Button>
          </Link>
          <a href={`/api/reports/${reportId}/download`}>
            <Button size="sm" variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20">
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </a>
          <Button
            size="sm"
            variant="outline"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
            onClick={() => window.print()}
          >
            <Printer className="h-3.5 w-3.5" />
            Print / PDF
          </Button>
          <Button size="sm" className="bg-accent text-accent-foreground" onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {fullscreen ? "Exit" : "Full screen"}
          </Button>
          {fullscreen ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10"
              onClick={() => void toggleFullscreen()}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Hidden style host for docx-preview injected CSS */}
      <div ref={styleRef} className="hidden" aria-hidden />

      <div className="docx-scroll relative flex-1 overflow-y-auto px-3 py-8 print:bg-white print:p-0 md:px-8">
        {loading ? (
          <div className="pointer-events-none absolute inset-x-0 top-8 z-10 mx-auto max-w-xl rounded bg-white p-10 text-center text-sm text-neutral-500 shadow-lg">
            Opening Word document with full formatting…
          </div>
        ) : null}
        {error ? (
          <div className="mx-auto max-w-xl rounded bg-white p-10 text-sm text-red-600 shadow-lg">
            <p className="font-medium">Could not render document</p>
            <p className="mt-2 text-neutral-600">{error}</p>
            <a className="mt-4 inline-block text-accent underline" href={`/api/reports/${reportId}/download`}>
              Download DOCX instead
            </a>
          </div>
        ) : null}
        <div ref={hostRef} className={`docx-host mx-auto ${error ? "hidden" : ""}`} />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .docx-host .prospect-docx-wrapper {
          background: transparent !important;
          padding: 0 !important;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }
        .docx-host .prospect-docx {
          background: #fff !important;
          box-shadow: 0 4px 28px rgba(0,0,0,0.35);
          margin: 0 auto 24px !important;
          color: #10151f;
        }
        .docx-host section.prospect-docx {
          /* page sections from docx-preview */
        }
        .docx-host table {
          border-collapse: collapse;
        }
        .docx-host td, .docx-host th {
          /* keep Word cell shading / borders from inline styles */
        }
        @media print {
          .docx-scroll {
            overflow: visible !important;
            background: #fff !important;
            padding: 0 !important;
          }
          .docx-host .prospect-docx {
            box-shadow: none !important;
            margin: 0 !important;
          }
        }
      `,
        }}
      />
    </div>
  );
}

export function DocumentViewChrome({
  reportId,
  children,
}: {
  reportId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/reports/${reportId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Details
          </Button>
        </Link>
        <FileText className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Document view — faithful Word render of the downloaded DOCX. Web dossier stays at{" "}
          <Link href={`/reports/${reportId}/view`} className="text-accent hover:underline">
            /view
          </Link>
          .
        </p>
      </div>
      {children}
    </div>
  );
}
