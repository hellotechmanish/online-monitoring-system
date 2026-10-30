"use client";

import { useState } from "react";
import { Download, X, CalendarDays, Clock3 } from "lucide-react";

interface SiteDownloadButtonProps {
  siteId: string;
  siteName?: string;
  disabled?: boolean;
}

const INTERVALS = [
  { label: "Every 5 seconds", value: "5" },
  { label: "Every 30 seconds", value: "30" },
  { label: "Every 1 minute", value: "60" },
  { label: "Every 5 minutes", value: "300" },
  { label: "Every 10 minutes", value: "600" },
  { label: "Every 15 minutes", value: "900" },
  { label: "Every 30 minutes", value: "1800" },
  { label: "Every 1 hour", value: "3600" },
  { label: "Every 6 hours", value: "21600" },
];

export default function SiteDownloadButton({
  siteId,
  siteName,
  disabled = false,
}: SiteDownloadButtonProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [interval, setInterval] = useState("1800");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Local date in YYYY-MM-DD format.
  const today = [
    new Date().getFullYear(),
    String(new Date().getMonth() + 1).padStart(2, "0"),
    String(new Date().getDate()).padStart(2, "0"),
  ].join("-");

  async function handleDownload() {
    if (!from || !to || from > to || to > today) {
      setError("Please select a valid date range.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        from,
        to,
        siteId,
        interval,
      });

      const response = await fetch(`/api/sites/export?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "CSV download failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `site-${siteName}-${from}-to-${to}-${interval}s.csv`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV download failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || !siteId}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        Download Site CSV
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) {
              setOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="site-export-title"
            className="w-full max-w-sm rounded-lg border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="rounded-md border border-primary/20 bg-primary/10 p-2 text-primary">
                  <Download className="h-4 w-4" />
                </div>

                <div>
                  <h2 id="site-export-title" className="text-sm font-semibold">
                    Export Site Data
                  </h2>

                  <p className="text-xs text-muted-foreground">
                    {siteName || `Site ${siteId}`} · All nodes
                  </p>
                </div>
              </div>

              <button
                type="button"
                aria-label="Close"
                disabled={loading}
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <div className="space-y-4 p-4">
              {/* Date range */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Date range
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <label
                      htmlFor="site-export-from"
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      From date
                    </label>

                    <input
                      id="site-export-from"
                      type="date"
                      value={from}
                      max={to || today}
                      disabled={loading}
                      onChange={(e) => setFrom(e.target.value)}
                      className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  <div className="min-w-0">
                    <label
                      htmlFor="site-export-to"
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      To date
                    </label>

                    <input
                      id="site-export-to"
                      type="date"
                      value={to}
                      min={from || undefined}
                      max={today}
                      disabled={loading}
                      onChange={(e) => setTo(e.target.value)}
                      className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Sampling interval */}
              <div>
                <label
                  htmlFor="site-export-interval"
                  className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  <Clock3 className="h-3.5 w-3.5" />
                  Sampling interval
                </label>

                <select
                  id="site-export-interval"
                  value={interval}
                  disabled={loading}
                  onChange={(e) => setInterval(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                >
                  {INTERVALS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  One reading per node near each selected interval. Nearby
                  readings may be used when an exact match is unavailable.
                </p>
              </div>

              {error && (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setOpen(false)}
                  className="h-8 rounded-md border border-border px-3 text-xs hover:bg-accent disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={loading || !from || !to}
                  onClick={handleDownload}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    "Preparing CSV..."
                  ) : (
                    <>
                      <CalendarDays className="h-3.5 w-3.5" />
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
