import { MessageCircle, Printer } from "lucide-react";

import { naira, shortDate } from "@/lib/format";
import { statementMessage, type StatementEntry } from "@/lib/statement";
import { whatsappLink } from "@/lib/whatsapp";
import { EmptyState } from "@/components/page-parts";
import { Button } from "@/components/ui/button";

/** Everything a member was charged and paid, oldest first, with a running balance. */
export function MemberStatement({
  entries,
  owing,
  memberName,
  phone,
  orgName,
}: {
  entries: StatementEntry[];
  owing: number;
  memberName: string;
  phone: string | null;
  orgName: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing on the statement yet"
        hint="Charges appear here once dues or compulsory contributions apply to this member."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="print-hide flex flex-wrap gap-2">
        <Button variant="outline" className="gap-2" onClick={() => window.print()}>
          <Printer className="size-4" /> Print statement
        </Button>
        <Button asChild variant="outline" className="gap-2">
          <a
            href={whatsappLink(phone, statementMessage({ memberName, orgName, owing, entries }))}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="size-4" /> Share on WhatsApp
          </a>
        </Button>
      </div>

      <div className="hidden print:block">
        <p className="font-display text-xl font-semibold">{orgName}</p>
        <p className="text-sm">
          Statement for {memberName} · as of {shortDate(new Date())}
        </p>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3 text-right">Charged</th>
              <th className="px-4 py-3 text-right">Paid</th>
              <th className="px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                  {shortDate(e.date)}
                </td>
                <td className="px-4 py-2.5">{e.text}</td>
                <td className="px-4 py-2.5 text-right">{e.charged ? naira(e.charged) : ""}</td>
                <td className="px-4 py-2.5 text-right text-success">
                  {e.paid ? naira(e.paid) : ""}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium ${e.balance > 0 ? "text-destructive" : ""}`}
                >
                  {e.balance < 0 ? `${naira(-e.balance)} ahead` : naira(e.balance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-secondary/60">
              <td className="px-4 py-3 font-semibold" colSpan={4}>
                Owing now
              </td>
              <td
                className={`px-4 py-3 text-right font-semibold ${owing > 0 ? "text-destructive" : "text-success"}`}
              >
                {naira(owing)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Freewill gifts are not on the statement because nobody owed them; they are in the payment
        history. If someone paid more than a period asked, the balance shows it as “ahead”, but the
        extra does not pay other periods.
      </p>
    </div>
  );
}
