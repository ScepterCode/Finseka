export type PayMethod = "cash" | "transfer";

export const methodLabels: Record<PayMethod, string> = {
  cash: "Cash",
  transfer: "Bank transfer",
};

export function methodShort(method: string | null | undefined) {
  return method === "transfer" ? "Transfer" : "Cash";
}
