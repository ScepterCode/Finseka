import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchAll } from "@/lib/fetch-all";
import { naira, shortDate } from "@/lib/format";
import { matchesPerson } from "@/lib/search";
import { AddPledgeDialog, PledgeStats, PledgeTable } from "@/components/pledges";
import { pledgeTotals, usePledges } from "@/lib/pledges";
import { DriveDialog } from "@/components/pledge-drive-dialog";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { SearchBox } from "@/components/search-box";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/pledges/")({
  head: () => ({
    meta: [
      { title: "Pledges & gifts — FinSeka" },
      {
        name: "description",
        content: "Pledge drives, who pledged what, and what has been redeemed.",
      },
      { property: "og:title", content: "Pledges & gifts — FinSeka" },
      { property: "og:description", content: "Promises of money and gifts received." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PledgesPage,
});

type Show = "waiting" | "redeemed" | "cancelled" | "all";

function PledgesPage() {
  const { orgId, isAdmin } = useAuth();
  const [show, setShow] = useState<Show>("waiting");
  const [search, setSearch] = useState("");

  const pledges = usePledges();
  const drives = useQuery({
    queryKey: ["pledge-drives", orgId],
    enabled: !!orgId,
    queryFn: () =>
      fetchAll((from, to) =>
        supabase
          .from("pledge_drives")
          .select("id, name, description, target_amount, closes_on, closed")
          .order("closed")
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
  });

  const all = pledges.data ?? [];
  const shown = all.filter(
    (p) =>
      (show === "all" ||
        (show === "waiting" && (p.status === "open" || p.status === "part")) ||
        p.status === show) &&
      matchesPerson(search, p.pledger_name, p.pledger_phone),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pledges & gifts"
        subtitle="Promises of money, from members and anyone else. Pledges are never counted as debts; mark them redeemed as the money comes in."
        action={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <DriveDialog />
              <AddPledgeDialog />
            </div>
          ) : null
        }
      />

      {pledges.isLoading || drives.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <PledgeStats pledges={all} />

          <section className="space-y-4">
            <h2 className="font-display text-xl font-semibold">Pledge drives</h2>
            {(drives.data ?? []).length === 0 ? (
              <EmptyState
                title="No pledge drives yet"
                hint="Start one for a building project, a launch or an appeal. You can also take pledges on any contribution."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {(drives.data ?? []).map((d) => {
                  const t = pledgeTotals(all.filter((p) => p.drive_id === d.id));
                  const target = Number(d.target_amount ?? 0);
                  return (
                    <Link
                      key={d.id}
                      to="/pledges/$driveId"
                      params={{ driveId: d.id }}
                      className="group block rounded-3xl border border-border bg-card p-5 shadow-soft transition-colors hover:border-primary/50"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-display text-lg font-semibold text-primary underline decoration-primary/40 underline-offset-4">
                            {d.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t.count} {t.count === 1 ? "pledge" : "pledges"}
                            {d.closes_on ? ` · closes ${shortDate(d.closes_on)}` : ""}
                          </p>
                        </div>
                        {d.closed && <Badge variant="secondary">Closed</Badge>}
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <span>
                          <span className="block text-xs text-muted-foreground">Pledged</span>
                          <span className="font-semibold">{naira(t.pledged)}</span>
                        </span>
                        <span>
                          <span className="block text-xs text-muted-foreground">Redeemed</span>
                          <span className="font-semibold text-success">{naira(t.redeemed)}</span>
                        </span>
                      </div>
                      {target > 0 && (
                        <div className="mt-3">
                          <Progress value={Math.min((t.redeemed / target) * 100, 100)} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {Math.round((t.redeemed / target) * 100)}% of {naira(target)} received
                          </p>
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-xl font-semibold">All pledges</h2>
            <div className="flex flex-wrap items-center gap-3">
              <Tabs value={show} onValueChange={(v) => setShow(v as Show)}>
                <TabsList>
                  <TabsTrigger value="waiting">Still to come</TabsTrigger>
                  <TabsTrigger value="redeemed">Redeemed</TabsTrigger>
                  <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
              <SearchBox value={search} onChange={setSearch} className="w-full sm:w-64" />
            </div>
            <PledgeTable
              pledges={shown}
              showFor
              emptyHint={
                all.length === 0
                  ? "No pledges yet. Tap “Add pledge” to record one."
                  : "Nothing matches. Try another tab or search."
              }
            />
          </section>
        </>
      )}
    </div>
  );
}
