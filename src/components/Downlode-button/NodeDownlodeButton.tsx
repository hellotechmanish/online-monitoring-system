"use client";

import { useState } from "react";
import { Download, X, CalendarDays } from "lucide-react";

interface DownloadButtonProps {
  nodeId: string | number;
}

export default function DownloadButton({ nodeId }: DownloadButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const today = new Date().toLocaleDateString("en-CA");

  const handleDownload = async () => {
    if (!fromDate || !toDate) {
      setError("Please select both dates.");
      return;
    }

    if (fromDate > toDate || toDate > today) {
      setError("Please select a valid date range.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
      });
      console.log("params", params);

      const response = await fetch(
        `/api/nodes/${encodeURIComponent(String(nodeId))}/export?${params}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      console.log("response", response);

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "CSV download failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `node-${nodeId}-${fromDate}-to-${toDate}.csv`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setIsOpen(true);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
      >
        <Download className="h-3.5 w-3.5" />
        Download CSV
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !loading) {
              setIsOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="download-title"
            className="w-full max-w-sm overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                  <Download className="h-4 w-4" />
                </div>

                <div>
                  <h2 id="download-title" className="text-sm font-semibold">
                    Export Node {nodeId}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Download sensor history as CSV
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                disabled={loading}
                aria-label="Close dialog"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label
                    htmlFor="download-from"
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
                  >
                    From date
                  </label>
                  <input
                    id="download-from"
                    type="date"
                    value={fromDate}
                    max={toDate || today}
                    onChange={(e) => setFromDate(e.target.value)}
                    required
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="download-to"
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
                  >
                    To date
                  </label>
                  <input
                    id="download-to"
                    type="date"
                    value={toDate}
                    min={fromDate || undefined}
                    max={today}
                    onChange={(e) => setToDate(e.target.value)}
                    required
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger"
                >
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={loading}
                  className="h-8 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={loading || !fromDate || !toDate}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <span>Preparing...</span>
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
