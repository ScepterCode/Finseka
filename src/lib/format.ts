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

/**
 * What someone typed into a money box, reduced to a plain number string ("1,250.5" → "1250.5").
 * Keeps digits and the first decimal point, at most two decimal places, and drops leading zeros.
 */
export function cleanAmount(typed: string) {
  const kept = typed.replace(/[^\d.]/g, "");
  const dot = kept.indexOf(".");
  let whole = dot === -1 ? kept : kept.slice(0, dot);
  whole = whole.replace(/^0+(?=\d)/, "");
  if (dot === -1) return whole;
  const cents = kept
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return `${whole || "0"}.${cents}`;
}

/** A plain number string with thousands commas for display ("1250.5" → "1,250.5"). */
export function groupAmount(raw: string) {
  const [whole, cents] = raw.split(".");
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents === undefined ? grouped : `${grouped}.${cents}`;
}
