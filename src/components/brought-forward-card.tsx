import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { BookOpenCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";

/**
 * One-time step for admins of a new organization: bring forward what members already owed in
 * the old book, the way the opening balance brings forward cash. Hidden once done or skipped.
 */
export function BroughtForwardCard() {
  const { isAdmin, org, refreshMe } = useAuth();

  const skip = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_brought_forward_done", { _done: true });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Got it. You can still add old debts on any member’s profile.");
      refreshMe();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (!isAdmin || !org || org.brought_forward_done !== false) return null;

  return (
    <section className="rounded-3xl border border-primary/30 bg-primary-soft/40 p-6 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <BookOpenCheck className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">
            Did any members owe money before FinSeka?
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Bring forward what your old book says each member owes, so nothing is lost. Tip: start
            your dues from the month you began using FinSeka, and bring older debts forward here
            instead of entering years of old periods.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/members/brought-forward">Bring forward what members owe</Link>
        </Button>
        <Button variant="outline" disabled={skip.isPending} onClick={() => skip.mutate()}>
          {skip.isPending && <Loader2 className="size-4 animate-spin" />} Nobody owed anything
        </Button>
      </div>
    </section>
  );
}
