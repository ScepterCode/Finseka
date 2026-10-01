import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

type Org = {
  id: string;
  name: string;
  logo_url: string | null;
  opening_balance_set: boolean;
};

/** A FinSeka system admin working inside an organization for a limited time. */
export type SupportSession = {
  org_id: string;
  reason: string;
  started_at: string;
  expires_at: string;
};

/** Where the organization stands with FinSeka billing. */
export type Billing = {
  status: "trial" | "active" | "grace" | "read_only" | "free";
  can_write: boolean;
  trial_ends_at: string;
  paid_until: string | null;
  grace_ends_at: string | null;
  free_plan: boolean;
  provider: "flutterwave" | "manual" | null;
  auto_renew: boolean;
  price: number;
};

type AppContext = {
  billing?: Billing | null;
  org: Org | null;
  is_admin: boolean;
  is_platform_admin: boolean;
  is_platform_admin_member: boolean;
  support: SupportSession | null;
};

type AuthValue = {
  session: Session | null;
  userId: string | null;
  email: string | null;
  loadingSession: boolean;
  loadingProfile: boolean;
  fullName: string;
  orgId: string | null;
  org: Org | null;
  isAdmin: boolean;
  /** A super admin with their powers: signed in with a two-step code. */
  isPlatformAdmin: boolean;
  /** On the super admin list, whether or not this sign-in used a two-step code. */
  isPlatformAdminMember: boolean;
  support: SupportSession | null;
  billing: Billing | null;
  /** False when the organization's plan has ended: records can be seen but not changed, downloaded or printed. */
  canWrite: boolean;
  mustChangePassword: boolean;
  refreshMe: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoadingSession(false);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id ?? null;

  const me = useQuery({
    queryKey: ["me", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [profileRes, contextRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, must_change_password")
          .eq("id", userId!)
          .maybeSingle(),
        // The organization comes from the database, not the profile: a system admin in a
        // support session works in another organization, and admin rights are per organization.
        supabase.rpc("app_context"),
      ]);
      const profile = profileRes.data;
      let context = contextRes.data as unknown as AppContext;
      if (contextRes.error) {
        // Before the system-admin migration is applied, app_context does not exist yet:
        // read the organization the way the app did before, so either order of deploy works.
        if (contextRes.error.code !== "PGRST202") throw contextRes.error;
        const [orgRes, adminRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("organizations(id, name, logo_url, opening_balance_set)")
            .eq("id", userId!)
            .maybeSingle(),
          supabase.rpc("is_org_admin"),
        ]);
        context = {
          org: (orgRes.data?.organizations as Org | null) ?? null,
          is_admin: adminRes.data === true,
          is_platform_admin: false,
          is_platform_admin_member: false,
          support: null,
        };
      }
      const billing = context.billing ?? null;
      // FinSeka support can still fix records in an organization whose plan has ended.
      const canWrite = !billing || billing.can_write || !!context.support;
      return {
        fullName: profile?.full_name ?? "",
        orgId: context.org?.id ?? null,
        org: context.org,
        // Admin controls are hidden while the plan has ended; the database refuses changes anyway.
        isAdmin: context.is_admin && canWrite,
        billing,
        canWrite,
        isPlatformAdmin: context.is_platform_admin,
        isPlatformAdminMember: context.is_platform_admin_member ?? context.is_platform_admin,
        support: context.support,
        mustChangePassword: profile?.must_change_password ?? false,
      };
    },
    // A support session ends on its own; check now and then so the app notices.
    refetchInterval: (query) => (query.state.data?.support ? 60_000 : false),
  });

  const value = useMemo<AuthValue>(
    () => ({
      session,
      userId,
      email: session?.user.email ?? null,
      loadingSession,
      loadingProfile: !!userId && me.isLoading,
      fullName: me.data?.fullName ?? "",
      orgId: me.data?.orgId ?? null,
      org: me.data?.org ?? null,
      isAdmin: me.data?.isAdmin ?? false,
      isPlatformAdmin: me.data?.isPlatformAdmin ?? false,
      isPlatformAdminMember: me.data?.isPlatformAdminMember ?? false,
      support: me.data?.support ?? null,
      billing: me.data?.billing ?? null,
      canWrite: me.data?.canWrite ?? true,
      mustChangePassword: me.data?.mustChangePassword ?? false,
      refreshMe: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
    }),
    [session, userId, loadingSession, me.isLoading, me.data, queryClient],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
