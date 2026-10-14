const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "1h 05m", "42m", "30s" */
export function dur(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "–";
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m`;
  return `${sec}s`;
}

/** "1:05:09" */
export function hms(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "–:––:––";
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "16:42" today, "Thu 09:40" on another day. */
export function clock(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "–";
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? hm : `${DAY[d.getDay()]} ${hm}`;
}

export function dayName(d: Date): string {
  return DAY[d.getDay()];
}

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${DAY[d.getDay()]} ${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`;
}
