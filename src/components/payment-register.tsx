import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { naira } from "@/lib/format";
import type { PayStatus, RegisterSort, SortDir } from "@/lib/register";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PayStatusBadge({ status, overdue }: { status: PayStatus; overdue: boolean }) {
  if (status === "paid" || status === "gave")
    return (
      <Badge className="bg-success/15 text-success hover:bg-success/15">
        {status === "gave" ? "Gave" : "Paid"}
      </Badge>
    );
  if (status === "part")
    return <Badge className="bg-accent/15 text-accent hover:bg-accent/15">Part paid</Badge>;
  return (
    <Badge variant="secondary" className={overdue ? "text-destructive" : "text-muted-foreground"}>
      {overdue ? "Overdue" : "Not paid"}
    </Badge>
  );
}

/** What someone still owes in red, or a dash once they are paid up. */
export function OwingAmount({ value }: { value: number }) {
  return value > 0 ? (
    <span className="whitespace-nowrap font-semibold tabular-nums text-destructive">
      {naira(value)}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

/** On a phone the table's column headings are gone, so sorting is a menu instead. */
export function RegisterSortSelect({
  sort,
  dir,
  onChange,
  showOwing = true,
}: {
  sort: RegisterSort;
  dir: SortDir;
  onChange: (sort: RegisterSort, dir: SortDir) => void;
  showOwing?: boolean;
}) {
  return (
    <div className="w-40">
      <Select
        value={`${sort}:${dir}`}
        onValueChange={(v) => {
          const [s, d] = v.split(":") as [RegisterSort, SortDir];
          onChange(s, d);
        }}
      >
        <SelectTrigger aria-label="Sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="status:asc">Not paid first</SelectItem>
          <SelectItem value="name:asc">Name A–Z</SelectItem>
          {showOwing && <SelectItem value="owing:desc">Owes most</SelectItem>}
          <SelectItem value="paid:desc">Paid most</SelectItem>
          <SelectItem value="date:desc">Paid most recently</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export type RegisterListRow = {
  id: string;
  name: string;
  phone: string | null;
  status: PayStatus;
  paid: number;
  owing: number;
};

/** The register as a compact list for phones: who, their status and amount, and any buttons. */
export function RegisterList<T extends RegisterListRow>({
  rows,
  overdue,
  actions,
}: {
  rows: T[];
  overdue: boolean;
  actions?: (row: T) => ReactNode;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      {rows.map((r) => {
        const buttons = actions?.(r);
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <span className="min-w-0 flex-1">
              <Link
                to="/members/$memberId"
                params={{ memberId: r.id }}
                className="link block truncate font-medium"
              >
                {r.name}
              </Link>
              <span className="block truncate text-xs text-muted-foreground">
                {r.phone || "No phone"}
              </span>
            </span>
            <span className="flex flex-col items-end gap-1 text-right">
              <PayStatusBadge status={r.status} overdue={overdue} />
              <span className="text-xs tabular-nums">
                {r.owing > 0 ? (
                  <span className="font-semibold text-destructive">Owes {naira(r.owing)}</span>
                ) : (
                  r.paid > 0 && <span className="text-muted-foreground">{naira(r.paid)} paid</span>
                )}
              </span>
            </span>
            {buttons && <span className="flex w-full justify-end gap-2">{buttons}</span>}
          </li>
        );
      })}
    </ul>
  );
}
