import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

// Who a due applies to. The picker lives in src/components/due-audience-fields.tsx.

export type Audience = "everyone" | "labels" | "branches" | "people";

export type AudienceValue = {
  audience: Audience;
  labels: string[];
  branchIds: string[];
  memberIds: string[];
};

export const everyone: AudienceValue = {
  audience: "everyone",
  labels: [],
  branchIds: [],
  memberIds: [],
};

/** The labels, branches and active members an organization can target a due at. */
export function useAudienceOptions(orgId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["audience-options", orgId],
    enabled: !!orgId && enabled,
    queryFn: async () => {
      const [members, branches] = await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from("members")
            .select("id, name, phone, tags, branch_id")
            .eq("active", true)
            .order("name")
            .order("id")
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase.from("branches").select("id, name").order("name").order("id").range(from, to),
        ),
      ]);
      const labels = [...new Set(members.flatMap((m) => (m.tags as string[] | null) ?? []))].sort();
      return { members, branches, labels };
    },
  });
}

/** A short description of who a due is for, e.g. "Members labelled new". */
export function describeAudience(
  v: { audience: string; audience_labels?: string[] | null; audience_branch_ids?: string[] | null },
  branchNames?: Map<string, string>,
) {
  if (v.audience === "labels") return `Members labelled ${(v.audience_labels ?? []).join(", ")}`;
  if (v.audience === "branches") {
    const names = (v.audience_branch_ids ?? []).map((id) => branchNames?.get(id) ?? "a branch");
    return `Members in ${names.join(", ")}`;
  }
  if (v.audience === "people") return "Specific people";
  return "Everyone";
}

/** Whether the choice is complete (e.g. at least one label picked). */
export function audienceIsValid(v: AudienceValue) {
  if (v.audience === "labels") return v.labels.length > 0;
  if (v.audience === "branches") return v.branchIds.length > 0;
  if (v.audience === "people") return v.memberIds.length > 0;
  return true;
}

/** Saves the picked people for a "specific people" due (adds and removes the difference). */
export async function saveDueMembers(
  orgId: string,
  dueId: string,
  before: string[],
  after: string[],
) {
  const add = after.filter((id) => !before.includes(id));
  const remove = before.filter((id) => !after.includes(id));
  if (add.length) {
    const { error } = await supabase
      .from("due_members")
      .insert(add.map((member_id) => ({ org_id: orgId, due_id: dueId, member_id })));
    if (error) throw error;
  }
  if (remove.length) {
    const { error } = await supabase
      .from("due_members")
      .delete()
      .eq("due_id", dueId)
      .in("member_id", remove);
    if (error) throw error;
  }
}
