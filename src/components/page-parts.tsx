import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{hint}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad" | "accent";
}) {
  const toneClass = {
    default: "text-primary",
    good: "text-success",
    bad: "text-destructive",
    accent: "text-accent",
  }[tone];

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 font-display text-2xl font-semibold sm:text-3xl ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
