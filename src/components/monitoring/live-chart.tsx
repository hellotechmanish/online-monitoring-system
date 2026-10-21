"use client";

import { memo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartRow } from "@/lib/live-series";
import { colorForSensor } from "@/lib/protocol/sensors";

/**
 * One independent line per selected sensor ID. Rows hold `null` where a sensor
 * had no reading at that timestamp (never 0); `connectNulls` draws each series
 * through its own points. Animation is off so rapid updates don't re-animate/remount.
 */
export const LiveChart = memo(function LiveChart({
  rows,
  sensors,
  formatTime,
  formatDateTime,
}: {
  rows: ChartRow[];
  sensors: string[];
  formatTime: (t: number) => string;
  formatDateTime: (t: number) => string;
}) {
  return (
    <div className="h-[340px] w-full sm:h-[400px]" role="img" aria-label={`Line chart of ${sensors.join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatTime}
            tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }}
            stroke="rgb(var(--border))"
            minTickGap={30}
            allowDuplicatedCategory={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }}
            stroke="rgb(var(--border))"
            width={56}
            domain={["auto", "auto"]}
            allowDecimals
          />
          <Tooltip
            labelFormatter={(t) => formatDateTime(Number(t))}
            formatter={(value: number, name: string) => [value, name]}
            contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--border))", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "rgb(var(--foreground))", fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {sensors.map((s) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              name={s}
              stroke={colorForSensor(s)}
              strokeWidth={2}
              dot={{ r: 2.5 }}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
