import { useState } from "react";
import {
  createFileRoute,
  Navigate,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { friendlyError } from "@/lib/errors";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { completePasswordChange } from "@/lib/team.functions";
import { AppSidebar } from "@/components/app-sidebar";
import { BillingBanner } from "@/components/billing";
import { ConfirmButton } from "@/components/confirm";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function FullScreenLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}

function AuthenticatedLayout() {
  const {
    session,
    loadingSession,
    loadingProfile,
    orgId,
    org,
    isAdmin,
    fullName,
    mustChangePassword,
    isPlatformAdminMember,
    support,
  } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (st) => st.location.pathname });

  if (loadingSession) return <FullScreenLoader />;

  // Redirect with <Navigate> rather than calling navigate() while rendering.
  if (!session) return <Navigate to="/auth" replace />;

  if (loadingProfile) return <FullScreenLoader />;

  if (mustChangePassword) return <ChangePasswordScreen />;

  // A system admin without an organization of their own only has the System admin page.
  if (!orgId && isPlatformAdminMember && !pathname.startsWith("/admin")) {
    return <Navigate to="/admin" replace />;
  }
  if (!orgId && !isPlatformAdminMember) return <OrganizationSetup defaultName={fullName} />;

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar
          orgName={org?.name ?? (isPlatformAdminMember ? "System admin" : "Your organization")}
          showSystemAdmin={isPlatformAdminMember}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="print-hide sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-3 backdrop-blur-md">
            <SidebarTrigger />
            <span className="truncate font-display text-base font-semibold">
              {org?.name ?? "FinSeka"}
            </span>
            {orgId && (
              <Badge variant={isAdmin ? "default" : "secondary"} className="ml-1">
                {support ? "Support" : isAdmin ? "Admin" : "Viewer"}
              </Badge>
            )}
            <ConfirmButton
              variant="outline"
              size="sm"
              className="ml-auto gap-2"
              title="Sign out of FinSeka?"
              description="You will need your email and password (or Google) to come back in."
              confirmLabel="Yes, sign me out"
              onConfirm={() => void signOut()}
            >
              <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
            </ConfirmButton>
          </header>
          {support && <SupportBanner orgName={org?.name ?? "this organization"} />}
          <BillingBanner />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

// Shown on every page while a system admin works inside an organization.
function SupportBanner({ orgName }: { orgName: string }) {
  const { support, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const end = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("end_support_session");
      if (error) throw error;
    },
    onSuccess: async () => {
      const orgId = support?.org_id;
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      refreshMe();
      toast.success("Support session ended");
      if (orgId) navigate({ to: "/admin/organizations/$orgId", params: { orgId } });
      else navigate({ to: "/admin" });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });
  if (!support) return null;
  const ends = new Date(support.expires_at).toLocaleTimeString("en-NG", {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="print-hide flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <ShieldAlert className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        You are working inside <strong>{orgName}</strong> as FinSeka support. Changes are recorded
        under your name. Ends at {ends}.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-400 bg-transparent"
        disabled={end.isPending}
        onClick={() => end.mutate()}
      >
        {end.isPending && <Loader2 className="size-4 animate-spin" />} End session
      </Button>
    </div>
  );
}

function ChangePasswordScreen() {
  const { email, refreshMe } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const changePassword = useServerFn(completePasswordChange);

  const save = useMutation({
    mutationFn: async () => {
      if (password.length < 6) throw new Error("Use at least 6 characters.");
      if (password !== confirm) throw new Error("The two passwords do not match.");
      await changePassword({ data: { password } });
    },
    onSuccess: () => {
      toast.success("Password changed. Welcome to FinSeka!");
      refreshMe();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-lift">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Choose your password</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          You signed in as {email} with a temporary password. Pick your own password to continue.
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="np">New password</Label>
            <Input
              id="np"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="np2">Type it again</Label>
            <Input
              id="np2"
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save password
          </Button>
        </form>
      </div>
    </div>
  );
}

function OrganizationSetup({ defaultName }: { defaultName: string }) {
  const { refreshMe, email } = useAuth();
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState("");

  const setup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("setup_organization", {
        _org_name: orgName,
        _full_name: name,
        ...(phone ? { _phone: phone } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Organization created. Welcome!");
      refreshMe();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-lift">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Set up your organization
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Signed in as {email}. Tell us the name of your church, club, association or union.
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setup.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="org">Organization name</Label>
            <Input
              id="org"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Umuahia Town Union"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="you">Your name</Label>
            <Input
              id="you"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Chinedu Okeke"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Your phone (optional)</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0803 000 0000"
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={setup.isPending}>
            {setup.isPending && <Loader2 className="size-4 animate-spin" />} Create organization
          </Button>
        </form>
      </div>
    </div>
  );
}
