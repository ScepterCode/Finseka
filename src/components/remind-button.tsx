import { MessageCircle } from "lucide-react";

import { reminderMessage, whatsappLink, whatsappNumber } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";

/** Opens WhatsApp with a polite reminder ready to send. Nothing is sent automatically. */
export function RemindButton({
  phone,
  memberName,
  orgName,
  what,
  amount,
  size = "sm",
}: {
  phone: string | null | undefined;
  memberName: string;
  orgName: string;
  what: string;
  amount: number;
  size?: "sm" | "default";
}) {
  if (amount <= 0) return null;
  const hasNumber = !!whatsappNumber(phone);
  return (
    <Button
      asChild
      size={size}
      variant="outline"
      className="print-hide gap-1.5 border-success/40 text-success hover:text-success"
      title={
        hasNumber
          ? `Send ${memberName} a reminder on WhatsApp`
          : "No valid phone saved — WhatsApp will ask who to send it to"
      }
    >
      <a
        href={whatsappLink(phone, reminderMessage({ memberName, orgName, what, amount }))}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MessageCircle className="size-4" /> Remind
      </a>
    </Button>
  );
}
