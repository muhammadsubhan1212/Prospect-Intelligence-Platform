"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { toLinkedinUrl } from "@/lib/linkedin-url";

/** Never renders an <a> — safe inside Next.js Link / card rows. */
export function CopyLinkedin({ url, compact }: { url?: string | null; compact?: boolean }) {
  const href = toLinkedinUrl(url);
  const [copied, setCopied] = useState(false);
  if (!href) return <span className="text-muted-foreground">—</span>;
  const label = href.replace(/^https?:\/\/(www\.)?/i, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      window.prompt("Copy LinkedIn URL", href);
    }
  }

  function openLinkedin(e: MouseEvent | KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div className={`flex min-w-0 items-center gap-1 ${compact ? "" : ""}`}>
      <span
        role="link"
        tabIndex={0}
        className="max-w-[160px] cursor-pointer truncate text-accent hover:underline"
        title={href}
        onClick={openLinkedin}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") openLinkedin(e);
        }}
      >
        {label}
      </span>
      <button
        type="button"
        className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void copy();
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
