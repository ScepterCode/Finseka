import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { financialYearOf, monthNames } from "@/lib/financial-year";
import { shortDate } from "@/lib/format";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Settings: the month the financial year starts, and the years already closed. */
export function FinancialYearSettings() {
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const info = useQuery({
    queryKey: ["fiscal-settings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [org, closed] = await Promise.all([
        supabase.from("organizations").select("fiscal_year_start_month").eq("id", orgId!).single(),
        supabase
          .from("fiscal_years")
          .select("starts_on, ends_on, closed_at")
          .order("starts_on", { ascending: false }),
      ]);
      if (org.error) throw org.error;
      if (closed.error) throw closed.error;
      return { startMonth: org.data.fiscal_year_start_month, closed: closed.data };
    },
  });

  const save = useMutation({
    mutationFn: async (month: number) => {
      const { error } = await supabase
        .from("organizations")
        .update({ fiscal_year_start_month: month })
        .eq("id", orgId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Financial year updated");
      for (const key of ["fiscal-settings", "fiscal-start-month", "financial-year"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const startMonth = info.data?.startMonth ?? 1;
  const locked = (info.data?.closed.length ?? 0) > 0;
  const current = financialYearOf(new Date(), startMonth);

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
      <h2 className="font-display text-lg font-semibold">Financial year</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        The year your accounts run for, usually from one AGM to the next. The year-end statement and
        closing a year are in Reports → Year-end.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div className="w-56">
          <Label className="mb-1.5 block">Starts in</Label>
          <Select
            value={String(startMonth)}
            disabled={!isAdmin || locked || save.isPending}
            onValueChange={(v) => save.mutate(Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthNames.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          This year: <span className="font-medium text-foreground">{current.label}</span> (
          {shortDate(current.startsOn)} to {shortDate(current.endsOn)})
        </p>
      </div>
      {locked && (
        <p className="mt-3 text-sm text-muted-foreground">
          The start month is fixed because a year has been closed. Closed:{" "}
          {info
            .data!.closed.map((y) => `${shortDate(y.starts_on)} – ${shortDate(y.ends_on)}`)
            .join("; ")}
          .
        </p>
      )}
    </section>
  );
}
