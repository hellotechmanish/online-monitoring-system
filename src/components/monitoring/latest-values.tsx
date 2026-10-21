"use client";

import { classifyValue, colorForSensor, resolveThresholds, type ThresholdStatus } from "@/lib/protocol/sensors";
import type { LatestValue } from "@/lib/live-series";
import type { SensorConfigDTO } from "@/lib/types";
import { Badge } from "@/components/ui/misc";

const STATUS: Record<ThresholdStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {sensors.map((s) => {
        const lv = latest[s];
        const thr = resolveThresholds(s, config);
        const status = lv ? classifyValue(lv.value, thr) : null;
        return (
          <div key={s} className="rounded-lg border border-border bg-surface p-3" style={{ borderLeft: `4px solid ${colorForSensor(s)}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold">{s}</span>
              {status && <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>}
            </div>
            <p className="tabular mt-1 text-2xl font-semibold">{lv ? lv.value : <span className="text-base font-normal text-subtle">No reading yet</span>}</p>
            <div className="mt-1 space-y-0.5 text-xs text-subtle">
              <p>{lv ? formatDateTime(lv.timestamp) : "—"}</p>
              <p>
                Thresholds: {thr ? `${thr.low ?? "—"} … ${thr.high ?? "—"}` : "not configured"}
              </p>
              <p>
                Device alarm:{" "}
                {lv && lv.alarm !== null ? (
                  <span className={lv.alarm ? "font-semibold text-danger" : "text-foreground"}>{lv.alarm}</span>
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
