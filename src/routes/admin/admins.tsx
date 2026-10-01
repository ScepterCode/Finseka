import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { addSuperAdmin, type AddAdminResult } from "@/lib/admin.functions";
import { when } from "@/lib/admin-activity";
import { friendlyError } from "@/lib/errors";
import { shortDate } from "@/lib/format";
import { PageHeader } from "@/components/page-parts";
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
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/admins")({
  component: SuperAdminsPage,
});

function SuperAdminsPage() {
  const queryClient = useQueryClient();
  const add = useServerFn(addSuperAdmin);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [added, setAdded] = useState<AddAdminResult | null>(null);

  const admins = useQuery({
    queryKey: ["admin", "admins"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_admins");
      if (error) throw error;
      return data;
    },
  });

  const addAdmin = useMutation({
    mutationFn: async () => add({ data: { email, fullName } }),
    onSuccess: (r) => {
      setEmail("");
      setFullName("");
      setAdded(r);
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("remove_platform_admin", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed as a super admin");
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <div className="space-y-10">
      <PageHeader
        title="Super admins"
        subtitle="People who can see every organization, open one as support, and wipe one out. Keep this list short."
      />

      <section className="space-y-3">
        <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Added</th>
                <th className="px-4 py-3 font-medium">Last signed in</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(admins.data ?? []).map((a) => (
                <tr key={a.user_id}>
                  <td className="px-4 py-3 font-medium">
                    {a.full_name || "—"} {a.is_you && <Badge variant="secondary">You</Badge>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{a.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {shortDate(a.added_at)}
                    {a.added_by_email && (
                      <span className="block text-xs">by {a.added_by_email}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {a.last_sign_in_at ? when(a.last_sign_in_at) : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/admin/activity" search={{ admin: a.user_id }}>
                          Their activity
                        </Link>
                      </Button>
                      {!a.is_you && (
                        <ConfirmButton
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          title={`Remove ${a.email ?? "this person"} as a super admin?`}
                          description="They keep their FinSeka login but lose the System admin console at once, and any support session they have open ends."
                          confirmLabel="Yes, remove"
                          destructive
                          onConfirm={() => remove.mutate(a.user_id)}
                        >
                          <Trash2 className="size-4" /> Remove
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-lg space-y-4 rounded-3xl border border-border bg-card p-6 shadow-soft">
        <div>
          <h2 className="font-display text-lg font-semibold">Add a super admin</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            If the email already has a FinSeka login (including Google sign-in), it is made a super
            admin and keeps signing in the same way. Otherwise a login is created with a temporary
            password for you to pass on.
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            addAdmin.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="sa-email">Email</Label>
            <Input
              id="sa-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ada@finseka.ng"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sa-name">Name (needed for a new login)</Label>
            <Input
              id="sa-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ada Obi"
            />
          </div>
          <Button type="submit" disabled={addAdmin.isPending || !email.trim()}>
            {addAdmin.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            Add super admin
          </Button>
        </form>
      </section>

      <Dialog open={!!added} onOpenChange={(o) => !o && setAdded(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{added?.email} is now a super admin</DialogTitle>
            <DialogDescription>
              {added?.password
                ? "A new login was created. Share this temporary password with them privately; they will choose their own the first time they sign in. It is shown only once."
                : "They already had a FinSeka login, so they sign in the same way as before and will see System admin."}
            </DialogDescription>
          </DialogHeader>
          {added?.password && (
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary px-4 py-3 font-mono text-sm">
              <span className="flex-1 select-all">{added.password}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(added.password!);
                  toast.success("Copied");
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          )}
          <Button size="lg" className="w-full" onClick={() => setAdded(null)}>
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
