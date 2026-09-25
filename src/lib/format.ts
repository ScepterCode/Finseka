export function naira(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

export function shortDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** yyyy-mm-dd in the user's own time zone (toISOString would give the UTC date). */
export function localIso(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function todayIso() {
  return localIso(new Date());
}
