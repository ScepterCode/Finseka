import { useState } from "react";

import { matchesPerson } from "@/lib/search";
import { useAudienceOptions, type Audience, type AudienceValue } from "@/lib/audience";
import { SearchBox } from "@/components/search-box";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DueAudienceFields({
  value,
  onChange,
  orgId,
}: {
  value: AudienceValue;
  onChange: (v: AudienceValue) => void;
  orgId: string | null;
}) {
  const options = useAudienceOptions(orgId);
  const [search, setSearch] = useState("");
  const opts = options.data;

  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Who pays?</Label>
        <Select
          value={value.audience}
          onValueChange={(a) => onChange({ ...value, audience: a as Audience })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="everyone">Everyone</SelectItem>
            <SelectItem value="labels">Members with certain labels</SelectItem>
            <SelectItem value="branches">Members in certain branches</SelectItem>
            <SelectItem value="people">Specific people</SelectItem>
          </SelectContent>
        </Select>
        {value.audience !== "everyone" && (
          <p className="text-xs text-muted-foreground">
            Whoever matches owes it, including people who match later. Anyone who has already paid
            something towards it stays on it.
          </p>
        )}
      </div>

      {value.audience === "labels" &&
        (opts && opts.labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No labels yet. Give members a label (for example “new”) from their profile first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(opts?.labels ?? []).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => onChange({ ...value, labels: toggle(value.labels, t) })}
              >
                <Badge
                  variant={value.labels.includes(t) ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1 text-sm"
                >
                  {t}
                </Badge>
              </button>
            ))}
          </div>
        ))}

      {value.audience === "branches" && (
        <div className="flex flex-wrap gap-2">
          {(opts?.branches ?? []).map((b) => (
            <button
              type="button"
              key={b.id}
              onClick={() => onChange({ ...value, branchIds: toggle(value.branchIds, b.id) })}
            >
              <Badge
                variant={value.branchIds.includes(b.id) ? "default" : "outline"}
                className="cursor-pointer px-3 py-1 text-sm"
              >
                {b.name}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {value.audience === "people" && (
        <div className="space-y-2">
          <SearchBox value={search} onChange={setSearch} />
          <p className="text-xs text-muted-foreground">{value.memberIds.length} picked</p>
          <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-2xl border border-border">
            {(opts?.members ?? [])
              .filter((m) => matchesPerson(search, m.name, m.phone))
              .map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm">
                    <Checkbox
                      checked={value.memberIds.includes(m.id)}
                      onCheckedChange={() =>
                        onChange({ ...value, memberIds: toggle(value.memberIds, m.id) })
                      }
                    />
                    {m.name}
                  </label>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
