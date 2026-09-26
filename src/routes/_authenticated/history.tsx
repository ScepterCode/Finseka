import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { describeChange, type Entry } from "@/lib/history";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "History — FinSeka" },
      {
        name: "description",
        content: "Every change made to your organization's records, and who made it.",
      },
      { property: "og:title", content: "History — FinSeka" },
      { property: "og:description", content: "Who changed what, and when." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HistoryPage,
});

const PAGE_SIZE = 50;

function HistoryPage() {
  const { orgId } = useAuth();

  // Names for people, members, dues and contributions mentioned in the log.
  const names = useQuery({
    queryKey: ["history-names", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [people, members, dues, contributions] = await Promise.all([
        supabase.from("profiles").select("id, full_name"),
        supabase.from("members").select("id, name"),
        supabase.from("dues").select("id, name"),
        supabase.from("contributions").select("id, name"),
      ]);
      const map = new Map<string, string>();
      for (const p of people.data ?? []) map.set(p.id, p.full_name || "A team member");
      for (const r of [
        ...(members.data ?? []),
        ...(dues.data ?? []),
        ...(contributions.data ?? []),
      ])
        map.set(r.id, r.name);
      return map;
    },
  });

  const log = useInfiniteQuery({
    queryKey: ["history", orgId],
    enabled: !!orgId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, actor_id, table_name, action, old_row, new_row, at")
        .order("at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);
      if (error) throw error;
      return data as Entry[];
    },
    getNextPageParam: (last, pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });

  const rows = log.data?.pages.flat() ?? [];
  const nameMap = names.data ?? new Map<string, string>();

  return (
    <div className="space-y-8">
      <PageHeader
        title="History"
        subtitle="Every change to your records, who made it and when. Nothing here can be edited or removed."
      />

      {log.isLoading || names.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing yet" hint="Changes will show here as your team uses FinSeka." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {rows.map((e) => (
            <li key={e.id} className="flex items-start gap-4 px-5 py-4">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
                <History className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">
                  <span className="font-semibold">
                    {e.actor_id ? (nameMap.get(e.actor_id) ?? "A former team member") : "FinSeka"}
                  </span>{" "}
                  {describeChange(e, nameMap)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {log.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void log.fetchNextPage()}
            disabled={log.isFetchingNextPage}
          >
            {log.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />} Show more
          </Button>
        </div>
      )}
    </div>
  );
}
