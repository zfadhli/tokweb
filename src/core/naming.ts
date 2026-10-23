/** Output naming shared by recorder and disk reconciliation. */

const pad = (n: number): string => String(n).padStart(2, "0");

/** `20260707_140509` in local time, matching upstream's human-sortable names. */
export function stamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function safeName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "stream";
}

export function fileBase(
  uniqueId: string,
  roomId: string | null,
  startedAt: number,
): string {
  return `${safeName(uniqueId)}_${stamp(new Date(startedAt))}`;
}

/** Best-effort parse of a file name this app produced. */
export function parseFileName(name: string): {
  uniqueId: string;
  roomId: string | null;
  startedAt: number | null;
} | null {
  const base = name.replace(/\.(flv|mp4|m4a|ts)$/i, "");
  const current = base.match(
    /^(.+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/,
  );
  if (current) {
    const [, user, yyyy, mo, dd, hh, mm, ss] = current;
    if (!user) return null;
    const started = new Date(
      Number(yyyy),
      Number(mo) - 1,
      Number(dd),
      Number(hh),
      Number(mm),
      Number(ss),
    );
    return {
      uniqueId: user,
      roomId: null,
      startedAt: Number.isNaN(started.getTime()) ? null : started.getTime(),
    };
  }
  // Legacy names from before the room id and date dashes were dropped.
  const match = base.match(
    /^(.+)_([^_]+)_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/,
  );
  if (!match) return null;
  const [, user, room, day, hh, mm, ss] = match;
  if (!user || !day || !hh || !mm || !ss) return null;
  const started = new Date(`${day}T${hh}:${mm}:${ss}`);
  return {
    uniqueId: user,
    roomId: room && room !== "room" ? room : null,
    startedAt: Number.isNaN(started.getTime()) ? null : started.getTime(),
  };
}
