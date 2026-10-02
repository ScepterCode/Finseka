import {
  createFileRoute,
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, LogOut } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BrandMark } from "@/components/brand-mark";
import { ConfirmButton } from "@/components/confirm";
import { TwoStepGate } from "@/components/two-step-gate";

// The system admin console: its own layout, for FinSeka super admins only.
export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [{ title: "System admin — FinSeka" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLayout,
});

const nav = [
  { to: "/admin", label: "Overview", exact: true },
  { to: "/admin/organizations", label: "Organizations", exact: false },
  { to: "/admin/admins", label: "Super admins", exact: false },
  { to: "/admin/activity", label: "Activity log", exact: false },
] as const;

function AdminLayout() {
  const {
    session,
    loadingSession,
    loadingProfile,
    isPlatformAdmin,
    isPlatformAdminMember,
    mustChangePassword,
    orgId,
    org,
    support,
    email,
  } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  if (loadingSession || (session && loadingProfile)) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" replace />;
  // A new super admin first chooses their own password (shown by the main app).
  if (mustChangePassword || !isPlatformAdminMember) return <Navigate to="/dashboard" replace />;

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="print-hide sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <BrandMark className="size-8" />
          <span className="min-w-0">
            <span className="block font-display text-base font-semibold leading-tight">
              FinSeka System admin
            </span>
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {orgId && (
              <Link
                to="/dashboard"
                className="hidden items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground sm:inline-flex"
              >
                <ArrowLeft className="size-4" />
                {support ? `Back to ${org?.name ?? "the organization"}` : "My organization"}
              </Link>
            )}
            <ConfirmButton
              variant="outline"
              size="sm"
              className="gap-2"
              title="Sign out of FinSeka?"
              description="You will need to sign in again to come back."
              confirmLabel="Yes, sign me out"
              onConfirm={() => void signOut()}
            >
              <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
            </ConfirmButton>
          </div>
        </div>
        {isPlatformAdmin && (
          <nav className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact }}
                className="shrink-0 rounded-xl px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary font-medium text-foreground" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {support && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Your support session in <strong>{org?.name}</strong> is still open.{" "}
          <Link to="/dashboard" className="underline">
            Go back to it
          </Link>{" "}
          or end it from there.
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Every console page needs a sign-in confirmed with a two-step code. */}
        {isPlatformAdmin ? <Outlet /> : <TwoStepGate />}
      </main>
    </div>
  );
}
