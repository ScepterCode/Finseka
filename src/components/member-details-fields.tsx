import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { detailsList, type MemberDetails } from "@/lib/member-details";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A folded section of optional fields: tap "More details" to open it. */
export function MemberDetailsFields({
  value,
  onChange,
  idPrefix,
}: {
  value: MemberDetails;
  onChange: (value: MemberDetails) => void;
  idPrefix: string;
}) {
  const filled = detailsList(value).length;
  const [open, setOpen] = useState(filled > 0);
  const set = (key: keyof MemberDetails) => (v: string) => onChange({ ...value, [key]: v });
  const id = (k: string) => `${idPrefix}-${k}`;

  return (
    <div className="rounded-2xl border border-border">
      <Button
        type="button"
        variant="ghost"
        className="flex h-auto w-full items-center justify-between rounded-2xl px-4 py-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          <span className="block font-medium">More details (optional)</span>
          <span className="block text-xs font-normal text-muted-foreground">
            Email, gender, date of birth, address, occupation, next of kin
            {filled > 0 ? ` · ${filled} filled in` : ""}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Button>
      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <div className="space-y-2">
            <Label htmlFor={id("email")}>Email</Label>
            <Input
              id={id("email")}
              type="email"
              value={value.email}
              onChange={(e) => set("email")(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select
                value={value.gender || "none"}
                onValueChange={(v) => set("gender")(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not given</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={id("dob")}>Date of birth</Label>
              <Input
                id={id("dob")}
                type="date"
                value={value.dateOfBirth}
                onChange={(e) => set("dateOfBirth")(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("address")}>Address</Label>
            <Input
              id={id("address")}
              value={value.address}
              onChange={(e) => set("address")(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("occupation")}>Occupation</Label>
            <Input
              id={id("occupation")}
              value={value.occupation}
              onChange={(e) => set("occupation")(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={id("kin")}>Next of kin</Label>
              <Input
                id={id("kin")}
                value={value.nextOfKinName}
                onChange={(e) => set("nextOfKinName")(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={id("kin-phone")}>Next of kin's phone</Label>
              <Input
                id={id("kin-phone")}
                value={value.nextOfKinPhone}
                onChange={(e) => set("nextOfKinPhone")(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
