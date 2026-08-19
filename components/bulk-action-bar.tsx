"use client";

import { useState } from "react";
import { Download, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";

/**
 * Sticky action bar shown whenever one or more reports are selected via
 * checkbox. Handles Instantly CSV export, bulk DOCX zip, and bulk-delete.
 */
export function BulkActionBar({
  selectedIds,
  onClear,
  onDeleted,
}: {
  selectedIds: string[];
  onClear: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState<"delete" | "download" | "sequencer" | "allCsv" | null>(null);

  if (selectedIds.length === 0) return null;

  async function downloadSequencer(decisions: Array<"CONTACT" | "NURTURE" | "SKIP">, includeSkip = false) {
    setBusy(includeSkip ? "allCsv" : "sequencer");
    try {
      const res = await fetch("/api/reports/export/sequencer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportIds: selectedIds, decisions, includeSkip }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Export failed." }));
        alert(json.error || "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sequencer_${decisions.join("_")}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onBulkDownload() {
    setBusy("download");
    try {
      const res = await fetch("/api/reports/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Download failed." }));
        alert(json.error || "Download failed.");
        return;
      }
      const missing = Number(res.headers.get("X-Missing-Count") || 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prospect-reports-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (missing > 0) {
        alert(`${missing} selected report(s) don't have a DOCX yet and were skipped from the zip.`);
      }
    } catch {
      alert("Download failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onBulkDelete() {
    if (!confirm(`Delete ${selectedIds.length} selected report(s) and their files? This can't be undone.`)) return;
    setBusy("delete");
    try {
      const res = await fetch("/api/reports/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Delete failed.");
        return;
      }
      onDeleted();
      onClear();
      if (json.failed?.length) {
        alert(`${json.failed.length} report(s) could not be deleted.`);
      }
    } catch {
      alert("Delete failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{selectedIds.length} selected</span>
        <button
          type="button"
          onClick={onClear}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() => void downloadSequencer(["CONTACT"])}
        >
          {busy === "sequencer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download Instantly CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void downloadSequencer(["CONTACT", "NURTURE", "SKIP"], true)}
        >
          {busy === "allCsv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export all decisions
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void onBulkDownload()}>
          {busy === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          DOCX ZIP (optional)
        </Button>
        <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void onBulkDelete()}>
          {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Delete selected
        </Button>
      </div>
    </div>
  );
}
