import { useState } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, LogIn, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { wipeOrganization, type WipeResult } from "@/lib/admin.functions";
import { fileSlug } from "@/lib/csv";
import { friendlyError } from "@/lib/errors";
import { shortDate, todayIso } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { SearchBox } from "@/components/search-box";
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

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "System admin — FinSeka" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminPage,
});

type OrgRow = {
  id: string;
  name: string;
  created_at: string;
  members: number;
  team: number;
  admin_emails: string | null;
  last_activity: string | null;
};

const actionText: Record<string, string> = {
  support_start: "opened as support",
  support_end: "ended support session in",
  export: "downloaded a copy of",
  wipe: "wiped out",
  wipe_logins: "deleted the logins of",
};

function AdminPage() {
  const { isPlatformAdmin, loadingProfile } = useAuth();
  const [search, setSearch] = useState("");
  const [supportFor, setSupportFor] = useState<OrgRow | null>(null);
  const [wipeFor, setWipeFor] = useState<OrgRow | null>(null);

  const orgs = useQuery({
    queryKey: ["admin-orgs", search.trim()],
    enabled: isPlatformAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_org_list", {
        ...(search.trim() ? { _search: search.trim() } : {}),
      });
      if (error) throw error;
      return data as OrgRow[];
    },
  });

  const activity = useQuery({
    queryKey: ["admin-activity"],
    enabled: isPlatformAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_activity", { _limit: 30 });
      if (error) throw error;
      return data;
    },
  });

  if (loadingProfile) return null;
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-10">
      <PageHeader
        title="System admin"
        subtitle="Every organization on FinSeka. Counts only; open one as support to see its records."
      />

      <section className="space-y-4">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search by organization name or admin email"
          className="max-w-md"
        />
        {orgs.isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (orgs.data ?? []).length === 0 ? (
          <EmptyState title="No organizations found" hint="Try another name or email." />
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Admins</th>
                  <th className="px-4 py-3 text-right font-medium">Members</th>
                  <th className="px-4 py-3 text-right font-medium">Team</th>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(orgs.data ?? []).map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-3">
                      <span className="block font-medium">{o.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        Joined {shortDate(o.created_at)}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                      {o.admin_emails ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.members}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.team}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {o.last_activity ? shortDate(o.last_activity) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSupportFor(o)}>
                          <LogIn className="size-4" /> Open as support
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setWipeFor(o)}
                        >
                          <Trash2 className="size-4" /> Wipe out
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(orgs.data ?? []).length === 200 && (
          <p className="text-xs text-muted-foreground">
            Showing the newest 200. Search to find others.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Recent admin activity</h2>
        {(activity.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card text-sm shadow-soft">
            {(activity.data ?? []).map((a) => (
              <li key={a.id} className="px-5 py-3">
                <span className="font-medium">{a.admin_email ?? "A system admin"}</span>{" "}
                {actionText[a.action] ?? a.action}{" "}
                <span className="font-medium">{a.org_name ?? "an organization"}</span>
                {a.reason && <span className="text-muted-foreground"> — {a.reason}</span>}
                <span className="block text-xs text-muted-foreground">
                  {new Date(a.at).toLocaleString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SupportDialog org={supportFor} onClose={() => setSupportFor(null)} />
      <WipeDialog org={wipeFor} onClose={() => setWipeFor(null)} />
    </div>
  );
}

function SupportDialog({ org, onClose }: { org: OrgRow | null; onClose: () => void }) {
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

function WipeDialog({ org, onClose }: { org: OrgRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const wipe = useServerFn(wipeOrganization);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [result, setResult] = useState<WipeResult | null>(null);

  function reset() {
    setReason("");
    setTyped("");
    setDownloaded(false);
    setResult(null);
    onClose();
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
      queryClient.invalidateQueries({ queryKey: ["admin-orgs"] });
      queryClient.invalidateQueries({ queryKey: ["admin-activity"] });
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
                  ` ${result.loginsFailed} login(s) could not be deleted; check the admin activity.`}
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
                <Label htmlFor="wipe-reason">Why? (kept in the admin activity)</Label>
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
