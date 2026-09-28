import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { naira, shortDate } from "@/lib/format";
import { recentFinancialYears } from "@/lib/financial-year";
import { ConfirmDialog } from "@/components/confirm";
import { StatCard } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Summary = {
  starts_on: string;
  ends_on: string;
  label: string;
  has_ended: boolean;
  closed: boolean;
  closed_at: string | null;
  notes: string | null;
  opening_cash: number;
  opening_bank: number;
  income: number;
  expense: number;
  closing_cash: number;
  closing_bank: number;
  owed: number;
  by_label: { label: string; income: number; expense: number }[];
};

/** The year-end statement for the AGM, and closing a year that has ended. */
export function YearEndReport() {
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const startMonth = useQuery({
    queryKey: ["fiscal-start-month", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("fiscal_year_start_month")
        .eq("id", orgId!)
        .single();
      if (error) throw error;
      return data.fiscal_year_start_month;
    },
  });
  const years = recentFinancialYears(new Date(), startMonth.data ?? 1);
  const [picked, setPicked] = useState<string | null>(null);
  const yearStart = picked ?? years[0]!.startsOn;

  const summary = useQuery({
    queryKey: ["financial-year", orgId, yearStart],
    enabled: !!orgId && startMonth.isSuccess,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("financial_year_summary", {
        _any_date: yearStart,
      });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes] = useState("");
  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_financial_year", {
        _any_date: yearStart,
        ...(notes.trim() ? { _notes: notes.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("The year is closed and its figures are saved");
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["financial-year"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const s = summary.data;
  const opening = s ? Number(s.opening_cash) + Number(s.opening_bank) : 0;
  const closing = s ? Number(s.closing_cash) + Number(s.closing_bank) : 0;

  return (
    <div className="space-y-6">
      <div className="print-hide flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Label className="mb-1.5 block text-xs">Financial year</Label>
          <Select value={yearStart} onValueChange={setPicked}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y.startsOn} value={y.startsOn}>
                  {y.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {s?.closed ? (
          <Badge variant="secondary" className="gap-1 py-1.5">
            <Lock className="size-3" /> Closed {s.closed_at ? shortDate(s.closed_at) : ""}
          </Badge>
        ) : s && !s.has_ended ? (
          <Badge variant="outline" className="py-1.5">
            Still running until {shortDate(s.ends_on)}
          </Badge>
        ) : null}
        {isAdmin && s && s.has_ended && !s.closed && (
          <Button variant="outline" className="gap-2" onClick={() => setConfirming(true)}>
            <Lock className="size-4" /> Close this year
          </Button>
        )}
      </div>

      {!s ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {s.label}: {shortDate(s.starts_on)} to {shortDate(s.ends_on)}
            {s.closed && " · figures saved when the year was closed"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Money at the start"
              value={naira(opening)}
              hint={`Cash ${naira(s.opening_cash)} · Bank ${naira(s.opening_bank)}`}
            />
            <StatCard label="Money in" value={naira(s.income)} tone="good" />
            <StatCard label="Money out" value={naira(s.expense)} tone="bad" />
            <StatCard
              label="Money at the end"
              value={naira(closing)}
              tone="accent"
              hint={`Cash ${naira(s.closing_cash)} · Bank ${naira(s.closing_bank)}`}
            />
          </div>

          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">What</th>
                  <th className="px-5 py-3 text-right">In</th>
                  <th className="px-5 py-3 text-right">Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {s.by_label.map((r) => (
                  <tr key={r.label}>
                    <td className="px-5 py-3 font-medium">{r.label}</td>
                    <td className="px-5 py-3 text-right text-success">
                      {Number(r.income) ? naira(r.income) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-destructive">
                      {Number(r.expense) ? naira(r.expense) : "—"}
                    </td>
                  </tr>
                ))}
                {s.by_label.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center text-muted-foreground">
                      Nothing recorded in this year.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-sm">
            <span className="font-medium">
              Members owing {s.closed ? "when it closed" : "now"}:
            </span>{" "}
            <span className="font-semibold text-destructive">{naira(s.owed)}</span>
            {s.notes && <span className="mt-1 block text-muted-foreground">Note: {s.notes}</span>}
          </p>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Close ${s?.label ?? "this year"}?`}
        description="Its figures are saved as they are now, and nothing dated inside the year can be added or changed afterwards. Corrections will go into the current year. This cannot be undone."
        confirmLabel="Yes, close the year"
        onConfirm={() => close.mutate()}
      >
        <div className="space-y-2">
          <Label htmlFor="fy-notes">Note (optional), e.g. “Approved at the AGM on 10 Jan”</Label>
          <Textarea id="fy-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </ConfirmDialog>
    </div>
  );
}
