/** Date formatting honouring the configured timezone and date format (browser + server safe). */
export type DateFormat = "DD-MM-YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";

function parts(d: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  if (o.hour === "24") o.hour = "00";
  return o;
}

export function formatDate(value: string | number | Date | null | undefined, timeZone = "Asia/Kolkata", fmt: DateFormat = "DD-MM-YYYY"): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const p = parts(d, timeZone);
  if (fmt === "YYYY-MM-DD") return `${p.year}-${p.month}-${p.day}`;
  if (fmt === "MM/DD/YYYY") return `${p.month}/${p.day}/${p.year}`;
  return `${p.day}-${p.month}-${p.year}`;
}

export function formatDateTime(value: string | number | Date | null | undefined, timeZone = "Asia/Kolkata", fmt: DateFormat = "DD-MM-YYYY"): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const p = parts(d, timeZone);
  return `${formatDate(d, timeZone, fmt)} ${p.hour}:${p.minute}:${p.second}`;
}

export function formatTime(value: string | number | Date, timeZone = "Asia/Kolkata"): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(d, timeZone);
  return `${p.hour}:${p.minute}:${p.second}`;
}
