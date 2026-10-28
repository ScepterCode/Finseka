import { Link } from "@tanstack/react-router";
import { FileSpreadsheet, Users } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

/** First step for a new organization: get its members in, from a spreadsheet or one by one. */
export function AddMembersCard({ memberCount }: { memberCount: number }) {
  const { isAdmin } = useAuth();
  if (!isAdmin || memberCount > 0) return null;

  return (
    <section className="rounded-3xl border border-primary/30 bg-primary-soft/40 p-6 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Users className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">Start by adding your members</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Have them in Excel already? Import the whole list in one go, with what each member owed
            from before if you like. You check everything before it is saved.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild className="gap-2">
          <Link to="/members/import">
            <FileSpreadsheet className="size-4" /> Import from Excel or CSV
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/members">Add them one by one</Link>
        </Button>
      </div>
    </section>
  );
}
