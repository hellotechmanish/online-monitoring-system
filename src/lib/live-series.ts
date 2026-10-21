/**
 * Pure state for the live monitoring chart (browser-side, unit-tested).
 *
 * - One bounded series per selected sensor ID (at most `maxPoints` values each).
 * - History (from MongoDB) initialises the series; WebSocket events that arrive
 *   while history is still loading are buffered and replayed afterwards, so a
 *   late history response can never overwrite newer live data.
 * - Events for another Node, or for unselected sensors, are ignored.
 * - A sensor absent from a message gets no new point (no fabricated values).
 */
import type { HistoryPoint } from "./types";

export interface SeriesPoint {
  t: number;
  v: number;
}

export interface LiveEvent {
  nodeId: number;
  timestamp: string;
  values: Record<string, number>;
  alarm?: number | null;
}

export interface LatestValue {
  value: number;
  timestamp: string;
  alarm: number | null;
}

export interface SeriesState {
  nodeId: number | null;
  sensors: string[];
  maxPoints: number;
  series: Record<string, SeriesPoint[]>;
  latest: Record<string, LatestValue>;
  historyLoaded: boolean;
  buffer: LiveEvent[];
}

const MAX_BUFFER = 1000;

export function createSeriesState(nodeId: number | null, sensors: string[], maxPoints: number): SeriesState {
  const series: Record<string, SeriesPoint[]> = {};
  for (const s of sensors) series[s] = [];
  return { nodeId, sensors: [...sensors], maxPoints: Math.max(1, maxPoints), series, latest: {}, historyLoaded: false, buffer: [] };
}

function pushPoint(arr: SeriesPoint[], p: SeriesPoint, max: number): SeriesPoint[] {
  const last = arr[arr.length - 1];
  let next: SeriesPoint[];
  if (!last || p.t > last.t) next = [...arr, p];
  else if (p.t === last.t) next = [...arr.slice(0, -1), p];
  else {
    // Out-of-order point: insert in time order unless it duplicates an existing timestamp.
    if (arr.some((x) => x.t === p.t)) return arr;
    next = [...arr, p].sort((a, b) => a.t - b.t);
  }
  return next.length > max ? next.slice(next.length - max) : next;
}

function applyEventInner(state: SeriesState, ev: LiveEvent): SeriesState {
  const t = Date.parse(ev.timestamp);
  if (!Number.isFinite(t)) return state;
  let series = state.series;
  let latest = state.latest;
  let changed = false;
  for (const s of state.sensors) {
    const v = ev.values[s];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (!changed) {
      series = { ...series };
      latest = { ...latest };
      changed = true;
    }
    series[s] = pushPoint(series[s] ?? [], { t, v }, state.maxPoints);
    const prev = latest[s];
    if (!prev || Date.parse(prev.timestamp) <= t) latest[s] = { value: v, timestamp: ev.timestamp, alarm: ev.alarm ?? null };
  }
  return changed ? { ...state, series, latest } : state;
}

/** Applies a live event; buffers it while history is loading. */
export function applyEvent(state: SeriesState, ev: LiveEvent): SeriesState {
  if (state.nodeId === null || ev.nodeId !== state.nodeId) return state;
  if (!state.sensors.some((s) => typeof ev.values[s] === "number")) return state;
  if (!state.historyLoaded) {
    const buffer = state.buffer.length >= MAX_BUFFER ? [...state.buffer.slice(1), ev] : [...state.buffer, ev];
    return { ...state, buffer };
  }
  return applyEventInner(state, ev);
}

/** Initialises series from persisted history, then replays buffered live events. */
export function applyHistory(state: SeriesState, points: HistoryPoint[]): SeriesState {
  const series: Record<string, SeriesPoint[]> = {};
  const latest: Record<string, LatestValue> = { ...state.latest };
  for (const s of state.sensors) series[s] = [];
  const sorted = [...points].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (const p of sorted) {
    const t = Date.parse(p.timestamp);
    if (!Number.isFinite(t)) continue;
    for (const s of state.sensors) {
      const v = p.values[s];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      series[s] = pushPoint(series[s], { t, v }, state.maxPoints);
      const prev = latest[s];
      if (!prev || Date.parse(prev.timestamp) <= t) latest[s] = { value: v, timestamp: p.timestamp, alarm: p.alarm ?? null };
    }
  }
  let next: SeriesState = { ...state, series, latest, historyLoaded: true, buffer: [] };
  for (const ev of state.buffer) next = applyEventInner(next, ev);
  return next;
}

/** Seeds "latest values" from the server cache sent with the subscription ack (does not add chart points). */
export function applyLatestSnapshot(state: SeriesState, snapshot: Record<string, LatestValue>): SeriesState {
  const latest = { ...state.latest };
  let changed = false;
  for (const [s, lv] of Object.entries(snapshot)) {
    if (!state.sensors.includes(s)) continue;
    const prev = latest[s];
    if (!prev || Date.parse(prev.timestamp) < Date.parse(lv.timestamp)) {
      latest[s] = lv;
      changed = true;
    }
  }
  return changed ? { ...state, latest } : state;
}

export type ChartRow = { t: number } & Record<string, number | null>;

/** Rows for Recharts: union of timestamps; a sensor without a value at a timestamp is null (never 0). */
export function toChartRows(state: SeriesState): ChartRow[] {
  const byT = new Map<number, ChartRow>();
  for (const s of state.sensors) {
    for (const p of state.series[s] ?? []) {
      let row = byT.get(p.t);
      if (!row) {
        row = { t: p.t } as ChartRow;
        for (const x of state.sensors) row[x] = null;
        byT.set(p.t, row);
      }
      row[s] = p.v;
    }
  }
  return Array.from(byT.values()).sort((a, b) => a.t - b.t);
}

export function pointCount(state: SeriesState): number {
  return state.sensors.reduce((n, s) => n + (state.series[s]?.length ?? 0), 0);
}
