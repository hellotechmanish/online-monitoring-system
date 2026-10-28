import { connectDB } from "@/lib/db";
import { NextResponse } from "next/server";
import { SensorReading } from "@/lib/models";

// this is the API route for exporting sensor readings of a specific node as a CSV file, filtered by a date range provided in the query parameters. It validates the node ID and date range, fetches the relevant sensor readings from the database, merges readings with the same timestamp, dynamically discovers sensor columns, and formats the data into a CSV format for download.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await connectDB();

    const { id } = await params;
    const { searchParams } = new URL(request.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // Validate node ID.
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Invalid node ID." }, { status: 400 });
    }

    // Validate YYYY-MM-DD calendar dates.
    const validDate = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

    if (!from || !to || !validDate(from) || !validDate(to) || from > to) {
      return NextResponse.json(
        { error: "Please provide a valid date range." },
        { status: 400 },
      );
    }

    // Interpret selected dates in India Standard Time.
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(`${to}T00:00:00+05:30`);
    end.setUTCDate(end.getUTCDate() + 1);

    // Fetch the selected node's readings within the date range.
    const readings = await SensorReading.find({
      nodeId: Number(id),
      receivedAt: {
        $gte: start,
        $lt: end,
      },
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    // Merge records belonging to the same node and createdAt second.
    const grouped = new Map<
      string,
      {
        nodeId: number;
        createdAt: Date;
        data: Record<string, unknown>;
      }
    >();

    for (const reading of readings) {
      const createdAt = new Date(reading.createdAt);
      const second = Math.floor(createdAt.getTime() / 1000);
      const key = `${reading.nodeId}:${second}`;

      let group = grouped.get(key);

      if (!group) {
        group = {
          nodeId: reading.nodeId,
          createdAt,
          data: {},
        };

        grouped.set(key, group);
      }

      // Merge sensor parameters from every matching document.
      Object.assign(
        group.data,
        (reading.data ?? {}) as Record<string, unknown>,
      );
    }

    const mergedReadings = [...grouped.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    // Discover all sensor columns dynamically.
    const sensorColumns = [
      ...new Set(
        mergedReadings.flatMap((reading) => Object.keys(reading.data)),
      ),
    ].sort();

    const columns = ["nodeId", "createdAt", ...sensorColumns];

    // Format timestamps in IST.
    const formatDateTime = (value: Date): string => {
      return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      }).format(value);
    };

    // Escape CSV cells and guard against spreadsheet formula injection.
    const escapeCsv = (value: unknown): string => {
      let text =
        value == null
          ? ""
          : value instanceof Date
            ? formatDateTime(value)
            : String(value);

      if (/^[\s]*[=+\-@]/.test(text)) {
        text = `'${text}`;
      }

      return `"${text.replace(/"/g, '""')}"`;
    };

    const csvRows = mergedReadings.map((reading) => {
      const row: Record<string, unknown> = {
        nodeId: reading.nodeId,
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
        "Content-Disposition": `attachment; filename="node-${id}-${from}-to-${to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Sensor CSV export error:", error);

    return NextResponse.json(
      { error: "Unable to export sensor readings." },
      { status: 500 },
    );
  }
}
