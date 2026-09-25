import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Asks why before cancelling a payment or reversing a ledger line. The reason is kept in the history. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onConfirm(reason.trim());
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="reason">Why? (everyone on the team can see this)</Label>
            <Input
              id="reason"
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Recorded for the wrong member"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full bg-destructive text-white hover:bg-destructive/90"
            disabled={pending || !ok}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} {confirmLabel}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
