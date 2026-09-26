import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, ShieldCheck, Trash2, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { friendlyError } from "@/lib/errors";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLogoUrl } from "@/hooks/useLogoUrl";
import { initials } from "@/lib/format";
import { inviteTeamMember, revokeTeamMember, deleteMyAccount } from "@/lib/team.functions";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { ConfirmButton } from "@/components/confirm";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const { orgId, org, isAdmin, refreshMe, userId } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(org?.name ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const logoPreview = useLogoUrl(org?.logo_url);

  const revoke = useServerFn(revokeTeamMember);
  const removeMe = useServerFn(deleteMyAccount);

  useEffect(() => {
    setName(org?.name ?? "");
  }, [org?.name]);

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
      const { error } = await supabase.from("organizations").update({ name }).eq("id", orgId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Organization updated");
      refreshMe();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${orgId}/logo-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("org-logos").upload(path, file, { upsert: true });
      if (up.error) throw up.error;
      const { error } = await supabase
        .from("organizations")
        .update({ logo_url: path })
        .eq("id", orgId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Logo uploaded");
      refreshMe();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const revokeMember = useMutation({
    mutationFn: async (id: string) => revoke({ data: { userId: id } }),
    onSuccess: () => {
      toast.success("Access removed");
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const deleteAccount = useMutation({
    mutationFn: async () => removeMe(),
    onSuccess: async () => {
      await supabase.auth.signOut();
      queryClient.clear();
      navigate({ to: "/", replace: true });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
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
          This name and logo show on the sidebar and reports.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-primary-soft text-sm font-semibold text-primary">
            {logoPreview ? (
              <img
                src={logoPreview}
                alt={`${org?.name ?? "Organization"} logo`}
                className="size-full object-cover"
              />
            ) : (
              initials(org?.name || "FinSeka")
            )}
          </span>
          {isAdmin && (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo.mutate(file);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={uploadLogo.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {uploadLogo.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload logo
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                PNG or JPG, small file is fine.
              </p>
            </div>
          )}
        </div>

        <form
          className="mt-6 grid gap-4 sm:grid-cols-2"
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold">People with access</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Admins can add and edit everything. Viewers can only look.
            </p>
          </div>
          {isAdmin && (
            <ShareAccess onDone={() => queryClient.invalidateQueries({ queryKey: ["team"] })} />
          )}
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
                {isAdmin && p.id !== userId && (
                  <ConfirmButton
                    variant="ghost"
                    size="icon"
                    destructive
                    title={`Remove ${p.full_name || "this person"}?`}
                    description="They will lose access to your records straight away. This cannot be undone."
                    confirmLabel="Yes, remove them"
                    onConfirm={() => revokeMember.mutate(p.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                    <span className="sr-only">Remove access</span>
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-destructive/30 bg-card p-6 shadow-soft">
        <h2 className="font-display text-lg font-semibold text-destructive">Delete my account</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          This removes your own login from FinSeka. Your organization records stay, but you will not
          be able to sign in again.
        </p>
        <ConfirmButton
          variant="outline"
          className="mt-4 gap-2 border-destructive/40 text-destructive"
          destructive
          title="Delete your account?"
          description="You will be signed out immediately and cannot sign in with this email again."
          confirmLabel="Yes, delete my account"
          onConfirm={() => deleteAccount.mutate()}
        >
          <Trash2 className="size-4" /> Delete my account
        </ConfirmButton>
      </section>
    </div>
  );
}

function ShareAccess({ onDone }: { onDone: () => void }) {
  const invite = useServerFn(inviteTeamMember);
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [result, setResult] = useState<{ email: string; password: string; note: string } | null>(
    null,
  );

  const save = useMutation({
    mutationFn: async () => invite({ data: { fullName, email, role } }),
    onSuccess: (res) => {
      setResult({ email: res.email, password: res.password, note: res.emailNote });
      setFullName("");
      setEmail("");
      onDone();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="size-4" /> Share access
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share access</DialogTitle>
          <DialogDescription>
            We create their login with a temporary password. They must choose a new password the
            first time they sign in.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-secondary p-4 text-sm">
              <p className="font-medium">{result.email}</p>
              <p className="mt-1 font-mono text-base">{result.password}</p>
            </div>
            <p className="text-sm text-muted-foreground">{result.note}</p>
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  `FinSeka login\nEmail: ${result.email}\nTemporary password: ${result.password}`,
                );
                toast.success("Copied");
              }}
            >
              Copy login details
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="t-name">Their name</Label>
              <Input
                id="t-name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ngozi Eze"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-email">Their email</Label>
              <Input
                id="t-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ngozi@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>What can they do?</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "admin" | "viewer")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer — can only look</SelectItem>
                  <SelectItem value="admin">Admin — can add and edit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Create their login
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
    onError: (e: Error) => toast.error(friendlyError(e)),
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
