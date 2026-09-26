import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Add or remove the people a contribution applies to after it was created, e.g. someone
 * who joined late. Removing someone who already paid keeps their payment; it then shows
 * as a freewill gift instead of a debt.
 */
export function ContributionPeopleDialog({
  contributionId,
  orgId,
  picked,
  paidIds,
  onDone,
}: {
  contributionId: string;
  orgId: string;
  picked: string[];
  paidIds: Set<string>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(picked));
  const [search, setSearch] = useState("");

  const members = useQuery({
    queryKey: ["members-simple", orgId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const before = useMemo(() => new Set(picked), [picked]);
  const toAdd = [...selected].filter((id) => !before.has(id));
  const toRemove = [...before].filter((id) => !selected.has(id));
  const removingPayers = toRemove.filter((id) => paidIds.has(id)).length;

  const save = useMutation({
    mutationFn: async () => {
      if (toAdd.length) {
        const { error } = await supabase.from("contribution_members").insert(
          toAdd.map((member_id) => ({
            org_id: orgId,
            contribution_id: contributionId,
            member_id,
          })),
        );
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await supabase
          .from("contribution_members")
          .delete()
          .eq("contribution_id", contributionId)
          .in("member_id", toRemove);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(
        [toAdd.length && `${toAdd.length} added`, toRemove.length && `${toRemove.length} removed`]
          .filter(Boolean)
          .join(", ") || "No changes",
      );
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const shown = (members.data ?? []).filter((m) =>
    m.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setSelected(new Set(picked));
          setSearch("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Users className="size-4" /> Change people
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Who is this contribution for?</DialogTitle>
          <DialogDescription>
            Tick everyone who should pay. {selected.size} picked.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {members.isLoading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-2xl border border-border">
            {shown.map((m) => (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm">
                  <Checkbox
                    checked={selected.has(m.id)}
                    onCheckedChange={(v) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(m.id);
                        else next.delete(m.id);
                        return next;
                      })
                    }
                  />
                  <span className="flex-1">{m.name}</span>
                  {paidIds.has(m.id) && (
                    <span className="text-xs text-muted-foreground">has paid</span>
                  )}
                </label>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody found.</li>
            )}
          </ul>
        )}
        {removingPayers > 0 && (
          <p className="text-sm text-muted-foreground">
            {removingPayers === 1 ? "One person" : `${removingPayers} people`} you are removing
            already paid. Their payments stay and will show as freewill gifts.
          </p>
        )}
        <Button
          size="lg"
          className="w-full"
          disabled={save.isPending || (toAdd.length === 0 && toRemove.length === 0)}
          onClick={() => save.mutate()}
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Save changes
        </Button>
      </DialogContent>
    </Dialog>
  );
}
