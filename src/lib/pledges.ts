import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { fetchAll } from "@/lib/fetch-all";

export type Pledge = Database["public"]["Views"]["pledge_status"]["Row"];
export type PledgeFilter = { driveId?: string; contributionId?: string; memberId?: string };
/** What a new pledge is for, when it is fixed by the page it is added from. */
export type PledgeTarget = { kind: "drive" | "contribution"; id: string; name: string };

const invalidateKeys = [
  "pledges",
  "pledge-drives",
  "ledger",
  "ledger-balance",
  "dashboard",
  "reports",
];

export function useInvalidatePledges() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of invalidateKeys) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

export function usePledges(filter: PledgeFilter = {}) {
  const { orgId } = useAuth();
  return useQuery({
    queryKey: ["pledges", orgId, filter],
    enabled: !!orgId,
    queryFn: async () => {
      const data = await fetchAll((from, to) => {
        let q = supabase.from("pledge_status").select("*");
        if (filter.driveId) q = q.eq("drive_id", filter.driveId);
        if (filter.contributionId) q = q.eq("contribution_id", filter.contributionId);
        if (filter.memberId) q = q.eq("member_id", filter.memberId);
        return q
          .order("pledged_on", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to);
      });
      return data as Pledge[];
    },
  });
}

/** Pledged (not counting cancelled pledges), redeemed, and still to come. */
export function pledgeTotals(pledges: Pledge[]) {
  const live = pledges.filter((p) => p.status !== "cancelled");
  return {
    count: live.length,
    pledged: live.reduce((s, p) => s + Number(p.amount), 0),
    redeemed: pledges.reduce((s, p) => s + Number(p.redeemed), 0),
    outstanding: live.reduce((s, p) => s + Number(p.outstanding), 0),
  };
}
