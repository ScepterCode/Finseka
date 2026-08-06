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

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
