import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { adminActions, describeAdminAction, when } from "@/lib/admin-activity";
import { friendlyError } from "@/lib/errors";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Search = { admin?: string | undefined; action?: string | undefined; org?: string | undefined };

export const Route = createFileRoute("/admin/activity")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    admin: typeof s["admin"] === "string" ? s["admin"] : undefined,
    action: typeof s["action"] === "string" ? s["action"] : undefined,
    org: typeof s["org"] === "string" ? s["org"] : undefined,
  }),
  component: ActivityPage,
});

const PAGE = 50;
const ALL = "all";

function ActivityPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/activity" });
  const [page, setPage] = useState(0);

  function setFilter(next: Partial<Search>) {
    setPage(0);
    navigate({ search: (prev) => ({ ...prev, ...next }) });
  }

  const admins = useQuery({
    queryKey: ["admin", "admins"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_admins");
      if (error) throw error;
      return data;
    },
  });

  const log = useQuery({
    queryKey: ["admin", "activity", search.admin, search.action, search.org, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_activity_page", {
        ...(search.admin ? { _admin_id: search.admin } : {}),
        ...(search.action ? { _action: search.action } : {}),
        ...(search.org ? { _org_id: search.org } : {}),
        _limit: PAGE,
        _offset: page * PAGE,
      });
      if (error) throw error;
      return data;
    },
  });

  const rows = log.data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);
  const last = page * PAGE + rows.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity log"
        subtitle="Everything every super admin has done. Nothing here can be edited or removed."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={search.admin ?? ALL}
          onValueChange={(v) => setFilter({ admin: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All super admins</SelectItem>
            {(admins.data ?? []).map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>
                {a.email ?? a.user_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.action ?? ALL}
          onValueChange={(v) => setFilter({ action: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actions</SelectItem>
            {Object.entries(adminActions).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {search.org && (
          <Button variant="outline" size="sm" onClick={() => setFilter({ org: undefined })}>
            One organization only <X className="size-4" />
          </Button>
        )}
      </div>

      {log.isError && (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          This list could not be loaded: {friendlyError(log.error)}
        </p>
      )}
      {log.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here" hint="No admin activity matches these filters." />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card text-sm shadow-soft">
            {rows.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <span className="font-medium">{a.admin_email ?? "A super admin"}</span>{" "}
                {a.org_id && a.action !== "wipe" && a.action !== "wipe_logins" ? (
                  <Link
                    to="/admin/organizations/$orgId"
                    params={{ orgId: a.org_id }}
                    className="hover:underline"
                  >
                    {describeAdminAction(a)}
                  </Link>
                ) : (
                  describeAdminAction(a)
                )}
                {a.reason && <span className="text-muted-foreground"> — {a.reason}</span>}
                <span className="block text-xs text-muted-foreground">{when(a.at)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span>
              {(page * PAGE + 1).toLocaleString("en-NG")}–{last.toLocaleString("en-NG")} of{" "}
              {total.toLocaleString("en-NG")}
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
