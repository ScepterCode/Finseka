import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { friendlyError } from "@/lib/errors";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { naira, todayIso } from "@/lib/format";
import { SearchBox } from "@/components/search-box";
import { SortHead } from "@/components/sort-head";
import {
  defaultDir,
  filterMembers,
  sortMembers,
  summarize,
  type MemberRow,
  type MemberSort,
  type SortDir,
} from "@/lib/member-list";
import { PageHeader, EmptyState } from "@/components/page-parts";
import { MemberDetailsFields } from "@/components/member-details-fields";
import { DebtLinesEditor } from "@/components/brought-forward";
import { emptyDebtLine, filledDebtLines, type DebtLine } from "@/lib/brought-forward";
import { detailsToRow, emptyDetails } from "@/lib/member-details";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const suggestedTags = ["New", "Elder", "Executive", "Youth", "Women", "Exempt"];

function MembersPage() {
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [owingOnly, setOwingOnly] = useState(false);
  const [sort, setSort] = useState<MemberSort>("name");
  const [dir, setDir] = useState<SortDir>("asc");

  const members = useQuery({
    queryKey: ["members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase
          .from("members")
          .select("id, name, phone, active, tags, branch_id, branches(name)")
          .order("name")
          .order("id")
          .range(from, to),
      );
      return data;
    },
  });

  // What each active member owes, worked out in the database exactly as on their profile and the
  // dashboard. Under "member-standing" so recording or cancelling a payment refreshes it.
  const balances = useQuery({
    queryKey: ["member-standing", "all", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("member_balances", {});
      if (error) throw error;
      return new Map((data ?? []).map((b) => [b.member_id, Number(b.total_owing)]));
    },
  });

  const branches = useQuery({
    queryKey: ["branches", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase.from("branches").select("id, name").order("name").order("id").range(from, to),
      );
      return data;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["branches"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["member-standing"] });
  };

  const rows = useMemo<MemberRow[]>(
    () =>
      (members.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        phone: m.phone,
        active: m.active,
        tags: (m.tags as string[] | null) ?? [],
        branch: (m.branches as { name: string } | null)?.name ?? null,
        owing: m.active ? (balances.data?.get(m.id) ?? 0) : null,
      })),
    [members.data, balances.data],
  );

  const allTags = useMemo(() => [...new Set(rows.flatMap((m) => m.tags))].sort(), [rows]);

  const shown = useMemo(
    () => sortMembers(filterMembers(rows, { search, tag: tagFilter, owingOnly }), sort, dir),
    [rows, search, tagFilter, owingOnly, sort, dir],
  );
  const summary = summarize(shown);
  const owingKnown = !!balances.data;

  const sortBy = (next: MemberSort) => {
    if (next === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(next);
      setDir(defaultDir(next));
    }
  };
  const open = (id: string) => navigate({ to: "/members/$memberId", params: { memberId: id } });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Members"
        subtitle="Everybody on your list, their branch and what they owe today."
        action={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="lg">
                <Link to="/members/import">Import from Excel</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/members/brought-forward">Owed from before</Link>
              </Button>
              <AddBranchDialog onDone={invalidate} />
              <AddMemberDialog branches={branches.data ?? []} onDone={invalidate} />
            </div>
          ) : null
        }
      />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <SearchBox value={search} onChange={setSearch} className="min-w-48 max-w-sm flex-1" />
          {allTags.length > 0 && (
            <div className="w-40">
              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger aria-label="Filter by label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All labels</SelectItem>
                  {allTags.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            type="button"
            variant={owingOnly ? "default" : "outline"}
            aria-pressed={owingOnly}
            onClick={() => setOwingOnly(!owingOnly)}
          >
            Owing only
          </Button>
          {isMobile && (
            <div className="w-40">
              <Select
                value={`${sort}:${dir}`}
                onValueChange={(v) => {
                  const [s, d] = v.split(":") as [MemberSort, SortDir];
                  setSort(s);
                  setDir(d);
                }}
              >
                <SelectTrigger aria-label="Sort members">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name:asc">Name A–Z</SelectItem>
                  <SelectItem value="name:desc">Name Z–A</SelectItem>
                  <SelectItem value="owing:desc">Owes most</SelectItem>
                  <SelectItem value="owing:asc">Owes least</SelectItem>
                  <SelectItem value="branch:asc">Branch</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {members.data && (
          <p className="text-sm text-muted-foreground">
            {summary.members.toLocaleString("en-NG")} {summary.members === 1 ? "member" : "members"}
            {owingKnown &&
              (summary.owing > 0
                ? ` · ${summary.owing.toLocaleString("en-NG")} owing ${naira(summary.total)}`
                : " · nobody owing")}
          </p>
        )}
      </div>

      {members.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title="No members here"
          hint={
            rows.length > 0
              ? "Nobody matches. Clear the search or filters to see everyone."
              : "Add your first member — name, phone and branch is all you need."
          }
        />
      ) : isMobile ? (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {shown.map((m) => (
            <li key={m.id}>
              <Link
                to="/members/$memberId"
                params={{ memberId: m.id }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.name}</span>
                    {!m.active && <Badge variant="outline">Not active</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[m.phone || "No phone", m.branch].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Owing value={m.owing} known={owingKnown} />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHead
                  label="Name"
                  col="name"
                  className="pl-5"
                  sort={sort}
                  dir={dir}
                  onSort={sortBy}
                />
                <SortHead label="Phone" col="phone" sort={sort} dir={dir} onSort={sortBy} />
                <SortHead label="Branch" col="branch" sort={sort} dir={dir} onSort={sortBy} />
                <SortHead
                  label="Amount owed"
                  col="owing"
                  sort={sort}
                  dir={dir}
                  onSort={sortBy}
                  right
                />
                <TableHead className="w-10">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((m) => (
                <TableRow key={m.id} className="cursor-pointer" onClick={() => open(m.id)}>
                  <TableCell className="max-w-80 py-2.5 pl-5">
                    <span className="flex min-w-0 items-center gap-2">
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: m.id }}
                        className="truncate font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {m.name}
                      </Link>
                      {!m.active && <Badge variant="outline">Not active</Badge>}
                      {m.tags.length > 0 && (
                        <span
                          className="truncate text-xs text-muted-foreground"
                          title={m.tags.join(", ")}
                        >
                          {m.tags.join(", ")}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 text-muted-foreground">
                    {m.phone || "—"}
                  </TableCell>
                  <TableCell className="py-2.5 text-muted-foreground">{m.branch ?? "—"}</TableCell>
                  <TableCell className="py-2.5 text-right">
                    <Owing value={m.owing} known={owingKnown} />
                  </TableCell>
                  <TableCell className="py-2.5 pr-4">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** What a member owes: red when they owe, "Paid up" when not, a dash for inactive members. */
function Owing({ value, known }: { value: number | null; known: boolean }) {
  if (value === null || !known) return <span className="text-sm text-muted-foreground">—</span>;
  return value > 0 ? (
    <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-destructive">
      {naira(value)}
    </span>
  ) : (
    <span className="whitespace-nowrap text-sm text-success">Paid up</span>
  );
}

export function TagPicker({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = (tag: string) => {
    const clean = tag.trim();
    if (!clean || tags.includes(clean)) return;
    onChange([...tags, clean]);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="m-tags">Labels (optional)</Label>
      <div className="flex gap-2">
        <Input
          id="m-tags"
          value={draft}
          placeholder="New"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
              setDraft("");
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            add(draft);
            setDraft("");
          }}
        >
          Add
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestedTags
          .filter((t) => !tags.includes(t))
          .map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary"
            >
              + {t}
            </button>
          ))}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary"
              title="Tap to remove"
            >
              {t} ✕
            </button>
          ))}
        </div>
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
  const [joinedOn, setJoinedOn] = useState(todayIso());
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? "");
  const [tags, setTags] = useState<string[]>([]);
  const [details, setDetails] = useState(emptyDetails);
  const [owedBefore, setOwedBefore] = useState<DebtLine[]>([emptyDebtLine()]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: added, error } = await supabase
        .from("members")
        .insert({
          org_id: orgId!,
          name,
          phone: phone || null,
          joined_on: joinedOn,
          branch_id: branchId || null,
          tags,
          ...detailsToRow(details),
        })
        .select("id")
        .single();
      if (error) throw error;
      const debts = filledDebtLines(owedBefore);
      if (debts.length) {
        const { error: debtError } = await supabase
          .from("brought_forward_debts")
          .insert(debts.map((d) => ({ ...d, org_id: orgId!, member_id: added.id })));
        if (debtError) {
          throw new Error(
            `${name} was added, but what they owed from before was not saved (${friendlyError(debtError)}). Add it on their profile under “Owed from before”.`,
          );
        }
      }
      return debts.reduce((s, d) => s + d.amount, 0);
    },
    onSuccess: (owed) => {
      toast.success(owed > 0 ? `Member added, owing ${naira(owed)} from before` : "Member added");
      setName("");
      setPhone("");
      setTags([]);
      setDetails(emptyDetails);
      setOwedBefore([emptyDebtLine()]);
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="gap-2">
          <Plus className="size-4" /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Name, phone, branch and labels. Open “More details” for email, address, date of birth
            and next of kin — all optional.
          </DialogDescription>
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
            <Label htmlFor="m-joined">Joined on</Label>
            <Input
              id="m-joined"
              type="date"
              required
              value={joinedOn}
              onChange={(e) => setJoinedOn(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              They owe dues from this date. For long-standing members, use when they really joined.
            </p>
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
          <TagPicker tags={tags} onChange={setTags} />
          <fieldset className="space-y-2 rounded-2xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">
              Did they owe anything before you started using FinSeka?
            </legend>
            <p className="text-xs text-muted-foreground">
              Optional. Bring forward what your old book says they owe, one line per thing. It
              counts in what they owe; money only enters the ledger when they pay.
            </p>
            <DebtLinesEditor value={owedBefore} onChange={setOwedBefore} idPrefix="m" />
          </fieldset>
          <MemberDetailsFields value={details} onChange={setDetails} idPrefix="m" />
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
    onError: (e: Error) => toast.error(friendlyError(e)),
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
