import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { naira, shortDate } from "@/lib/format";
import { matchesPerson } from "@/lib/search";
import { AddPledgeDialog, PledgeStats, PledgeTable } from "@/components/pledges";
import { pledgeTotals, usePledges } from "@/lib/pledges";
import { DriveDialog } from "@/components/pledge-drive-dialog";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { SearchBox } from "@/components/search-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/pledges/$driveId")({
  head: () => ({
    meta: [
      { title: "Pledge drive — FinSeka" },
      { name: "description", content: "Who pledged to this drive and what has come in." },
      { property: "og:title", content: "Pledge drive — FinSeka" },
      { property: "og:description", content: "Pledges and redemptions for one drive." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DrivePage,
});

function DrivePage() {
  const { driveId } = Route.useParams();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const drive = useQuery({
    queryKey: ["pledge-drives", "one", driveId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pledge_drives")
        .select("id, name, description, target_amount, closes_on, closed")
        .eq("id", driveId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const pledges = usePledges({ driveId });

  const setClosed = useMutation({
    mutationFn: async (closed: boolean) => {
      const { error } = await supabase.from("pledge_drives").update({ closed }).eq("id", driveId);
      if (error) throw error;
    },
    onSuccess: (_, closed) => {
      toast.success(closed ? "Drive closed to new pledges" : "Drive reopened");
      queryClient.invalidateQueries({ queryKey: ["pledge-drives"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (drive.isLoading || pledges.isLoading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  const d = drive.data;
  if (!d) {
    return (
      <EmptyState
        title="Pledge drive not found"
        hint="It may have been removed."
        action={
          <Button asChild variant="outline">
            <Link to="/pledges">Back to pledges</Link>
          </Button>
        }
      />
    );
  }

  const all = pledges.data ?? [];
  const t = pledgeTotals(all);
  const target = Number(d.target_amount ?? 0);
  const shown = all.filter((p) => matchesPerson(search, p.pledger_name, p.pledger_phone));

  return (
    <div className="space-y-8">
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link to="/pledges">
          <ArrowLeft className="size-4" /> All pledges
        </Link>
      </Button>

      <PageHeader
        title={d.name}
        subtitle={`${d.description || "Pledge drive"}${d.closes_on ? ` · closes ${shortDate(d.closes_on)}` : ""}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {d.closed && <Badge variant="secondary">Closed</Badge>}
            {isAdmin && <DriveDialog drive={d} />}
            {isAdmin && (
              <Button
                variant="outline"
                disabled={setClosed.isPending}
                onClick={() => setClosed.mutate(!d.closed)}
              >
                {d.closed ? "Reopen" : "Close to new pledges"}
              </Button>
            )}
            {isAdmin && !d.closed && (
              <AddPledgeDialog target={{ kind: "drive", id: d.id, name: d.name }} />
            )}
          </div>
        }
      />

      <PledgeStats pledges={all} target={target || null} />

      {target > 0 && (
        <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
          <Progress value={Math.min((t.redeemed / target) * 100, 100)} />
          <p className="mt-2 text-sm text-muted-foreground">
            {naira(t.redeemed)} received of {naira(target)} (
            {Math.round((t.redeemed / target) * 100)}
            %). Pledged so far: {naira(t.pledged)} ({Math.round((t.pledged / target) * 100)}%).
          </p>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Pledges</h2>
          <SearchBox value={search} onChange={setSearch} className="w-full sm:w-64" />
        </div>
        <PledgeTable
          pledges={shown}
          emptyHint={
            all.length === 0 ? "No pledges yet. Tap “Add pledge” to record one." : "Nobody matches."
          }
        />
      </section>
    </div>
  );
}
