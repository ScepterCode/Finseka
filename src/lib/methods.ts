// How money moved. The database keeps a simpler cash / transfer split alongside, for the
// cash and bank balances: cash is cash, every other mode counts as bank.

export type PayChannel =
  "cash" | "bank_transfer" | "pos" | "ussd" | "mobile_money" | "cheque" | "other";

export const channels: { value: PayChannel; label: string; hint: string }[] = [
  { value: "cash", label: "Cash", hint: "Notes and coins" },
  { value: "bank_transfer", label: "Bank transfer", hint: "Into the association's account" },
  { value: "pos", label: "POS", hint: "Card payment on a POS machine" },
  { value: "ussd", label: "USSD", hint: "e.g. *737# or *894#" },
  { value: "mobile_money", label: "Mobile money", hint: "OPay, PalmPay, Moniepoint and similar" },
  { value: "cheque", label: "Cheque", hint: "" },
  { value: "other", label: "Other", hint: "" },
];

const labels = Object.fromEntries(channels.map((c) => [c.value, c.label])) as Record<
  PayChannel,
  string
>;

export function channelLabel(channel: string | null | undefined, method?: string | null) {
  if (channel && channel in labels) return labels[channel as PayChannel];
  return method === "transfer" ? "Bank transfer" : "Cash";
}

/** e.g. "POS · Moniepoint 4471", or just "Cash". */
export function paymentModeText(
  channel: string | null | undefined,
  reference?: string | null,
  method?: string | null,
) {
  const label = channelLabel(channel, method);
  return reference ? `${label} · ${reference}` : label;
}

/** Short form for tight spaces such as table badges. */
export function methodShort(method: string | null | undefined, channel?: string | null) {
  return channelLabel(channel, method);
}

export type PaymentMode = { channel: PayChannel; reference: string };

export const defaultPaymentMode: PaymentMode = { channel: "cash", reference: "" };
