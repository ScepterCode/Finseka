import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Drive = {
  id: string;
  name: string;
  description: string | null;
  target_amount: number | null;
  closes_on: string | null;
};

/** Start a pledge drive, or edit one when `drive` is given. */
export function DriveDialog({ drive }: { drive?: Drive }) {
  const { orgId } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [closesOn, setClosesOn] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        name: name.trim(),
        description: description.trim() || null,
        target_amount: target ? Number(target) : null,
        closes_on: closesOn || null,
      };
      if (drive) {
        const { error } = await supabase.from("pledge_drives").update(fields).eq("id", drive.id);
        if (error) throw error;
        return drive.id;
      }
      const { data, error } = await supabase
        .from("pledge_drives")
        .insert({ org_id: orgId!, ...fields })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      toast.success(drive ? "Pledge drive updated" : "Pledge drive started");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["pledge-drives"] });
      queryClient.invalidateQueries({ queryKey: ["pledges"] });
      if (!drive) void navigate({ to: "/pledges/$driveId", params: { driveId: id } });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setName(drive?.name ?? "");
          setDescription(drive?.description ?? "");
          setTarget(drive?.target_amount == null ? "" : String(drive.target_amount));
          setClosesOn(drive?.closes_on ?? "");
        }
      }}
    >
      {drive ? (
        <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      ) : (
        <Button size="lg" variant="outline" className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> New pledge drive
        </Button>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{drive ? `Edit ${drive.name}` : "Start a pledge drive"}</DialogTitle>
          <DialogDescription>
            An appeal people pledge towards — members or anyone else. Example: Church roof, Town
            hall project, Scholarship fund.
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
            <Label htmlFor="pd-name">Name</Label>
            <Input id="pd-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pd-desc">What is it for? (optional)</Label>
            <Textarea
              id="pd-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pd-target">Target (₦, optional)</Label>
              <Input
                id="pd-target"
                type="number"
                min="0"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pd-closes">Closes on (optional)</Label>
              <Input
                id="pd-closes"
                type="date"
                value={closesOn}
                onChange={(e) => setClosesOn(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}{" "}
            {drive ? "Save changes" : "Start the drive"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
