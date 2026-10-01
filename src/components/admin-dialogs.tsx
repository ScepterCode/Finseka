import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { wipeOrganization, type WipeResult } from "@/lib/admin.functions";
import { fileSlug } from "@/lib/csv";
import { friendlyError } from "@/lib/errors";
import { todayIso } from "@/lib/format";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type OrgRef = { id: string; name: string };

/** Starts a support session in an organization and takes the super admin into its app. */
export function SupportDialog({ org, onClose }: { org: OrgRef | null; onClose: () => void }) {
  const { refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("60");

  const start = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("start_support_session", {
        _org_id: org!.id,
        _reason: reason.trim(),
        _minutes: Number(minutes),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      // Nothing from the previous organization may stay on screen.
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      refreshMe();
      setReason("");
      onClose();
      navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open {org?.name} as support</DialogTitle>
          <DialogDescription>
            You will see and can change their records as an admin would. Everything you change is
            recorded as “FinSeka support” with your name, and their History shows that you opened
            their records and why.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="support-reason">Why? (they can see this)</Label>
            <Input
              id="support-reason"
              required
              minLength={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Treasurer asked for help fixing a payment"
            />
          </div>
          <div className="space-y-2">
            <Label>For how long</Label>
            <Select value={minutes} onValueChange={setMinutes}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="120">2 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={start.isPending || reason.trim().length < 5}
          >
            {start.isPending && <Loader2 className="size-4 animate-spin" />} Open their records
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Downloads a copy, then wipes the organization out once its name is typed and a reason given. */
export function WipeDialog({
  org,
  onClose,
  onWiped,
}: {
  org: OrgRef | null;
  onClose: () => void;
  onWiped?: () => void;
}) {
  const queryClient = useQueryClient();
  const wipe = useServerFn(wipeOrganization);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [result, setResult] = useState<WipeResult | null>(null);

  function reset() {
    const wasWiped = !!result;
    setReason("");
    setTyped("");
    setDownloaded(false);
    setResult(null);
    onClose();
    if (wasWiped) onWiped?.();
  }

  const download = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_export_org", { _org_id: org!.id });
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finseka-${fileSlug(org!.name)}-${todayIso()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => setDownloaded(true),
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const destroy = useMutation({
    mutationFn: async () =>
      wipe({ data: { orgId: org!.id, confirmName: typed, reason: reason.trim() } }),
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const nameMatches = !!org && typed.trim() === org.name.trim();
  const ready = downloaded && nameMatches && reason.trim().length >= 5;

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && !destroy.isPending && reset()}>
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{result.name} has been wiped out</DialogTitle>
              <DialogDescription>
                Its records are gone. {result.loginsDeleted} login
                {result.loginsDeleted === 1 ? " was" : "s were"} deleted, so those emails can sign
                up again.
                {result.loginsFailed > 0 &&
                  ` ${result.loginsFailed} login(s) could not be deleted; check the activity log.`}
              </DialogDescription>
            </DialogHeader>
            <Button size="lg" className="w-full" onClick={reset}>
              Done
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Wipe out {org?.name}?</DialogTitle>
              <DialogDescription>
                This permanently deletes the organization, every member, due, payment, pledge and
                ledger line, and the logins of everyone on its team. It cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (ready) destroy.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="wipe-reason">Why? (kept in the activity log)</Label>
                <Textarea
                  id="wipe-reason"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="The organization asked to close its account"
                />
              </div>
              <div className="space-y-2">
                <Label>1. Download a copy of their records</Label>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={download.isPending}
                  onClick={() => download.mutate()}
                >
                  {download.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {downloaded ? "Copy downloaded — download again" : "Download a copy"}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wipe-name">
                  2. Type <strong>{org?.name}</strong> to confirm
                </Label>
                <Input
                  id="wipe-name"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-invalid={typed !== "" && !nameMatches}
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full bg-destructive text-white hover:bg-destructive/90"
                disabled={!ready || destroy.isPending}
              >
                {destroy.isPending && <Loader2 className="size-4 animate-spin" />} Wipe out
                permanently
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
