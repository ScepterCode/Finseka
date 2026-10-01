import { useDeferredValue, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { SearchBox } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/organizations/")({
  component: OrganizationsPage,
});

const PAGE = 50;

function OrganizationsPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const query = useDeferredValue(search.trim());

  const orgs = useQuery({
    queryKey: ["admin", "orgs", query, sort, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_orgs", {
        ...(query ? { _search: query } : {}),
        _sort: sort,
        _limit: PAGE,
        _offset: page * PAGE,
      });
      if (error) throw error;
      return data;
    },
  });

  const rows = orgs.data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const first = page * PAGE + 1;
  const last = page * PAGE + rows.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        subtitle="Every organization on FinSeka. Open one to see its team, its History and its support sessions."
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          placeholder="Search by organization name or admin email"
          className="w-full max-w-md"
        />
        <Select
          value={sort}
          onValueChange={(v) => {
            setSort(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="active">Most recently active</SelectItem>
            <SelectItem value="members">Most members</SelectItem>
            <SelectItem value="name">Name (A–Z)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {orgs.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No organizations found" hint="Try another name or email." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Admins</th>
                  <th className="px-4 py-3 text-right font-medium">Members</th>
                  <th className="px-4 py-3 text-right font-medium">Team</th>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-secondary/50">
                    <td className="px-4 py-3">
                      <Link
                        to="/admin/organizations/$orgId"
                        params={{ orgId: o.id }}
                        className="block font-medium text-primary hover:underline"
                      >
                        {o.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        Joined {shortDate(o.created_at)}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-muted-foreground">
                      {o.admin_emails ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.members}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.team}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {o.last_activity ? shortDate(o.last_activity) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span>
              {first.toLocaleString("en-NG")}–{last.toLocaleString("en-NG")} of{" "}
              {Number(total).toLocaleString("en-NG")}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={last >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
