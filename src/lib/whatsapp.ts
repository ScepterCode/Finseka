import { naira } from "@/lib/format";

/**
 * Turns a Nigerian phone number into WhatsApp's international form (digits only),
 * e.g. "0803 123 4567" -> "2348031234567". Returns null if it does not look like one.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = "234" + digits.slice(1);
  if (digits.length === 10 && /^[789]/.test(digits)) digits = "234" + digits;
  return /^234[789]\d{9}$/.test(digits) ? digits : null;
}

/** A wa.me link that opens WhatsApp with the message ready. Without a valid number,
 *  WhatsApp asks who to send it to. */
export function whatsappLink(phone: string | null | undefined, message: string) {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(message)}`;
}

export function reminderMessage(opts: {
  memberName: string;
  orgName: string;
  what: string;
  amount: number;
}) {
  const first = opts.memberName.trim().split(/\s+/)[0] || opts.memberName;
  return (
    `Hello ${first}, this is a friendly reminder from ${opts.orgName}: ` +
    `${naira(opts.amount)} is still outstanding for ${opts.what}. ` +
    `Please pay when you can. Thank you!`
  );
}
