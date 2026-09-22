import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { methodLabels, type PayMethod } from "@/lib/methods";

export function MethodSelect({
  value,
  onChange,
  label = "Cash or bank transfer?",
}: {
  value: PayMethod;
  onChange: (value: PayMethod) => void;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as PayMethod)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cash">{methodLabels.cash}</SelectItem>
          <SelectItem value="transfer">{methodLabels.transfer}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
