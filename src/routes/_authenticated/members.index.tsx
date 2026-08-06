import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { initials } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/page-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/members/")({
  head: () => ({
    meta: [
      { title: "Members — FinSeka" },
      { name: "description", content: "Your association members, branches and payment history." },
      { property: "og:title", content: "Members — FinSeka" },
      { property: "og:description", content: "Add members and see what each person owes." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MembersPage,
});

function MembersPage() {
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const members = useQuery({
    queryKey: ["members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name, phone, active, branch_id, branches(name)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const branches = useQuery({
    queryKey: ["branches", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["branches"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const filtered = (members.data ?? []).filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Members"
        subtitle="Everybody on your list, and the branch they belong to."
        action={
          isAdmin ? (
            <div className="flex gap-2">
              <AddBranchDialog onDone={invalidate} />
              <AddMemberDialog branches={branches.data ?? []} onDone={invalidate} />
            </div>
          ) : null
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search a name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {members.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No members yet"
          hint="Add your first member — name, phone and branch is all you need."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {filtered.map((m) => (
            <li key={m.id}>
              <Link
                to="/members/$memberId"
                params={{ memberId: m.id }}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
                  {initials(m.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.phone || "No phone"}
                  </span>
                </span>
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  {(m.branches as { name: string } | null)?.name ?? "No branch"}
                </Badge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddMemberDialog({
  branches,
  onDone,
}: {
  branches: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { orgId } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("members").insert({
        org_id: orgId!,
        name,
        phone: phone || null,
        branch_id: branchId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member added");
      setName("");
      setPhone("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="gap-2">
          <Plus className="size-4" /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>Name, phone and the branch this person belongs to.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="m-name">Name</Label>
            <Input id="m-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-phone">Phone</Label>
            <Input
              id="m-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0803 000 0000"
            />
          </div>
          <div className="space-y-2">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save member
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddBranchDialog({ onDone }: { onDone: () => void }) {
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
        <Button size="lg" variant="outline" className="gap-2">
          <Plus className="size-4" /> Branch
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
            <Label htmlFor="b-name">Branch name</Label>
            <Input id="b-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save branch
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
