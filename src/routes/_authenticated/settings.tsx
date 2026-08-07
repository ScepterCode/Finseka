import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { initials } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings & Admin — FinSeka" },
      {
        name: "description",
        content: "Organization name and logo, branches, and who can see or edit your records.",
      },
      { property: "og:title", content: "Settings & Admin — FinSeka" },
      { property: "og:description", content: "Organization info, branches and people." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { orgId, org, isAdmin, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(org?.name ?? "");
  const [logoUrl, setLogoUrl] = useState(org?.logo_url ?? "");

  useEffect(() => {
    setName(org?.name ?? "");
    setLogoUrl(org?.logo_url ?? "");
  }, [org?.name, org?.logo_url]);

  const branches = useQuery({
    queryKey: ["branches", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const team = useQuery({
    queryKey: ["team", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [profilesRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, phone").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;
      const roles = new Map((rolesRes.data ?? []).map((r) => [r.user_id, r.role]));
      return (profilesRes.data ?? []).map((p) => ({
        ...p,
        role: roles.get(p.id) ?? "viewer",
      }));
    },
  });

  const saveOrg = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations")
        .update({ name, logo_url: logoUrl || null })
        .eq("id", orgId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Organization updated");
      refreshMe();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-10">
      <PageHeader
        title="Settings & Admin"
        subtitle="Your organization details, branches and the people who can use FinSeka."
      />

      <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-display text-lg font-semibold">Organization info</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This name shows on the sidebar and reports.
        </p>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveOrg.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="o-name">Name</Label>
            <Input
              id="o-name"
              value={name}
              disabled={!isAdmin}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="o-logo">Logo link (optional)</Label>
            <Input
              id="o-logo"
              value={logoUrl}
              disabled={!isAdmin}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          {isAdmin && (
            <div className="sm:col-span-2">
              <Button type="submit" size="lg" disabled={saveOrg.isPending}>
                {saveOrg.isPending && <Loader2 className="size-4 animate-spin" />} Save changes
              </Button>
            </div>
          )}
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Branches & chapters</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Groups inside your organization, like Umuahia Branch.
            </p>
          </div>
          {isAdmin && (
            <AddBranch onDone={() => queryClient.invalidateQueries({ queryKey: ["branches"] })} />
          )}
        </div>
        {branches.isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (branches.data ?? []).length === 0 ? (
          <EmptyState title="No branches yet" hint="Add one to group members by location." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            {(branches.data ?? []).map((b) => (
              <li key={b.id} className="px-5 py-4 font-medium">
                {b.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold">People with access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Admins can add and edit everything. Viewers can only look.
          </p>
        </div>
        {team.isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            {(team.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-5 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                  {initials(p.full_name || "?")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.full_name || "No name"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.phone || "No phone"}
                  </span>
                </span>
                <Badge variant={p.role === "admin" ? "default" : "secondary"} className="gap-1">
                  {p.role === "admin" && <ShieldCheck className="size-3" />}
                  {p.role === "admin" ? "Admin" : "Viewer"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddBranch({ onDone }: { onDone: () => void }) {
  const { orgId } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("branches").insert({ org_id: orgId!, name });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Branch added");
      setName("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Plus className="size-4" /> Add branch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add branch or chapter</DialogTitle>
          <DialogDescription>Example: Umuahia Branch, Aba Branch.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="s-branch">Branch name</Label>
            <Input id="s-branch" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save branch
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
