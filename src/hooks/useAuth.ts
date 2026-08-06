import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

type Org = { id: string; name: string; logo_url: string | null };

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
      const [profileRes, rolesRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, org_id, full_name, phone, organizations(id, name, logo_url)")
          .eq("id", userId!)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId!),
      ]);
      const profile = profileRes.data;
      return {
        fullName: profile?.full_name ?? "",
        orgId: profile?.org_id ?? null,
        org: (profile?.organizations as Org | null) ?? null,
        isAdmin: (rolesRes.data ?? []).some((r) => r.role === "admin"),
      };
    },
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
