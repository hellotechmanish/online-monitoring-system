"use client";

import {
  classifyValue,
  colorForSensor,
  resolveThresholds,
  type ThresholdStatus,
} from "@/lib/protocol/sensors";
import type { LatestValue } from "@/lib/live-series";
import type { SensorConfigDTO } from "@/lib/types";
import { Badge } from "@/components/ui/misc";

const STATUS: Record<
  ThresholdStatus,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  normal: { label: "Normal", tone: "success" },
  low: { label: "Below threshold", tone: "warning" },
  high: { label: "Above threshold", tone: "danger" },
  unconfigured: { label: "No threshold", tone: "neutral" },
};

/**
 * Latest value per selected sensor with two separate signals:
 *  - threshold status computed from the Node's configured thresholds (or "No threshold")
 *  - the device-reported `alarm` value from the message, shown as-is
 */
export function LatestValues({
  sensors,
  latest,
  config,
  formatDateTime,
}: {
  sensors: string[];
  latest: Record<string, LatestValue>;
  config: SensorConfigDTO[];
  formatDateTime: (v: string) => string;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
      {sensors.map((s) => {
        const lv = latest[s];
        const thr = resolveThresholds(s, config);
        const status = lv ? classifyValue(lv.value, thr) : null;

        return (
          <div
            key={s}
            className="min-w-0 rounded border border-border bg-surface p-1.5"
            style={{ borderLeft: `2px solid ${colorForSensor(s)}` }}
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
              <span className="truncate font-mono text-[10px] font-semibold">
                {s}
              </span>

              {status && (
                <span
                  className={`rounded px-1 py-0.5 text-[9px] leading-tight ${
                    STATUS[status].tone === "danger"
                      ? "bg-danger/10 text-danger"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {STATUS[status].label}
                </span>
              )}
            </div>

            <p className="tabular mt-1 break-words text-base font-semibold leading-tight">
              {lv ? (
                lv.value
              ) : (
                <span className="text-[10px] font-normal text-subtle">
                  No reading
                </span>
              )}
            </p>

            <div className="mt-1 space-y-1 text-[9px] leading-tight text-subtle">
              <p className="break-words">
                {lv ? formatDateTime(lv.timestamp) : "—"}
              </p>

              <p className="break-words">
                Thr: {thr ? `${thr.low ?? "—"}–${thr.high ?? "—"}` : "Not set"}
              </p>

              <p>
                Alarm:{" "}
                {lv && lv.alarm !== null ? (
                  <span
                    className={
                      lv.alarm ? "font-semibold text-danger" : "text-foreground"
                    }
                  >
                    {lv.alarm}
                  </span>
                ) : (
                  "—"
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
