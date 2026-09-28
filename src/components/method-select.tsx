import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { channels, type PayChannel, type PaymentMode } from "@/lib/methods";

/** How the money moved, and an optional reference (bank, transfer ref, receipt number). */
export function PaymentModeFields({
  value,
  onChange,
  label = "How was it paid?",
}: {
  value: PaymentMode;
  onChange: (value: PaymentMode) => void;
  label?: string;
}) {
  const hint = channels.find((c) => c.value === value.channel)?.hint;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={value.channel}
          onValueChange={(v) => onChange({ ...value, channel: v as PayChannel })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {channels.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="pay-reference">Reference (optional)</Label>
        <Input
          id="pay-reference"
          maxLength={100}
          value={value.reference}
          onChange={(e) => onChange({ ...value, reference: e.target.value })}
          placeholder={
            value.channel === "cash" ? "Receipt number" : "Bank, transfer reference or receipt"
          }
        />
      </div>
    </div>
  );
}
