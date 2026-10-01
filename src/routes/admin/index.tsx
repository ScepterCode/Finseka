import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { describeAdminAction, when } from "@/lib/admin-activity";
import { naira } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/page-parts";

export const Route = createFileRoute("/admin/")({
  component: OverviewPage,
});

type Overview = {
  organizations: number;
  new_organizations_30d: number;
  active_organizations_30d: number;
  members: number;
  logins: number;
  super_admins: number;
  money_in_30d: number;
  open_support_sessions: {
    admin_email: string | null;
    org_id: string;
    org_name: string | null;
    reason: string;
    expires_at: string;
  }[];
};

function OverviewPage() {
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_overview");
      if (error) throw error;
      return data as unknown as Overview;
    },
  });
  const billing = useQuery({
    queryKey: ["admin", "billing-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_billing_overview");
      if (error) throw error;
      return data as unknown as {
        trial: number;
        active: number;
        grace: number;
        read_only: number;
        free: number;
        monthly_revenue: number;
        paid_last_30d: number;
      };
    },
  });
  const recent = useQuery({
    queryKey: ["admin", "activity", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_activity_page", { _limit: 10 });
      if (error) throw error;
      return data;
    },
  });

  const o = overview.data;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-NG");

  return (
    <div className="space-y-10">
      <PageHeader title="Overview" subtitle="FinSeka across every organization." />

      {overview.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Organizations"
            value={n(o?.organizations)}
            hint={`${n(o?.new_organizations_30d)} new in the last 30 days`}
          />
          <StatCard
            label="Active organizations"
            value={n(o?.active_organizations_30d)}
            hint="Made a change in the last 30 days"
            tone="good"
          />
          <StatCard
            label="Members on record"
            value={n(o?.members)}
            hint="Active members, all organizations"
          />
          <StatCard
            label="Money in, last 30 days"
            value={naira(o?.money_in_30d ?? 0)}
            hint="Recorded across all organizations"
            tone="accent"
          />
          <StatCard label="Logins" value={n(o?.logins)} hint="Everyone who can sign in" />
          <StatCard label="Super admins" value={n(o?.super_admins)} />
        </div>
      )}

      {billing.data && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Billing</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Pro organizations"
              value={n(billing.data.active)}
              hint={`${naira(billing.data.monthly_revenue)} a month`}
              tone="good"
            />
            <StatCard
              label="On free trial"
              value={n(billing.data.trial)}
              hint={`${n(billing.data.free)} on a free plan`}
            />
            <StatCard
              label="Overdue · Ended"
              value={`${n(billing.data.grace)} · ${n(billing.data.read_only)}`}
              hint="Overdue ones keep working for 3 days"
              tone="bad"
            />
            <StatCard
              label="Paid, last 30 days"
              value={naira(billing.data.paid_last_30d)}
              tone="accent"
            />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Open support sessions</h2>
        {(o?.open_support_sessions ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">None right now.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card text-sm shadow-soft">
            {o!.open_support_sessions.map((s) => (
              <li key={s.org_id + s.expires_at} className="px-5 py-3">
                <span className="font-medium">{s.admin_email ?? "A super admin"}</span> is in{" "}
                <Link
                  to="/admin/organizations/$orgId"
                  params={{ orgId: s.org_id }}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {s.org_name ?? "an organization"}
                </Link>{" "}
                <span className="text-muted-foreground">— {s.reason}</span>
                <span className="block text-xs text-muted-foreground">
                  Ends {when(s.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold">Recent admin activity</h2>
          <Link to="/admin/activity" className="text-sm text-primary hover:underline">
            See all
          </Link>
        </div>
        {(recent.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card text-sm shadow-soft">
            {(recent.data ?? []).map((a) => (
              <li key={a.id} className="px-5 py-3">
                <span className="font-medium">{a.admin_email ?? "A super admin"}</span>{" "}
                {describeAdminAction(a)}
                {a.reason && <span className="text-muted-foreground"> — {a.reason}</span>}
                <span className="block text-xs text-muted-foreground">{when(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
