import { useState } from "react";
import { createFileRoute, Navigate, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { friendlyError } from "@/lib/errors";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { completePasswordChange } from "@/lib/team.functions";
import { AppSidebar } from "@/components/app-sidebar";
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
  } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  if (loadingSession) return <FullScreenLoader />;

  // Redirect with <Navigate> rather than calling navigate() while rendering.
  if (!session) return <Navigate to="/auth" replace />;

  if (loadingProfile) return <FullScreenLoader />;

  if (mustChangePassword) return <ChangePasswordScreen />;

  if (!orgId) return <OrganizationSetup defaultName={fullName} />;

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
        <AppSidebar orgName={org?.name ?? "Your organization"} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="print-hide sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-3 backdrop-blur-md">
            <SidebarTrigger />
            <span className="truncate font-display text-base font-semibold">
              {org?.name ?? "FinSeka"}
            </span>
            <Badge variant={isAdmin ? "default" : "secondary"} className="ml-1">
              {isAdmin ? "Admin" : "Viewer"}
            </Badge>
            <ConfirmButton
              variant="ghost"
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
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
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
