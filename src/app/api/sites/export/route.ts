import { connectDB } from "@/lib/db";
import { Node, SensorReading, Site } from "@/lib/models";
import { Types } from "mongoose";
import { NextResponse } from "next/server";

const ALLOWED_INTERVALS = [5, 30, 60, 300, 600, 900, 1800, 3600, 21600];

const BASE_COLUMNS = [
  "siteCode",
  "siteName",
  "nodeId",
  "nodeName",
  "createdAt",
];

type MergedReading = {
  nodeId: number;
  nodeName: string;
  createdAt: Date;
  data: Record<string, unknown>;
};

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  );
}

function escapeCsv(value: unknown): string {
  let text =
    value == null
      ? ""
      : value instanceof Date
        ? formatDateTime(value)
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);

  // Protect spreadsheet users against formula injection.
  if (/^[\s]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function mergeReadings(
  readings: Array<{
    nodeRef: unknown;
    createdAt: Date;
    data?: unknown;
  }>,
  nodeById: Map<string, { nodeId: number; nodeName: string }>,
): MergedReading[] {
  const grouped = new Map<string, MergedReading>();

  for (const reading of readings) {
    const node = nodeById.get(String(reading.nodeRef));
    if (!node) continue;

    const createdAt = new Date(reading.createdAt);
    const second = Math.floor(createdAt.getTime() / 1000);
    const key = `${node.nodeId}:${second}`;

    let group = grouped.get(key);

    if (!group) {
      group = {
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        createdAt,
        data: {},
      };

      grouped.set(key, group);
    }

    if (
      reading.data &&
      typeof reading.data === "object" &&
      !Array.isArray(reading.data)
    ) {
      Object.assign(group.data, reading.data as Record<string, unknown>);
    }
  }

  return [...grouped.values()].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.nodeId - b.nodeId,
  );
}

/**
 * Select one nearest reading for each target interval, independently
 * for each node. A reading cannot be reused for multiple intervals.
 */
function sampleNodeReadings(
  readings: MergedReading[],
  startMs: number,
  endMs: number,
  intervalSeconds: number,
): MergedReading[] {
  const intervalMs = intervalSeconds * 1000;
  const toleranceMs = intervalMs / 2;
  const selected: MergedReading[] = [];

  let cursor = 0;

  for (let targetMs = startMs; targetMs < endMs; targetMs += intervalMs) {
    // Advance to the first reading at or after the target.
    while (
      cursor < readings.length &&
      readings[cursor].createdAt.getTime() < targetMs
    ) {
      cursor++;
    }

    const afterIndex = cursor;
    const beforeIndex = cursor - 1;

    const before = beforeIndex >= 0 ? readings[beforeIndex] : undefined;
    const after =
      afterIndex < readings.length ? readings[afterIndex] : undefined;

    const beforeDistance = before
      ? Math.abs(before.createdAt.getTime() - targetMs)
      : Infinity;

    const afterDistance = after
      ? Math.abs(after.createdAt.getTime() - targetMs)
      : Infinity;

    // Prefer the earlier reading when distances are equal.
    const useBefore = beforeDistance <= afterDistance;
    const candidate = useBefore ? before : after;
    const distance = useBefore ? beforeDistance : afterDistance;

    if (!candidate || distance > toleranceMs) {
      continue;
    }

    selected.push(candidate);

    // Do not reuse a selected reading in a later interval.
    cursor = (useBefore ? beforeIndex : afterIndex) + 1;
  }

  return selected;
}

export async function GET(request: Request) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);

    // This route uses /api/sites/export?siteId=...&from=...&to=...
    const siteId = searchParams.get("siteId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const intervalSeconds = Number(searchParams.get("interval") ?? "1800");

    if (!siteId || !Types.ObjectId.isValid(siteId)) {
      return NextResponse.json({ error: "Invalid site ID." }, { status: 400 });
    }

    if (!from || !to || !validDate(from) || !validDate(to) || from > to) {
      return NextResponse.json(
        { error: "Please provide a valid date range." },
        { status: 400 },
      );
    }

    if (!ALLOWED_INTERVALS.includes(intervalSeconds)) {
      return NextResponse.json(
        { error: "Invalid sampling interval." },
        { status: 400 },
      );
    }

    // Interpret the selected calendar dates as IST.
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(`${to}T00:00:00+05:30`);
    end.setUTCDate(end.getUTCDate() + 1);

    const startMs = start.getTime();
    const endMs = end.getTime();

    const site = await Site.findById(siteId)
      .select("_id siteCode siteName")
      .lean();

    if (!site) {
      return NextResponse.json({ error: "Site not found." }, { status: 404 });
    }

    const nodes = await Node.find({ siteId: site._id })
      .select("_id nodeId nodeName")
      .sort({ nodeId: 1 })
      .lean();

    if (nodes.length === 0) {
      const csv = BASE_COLUMNS.map(escapeCsv).join(",");

      return new Response("\uFEFF" + csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="site-${site.siteCode}-${from}-to-${to}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const nodeRefIds = nodes.map((node) => node._id);

    const nodeById = new Map(
      nodes.map((node) => [
        String(node._id),
        {
          nodeId: node.nodeId,
          nodeName: node.nodeName,
        },
      ]),
    );

    // Fetch readings for every node belonging to this site.
    const readings = await SensorReading.find({
      nodeRef: { $in: nodeRefIds },
      receivedAt: {
        $gte: start,
        $lt: end,
      },
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    // Merge multiple sensor records for the same node and second.
    const mergedReadings = mergeReadings(
      readings as Array<{
        nodeRef: unknown;
        createdAt: Date;
        data?: unknown;
      }>,
      nodeById,
    );

    // Sample independently per node.
    const readingsByNode = new Map<number, MergedReading[]>();

    for (const reading of mergedReadings) {
      const existing = readingsByNode.get(reading.nodeId) ?? [];
      existing.push(reading);
      readingsByNode.set(reading.nodeId, existing);
    }

    const sampledReadings: MergedReading[] = [];

    for (const node of nodes) {
      const nodeReadings = readingsByNode.get(node.nodeId) ?? [];

      const sampled = sampleNodeReadings(
        nodeReadings,
        startMs,
        endMs,
        intervalSeconds,
      );

      sampledReadings.push(...sampled);
    }

    sampledReadings.sort(
      (a, b) =>
        a.nodeId - b.nodeId || a.createdAt.getTime() - b.createdAt.getTime(),
    );

    // Keep columns for all sensors found in the fetched data,
    // even when a sensor has no value in a particular sampled row.
    const sensorColumns = [
      ...new Set(
        mergedReadings.flatMap((reading) => Object.keys(reading.data)),
      ),
    ].sort();

    const columns = [...BASE_COLUMNS, ...sensorColumns];

    const csvRows = sampledReadings.map((reading) => {
      const row: Record<string, unknown> = {
        siteCode: site.siteCode,
        siteName: site.siteName,
        nodeId: reading.nodeId,
        nodeName: reading.nodeName,
        createdAt: reading.createdAt,
        ...reading.data,
      };

      return columns.map((column) => escapeCsv(row[column])).join(",");
    });

    const csv = [columns.map(escapeCsv).join(","), ...csvRows].join("\r\n");

    return new Response("\uFEFF" + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="site-${site.siteCode}-${from}-to-${to}-${intervalSeconds}s.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Site CSV export error:", error);

    return NextResponse.json(
      { error: "Unable to export site readings." },
      { status: 500 },
    );
  }
}
