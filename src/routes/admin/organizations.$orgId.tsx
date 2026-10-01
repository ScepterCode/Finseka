import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, LogIn, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { describeAdminAction, when } from "@/lib/admin-activity";
import { describeChange, type Entry } from "@/lib/history";
import { shortDate } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/page-parts";
import { SupportDialog, WipeDialog, type OrgRef } from "@/components/admin-dialogs";
import { OrgBillingPanel } from "@/components/admin-billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/admin/organizations/$orgId")({
  component: OrganizationPage,
});

type Detail = {
  id: string;
  name: string;
  created_at: string;
  created_by_email: string | null;
  last_activity: string | null;
  counts: {
    members: number;
    active_members: number;
    branches: number;
    dues: number;
    contributions: number;
    due_payments: number;
    contribution_payments: number;
    pledges: number;
    ledger_entries: number;
    history: number;
  };
  team: {
    user_id: string;
    full_name: string;
    email: string | null;
    role: string | null;
    last_sign_in_at: string | null;
    provider: string | null;
  }[];
  support_sessions: {
    admin_email: string | null;
    reason: string;
    started_at: string;
    expires_at: string;
    ended_at: string | null;
  }[];
};

const HISTORY_PAGE = 50;

function OrganizationPage() {
  const { orgId } = Route.useParams();
  const navigate = useNavigate();
  const [supportFor, setSupportFor] = useState<OrgRef | null>(null);
  const [wipeFor, setWipeFor] = useState<OrgRef | null>(null);
  const [tab, setTab] = useState("team");

  const detail = useQuery({
    queryKey: ["admin", "org", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_org_detail", { _org_id: orgId });
      if (error) throw error;
      return data as unknown as Detail;
    },
  });

  if (detail.isLoading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">
          This organization could not be loaded. It may have been wiped out.
        </p>
      </div>
    );
  }

  const d = detail.data;
  const c = d.counts;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-NG");
  const ref = { id: d.id, name: d.name };

  return (
    <div className="space-y-8">
      <BackLink />
      <PageHeader
        title={d.name}
        subtitle={`Joined ${shortDate(d.created_at)}${d.created_by_email ? ` by ${d.created_by_email}` : ""} · last activity ${d.last_activity ? shortDate(d.last_activity) : "never"}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSupportFor(ref)}>
              <LogIn className="size-4" /> Open as support
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setWipeFor(ref)}
            >
              <Trash2 className="size-4" /> Wipe out
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Members" value={n(c.members)} hint={`${n(c.active_members)} active`} />
        <StatCard label="Dues · Contributions" value={`${n(c.dues)} · ${n(c.contributions)}`} />
        <StatCard
          label="Payments recorded"
          value={n((c.due_payments ?? 0) + (c.contribution_payments ?? 0))}
          hint={`${n(c.pledges)} pledges`}
        />
        <StatCard
          label="History entries"
          value={n(c.history)}
          hint={`${n(c.ledger_entries)} ledger lines`}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="team">Team ({d.team.length})</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="support">
              Support sessions ({d.support_sessions.length})
            </TabsTrigger>
            <TabsTrigger value="activity">Admin activity</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="team" className="mt-4">
          <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Signs in with</th>
                  <th className="px-4 py-3 font-medium">Last signed in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.team.map((t) => (
                  <tr key={t.user_id}>
                    <td className="px-4 py-3 font-medium">{t.full_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={t.role === "admin" ? "default" : "secondary"}>
                        {t.role === "admin" ? "Admin" : t.role === "viewer" ? "Viewer" : "No role"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t.provider === "google" ? "Google" : "Email & password"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t.last_sign_in_at ? when(t.last_sign_in_at) : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="billing" className="mt-4">
          {tab === "billing" && <OrgBillingPanel orgId={orgId} />}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {tab === "history" && <OrgHistory orgId={orgId} />}
        </TabsContent>

        <TabsContent value="support" className="mt-4">
          {d.support_sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No support sessions yet.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card text-sm shadow-soft">
              {d.support_sessions.map((s) => (
                <li key={s.started_at} className="px-5 py-3">
                  <span className="font-medium">{s.admin_email ?? "A super admin"}</span>{" "}
                  <span className="text-muted-foreground">— {s.reason}</span>
                  <span className="block text-xs text-muted-foreground">
                    {when(s.started_at)} →{" "}
                    {s.ended_at
                      ? when(s.ended_at)
                      : new Date(s.expires_at) > new Date()
                        ? "still open"
                        : `expired ${when(s.expires_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          {tab === "activity" && <OrgAdminActivity orgId={orgId} />}
        </TabsContent>
      </Tabs>

      <SupportDialog org={supportFor} onClose={() => setSupportFor(null)} />
      <WipeDialog
        org={wipeFor}
        onClose={() => setWipeFor(null)}
        onWiped={() => navigate({ to: "/admin/organizations" })}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/organizations"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> All organizations
    </Link>
  );
}

// The organization's own History, as its team sees it. Opening it is recorded in the activity log.
function OrgHistory({ orgId }: { orgId: string }) {
  const names = useQuery({
    queryKey: ["admin", "org-names", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_org_names", { _org_id: orgId });
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.id, r.name]));
    },
  });
  const log = useInfiniteQuery({
    queryKey: ["admin", "org-history", orgId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("admin_org_history", {
        _org_id: orgId,
        _limit: HISTORY_PAGE,
        _offset: pageParam,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Entry[];
    },
    getNextPageParam: (last, pages) =>
      last.length < HISTORY_PAGE ? undefined : pages.length * HISTORY_PAGE,
  });

  if (log.isLoading || names.isLoading) {
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }
  const rows = log.data?.pages.flat() ?? [];
  const nameMap = names.data ?? new Map<string, string>();
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card text-sm shadow-soft">
        {rows.map((e) => (
          <li key={e.id} className="px-5 py-3">
            <span className="font-semibold">
              {e.actor_label ??
                (e.actor_id ? (nameMap.get(e.actor_id) ?? "A former team member") : "FinSeka")}
            </span>{" "}
            {describeChange(e, nameMap)}
            <span className="block text-xs text-muted-foreground">{when(e.at)}</span>
          </li>
        ))}
      </ul>
      {log.hasNextPage && (
        <Button
          variant="outline"
          className="w-full"
          disabled={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          {log.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />} Show older
        </Button>
      )}
    </div>
  );
}

function OrgAdminActivity({ orgId }: { orgId: string }) {
  const activity = useQuery({
    queryKey: ["admin", "activity", "org", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_activity_page", {
        _org_id: orgId,
        _limit: 100,
      });
      if (error) throw error;
      return data;
    },
  });
  const rows = activity.data ?? [];
  if (activity.isLoading) {
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card text-sm shadow-soft">
      {rows.map((a) => (
        <li key={a.id} className="px-5 py-3">
          <span className="font-medium">{a.admin_email ?? "A super admin"}</span>{" "}
          {describeAdminAction(a)}
          {a.reason && <span className="text-muted-foreground"> — {a.reason}</span>}
          <span className="block text-xs text-muted-foreground">{when(a.at)}</span>
        </li>
      ))}
    </ul>
  );
}
