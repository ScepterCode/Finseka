import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { TableHead } from "@/components/ui/table";

/** A table column heading that sorts by its column when clicked, and shows which way. */
export function SortHead<C extends string>({
  label,
  col,
  sort,
  dir,
  onSort,
  className,
  right,
}: {
  label: string;
  col: C;
  sort: C;
  dir: "asc" | "desc";
  onSort: (col: C) => void;
  className?: string;
  right?: boolean;
}) {
  const active = sort === col;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(right && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          "inline-flex items-center gap-1 font-medium hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className="size-3.5" />
      </button>
    </TableHead>
  );
}
