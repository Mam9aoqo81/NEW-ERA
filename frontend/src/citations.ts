import type { Citation } from "./api";
export function formatTime(value: number) {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60),
    seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
export function isTimed(c: Citation) {
  return (
    c.locator_type === "timestamp" &&
    typeof c.start_seconds === "number" &&
    Number.isFinite(c.start_seconds)
  );
}
export function citationLabel(c: Citation) {
  return isTimed(c)
    ? `${formatTime(c.start_seconds!)} – ${formatTime(c.end_seconds ?? c.start_seconds!)}`
    : `ص ${c.page}`;
}
export function safeVideoLink(url: string | null | undefined) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.host !== "www.youtube.com" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/watch"
    )
      return undefined;
    const id = parsed.searchParams.get("v"),
      time = parsed.searchParams.get("t");
    if (
      !id ||
      !/^[-_a-zA-Z0-9]{11}$/.test(id) ||
      !time ||
      !/^\d+s$/.test(time) ||
      parseInt(time) > 86400
    )
      return undefined;
    return `https://www.youtube.com/watch?v=${id}&t=${parseInt(time)}s`;
  } catch {
    return undefined;
  }
}
