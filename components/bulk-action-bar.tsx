"use client";

import { useState } from "react";
import { Download, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";

/**
 * Sticky action bar shown whenever one or more reports are selected via
 * checkbox. Handles the bulk-download-as-zip and bulk-delete API calls
 * itself; the parent list just needs to pass the selected ids and refresh
 * on `onDeleted`.
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
  const [busy, setBusy] = useState<"delete" | "download" | null>(null);

  if (selectedIds.length === 0) return null;

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
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void onBulkDownload()}>
          {busy === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download ZIP
        </Button>
        <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void onBulkDelete()}>
          {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Delete selected
        </Button>
      </div>
    </div>
  );
}
