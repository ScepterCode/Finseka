import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { naira, todayIso } from "@/lib/format";
import { matchesPerson } from "@/lib/search";
import { OWED_QUERY_KEYS } from "@/lib/brought-forward";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { MoneyInput } from "@/components/money-input";
import { SearchBox } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/members/brought-forward")({
  head: () => ({
    meta: [{ title: "Owed from before — FinSeka" }, { name: "robots", content: "noindex" }],
  }),
  component: BroughtForwardPage,
});

// Onboarding: what each member owed in the old book, entered for the whole list at once.
// One label per round (for example "Old dues", then "Building levy").
function BroughtForwardPage() {
  const { orgId, org, isAdmin, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [label, setLabel] = useState("Old dues");
  const [asOf, setAsOf] = useState(todayIso());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  const members = useQuery({
    queryKey: ["members", orgId, "active"],
    enabled: !!orgId,
    queryFn: () =>
      fetchAll((from, to) =>
        supabase
          .from("members")
          .select("id, name, phone")
          .eq("active", true)
          .order("name")
          .order("id")
          .range(from, to),
      ),
  });

  // What each member already has brought forward, so nothing is entered twice.
  const existing = useQuery({
    queryKey: ["brought-forward-overview", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const rows = await fetchAll((from, to) =>
        supabase
          .from("brought_forward_status")
          .select("id, member_id, label, outstanding")
          .is("cancelled_at", null)
          .order("id")
          .range(from, to),
      );
      const byMember = new Map<string, { owing: number; labels: string[] }>();
      for (const r of rows) {
        const m = byMember.get(r.member_id) ?? { owing: 0, labels: [] };
        m.owing += Number(r.outstanding);
        m.labels.push(r.label);
        byMember.set(r.member_id, m);
      }
      return byMember;
    },
  });

  const entered = useMemo(
    () =>
      Object.entries(amounts)
        .map(([memberId, v]) => ({ memberId, amount: Number(v) }))
        .filter((r) => r.amount > 0),
    [amounts],
  );
  const total = entered.reduce((s, r) => s + r.amount, 0);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("brought_forward_debts").insert(
        entered.map((r) => ({
          org_id: orgId!,
          member_id: r.memberId,
          label: label.trim(),
          amount: r.amount,
          as_of: asOf,
        })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        `${label.trim()}: ${naira(total)} brought forward for ${entered.length} ${
          entered.length === 1 ? "member" : "members"
        }`,
      );
      setAmounts({});
      for (const key of OWED_QUERY_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const finish = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_brought_forward_done", { _done: true });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshMe();
      toast.success("Done. You can still add more on any member’s profile.");
      void navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const shown = (members.data ?? []).filter((m) => matchesPerson(search, m.name, m.phone));

  return (
    <div className="space-y-6">
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link to="/members">
          <ArrowLeft className="size-4" /> All members
        </Link>
      </Button>
      <PageHeader
        title="Owed from before"
        subtitle="What members already owed before you started using FinSeka. It counts in what they owe; money only enters the ledger when they pay it."
      />

      {!isAdmin ? (
        <EmptyState title="Admins only" hint="Ask an admin to bring forward what members owed." />
      ) : (
        <>
          <div className="rounded-3xl border border-border bg-card p-5 shadow-soft">
            <p className="text-sm text-muted-foreground">
              Do one thing at a time: type what it was for, fill in what each member owed, and save.
              Then change the label (for example from “Old dues” to “Building levy”) and do the next
              one. Leave a member blank if they owed nothing.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bulk-label">What for</Label>
                <Input
                  id="bulk-label"
                  maxLength={200}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bulk-asof">Owed as of</Label>
                <Input
                  id="bulk-asof"
                  type="date"
                  value={asOf}
                  onChange={(e) => setAsOf(e.target.value)}
                />
              </div>
            </div>
          </div>

          <SearchBox value={search} onChange={setSearch} className="max-w-sm" />

          {members.isLoading || existing.isLoading ? (
            <Loader2 className="size-6 animate-spin text-primary" />
          ) : shown.length === 0 ? (
            <EmptyState
              title="No members found"
              hint="Add your members first, then bring forward what they owed."
            />
          ) : (
            <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Member</th>
                    <th className="px-5 py-3">Already brought forward</th>
                    <th className="w-44 px-5 py-3 text-right">{label.trim() || "Amount"} (₦)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((m) => {
                    const before = existing.data?.get(m.id);
                    return (
                      <tr key={m.id}>
                        <td className="px-5 py-2.5 font-medium">
                          <Link
                            to="/members/$memberId"
                            params={{ memberId: m.id }}
                            className="link"
                          >
                            {m.name}
                          </Link>
                        </td>
                        <td className="px-5 py-2.5 text-muted-foreground">
                          {before
                            ? `${before.labels.join(", ")} · owing ${naira(before.owing)}`
                            : "—"}
                        </td>
                        <td className="px-5 py-2">
                          <MoneyInput
                            aria-label={`${label.trim() || "Amount"} for ${m.name}`}
                            min={0}
                            value={amounts[m.id] ?? ""}
                            onChange={(v) => setAmounts((a) => ({ ...a, [m.id]: v }))}
                            placeholder="0"
                            className="text-right"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-3xl border border-border bg-card p-4 shadow-lift">
            <span className="min-w-0 flex-1 text-sm">
              {entered.length > 0
                ? `${entered.length} ${entered.length === 1 ? "member" : "members"} · ${naira(total)}`
                : "Nothing entered yet"}
            </span>
            <Button
              disabled={save.isPending || entered.length === 0 || !label.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Save {label.trim() || "debts"}
            </Button>
            {!org?.brought_forward_done && (
              <Button
                variant="outline"
                disabled={finish.isPending || entered.length > 0}
                onClick={() => finish.mutate()}
                title={entered.length > 0 ? "Save what you entered first" : undefined}
              >
                I’ve brought everything forward
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
