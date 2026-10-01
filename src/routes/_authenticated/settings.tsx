import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, ShieldCheck, Trash2, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAuth } from "@/hooks/useAuth";
import { useLogoUrl } from "@/hooks/useLogoUrl";
import { friendlyError } from "@/lib/errors";
import { initials } from "@/lib/format";
import { inviteTeamMember, deleteMyAccount, type InviteResult } from "@/lib/team.functions";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { ConfirmButton } from "@/components/confirm";
import { FinancialYearSettings } from "@/components/financial-year-settings";
import { BillingSection } from "@/components/billing";
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

// Must match allowed_mime_types on the org-logos bucket. SVG is left out: it can carry scripts.
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function SettingsPage() {
  const { orgId, org, isAdmin, refreshMe, userId } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(org?.name ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const logoPreview = useLogoUrl(org?.logo_url);

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
      const [profiles, roleRows] = await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from("profiles")
            .select("id, full_name, phone")
            .eq("org_id", orgId!)
            .order("full_name")
            .order("id")
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase.from("user_roles").select("user_id, role").order("id").range(from, to),
        ),
      ]);
      const roles = new Map(roleRows.map((r) => [r.user_id, r.role]));
      return profiles.map((p) => ({
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

  // Removing someone takes them out of this organization; their login stays.
  const revokeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("remove_team_member", { _user_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed from your team");
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const changeRole = useMutation({
    mutationFn: async (v: { id: string; role: "admin" | "viewer" }) => {
      const { error } = await supabase.rpc("set_member_role", { _user_id: v.id, _role: v.role });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.role === "admin" ? "They are now an admin" : "They can now only view");
      queryClient.invalidateQueries({ queryKey: ["team"] });
      if (v.id === userId) refreshMe();
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

      <BillingSection />

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
                accept={LOGO_TYPES.join(",")}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (!LOGO_TYPES.includes(file.type)) {
                    toast.error("Use a PNG, JPG, WebP or GIF picture for the logo.");
                  } else if (file.size > 2 * 1024 * 1024) {
                    toast.error("That picture is too big. Use one under 2 MB.");
                  } else {
                    uploadLogo.mutate(file);
                  }
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

      <FinancialYearSettings />

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
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                  {initials(p.full_name || "?")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.full_name || "No name"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.phone || "No phone"}
                  </span>
                </span>
                {isAdmin ? (
                  <Select
                    value={p.role}
                    disabled={changeRole.isPending}
                    onValueChange={(v) =>
                      changeRole.mutate({ id: p.id, role: v as "admin" | "viewer" })
                    }
                  >
                    <SelectTrigger
                      className="w-28"
                      aria-label={`Role for ${p.full_name || "this person"}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={p.role === "admin" ? "default" : "secondary"} className="gap-1">
                    {p.role === "admin" && <ShieldCheck className="size-3" />}
                    {p.role === "admin" ? "Admin" : "Viewer"}
                  </Badge>
                )}
                {isAdmin && p.id !== userId && (
                  <ConfirmButton
                    variant="outline"
                    size="icon"
                    className="border-destructive/40"
                    destructive
                    title={`Remove ${p.full_name || "this person"} from your team?`}
                    description="They lose access to your records straight away. Their login is kept, so you can invite them back later."
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
          be able to sign in again. If you are the only admin, make someone else an admin first.
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
  const [result, setResult] = useState<InviteResult | null>(null);

  const save = useMutation({
    mutationFn: async () => invite({ data: { fullName, email, role } }),
    onSuccess: (res) => {
      setResult(res);
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
              {result.password && <p className="mt-1 font-mono text-base">{result.password}</p>}
            </div>
            <p className="text-sm text-muted-foreground">{result.note}</p>
            {result.password && (
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
            )}
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
