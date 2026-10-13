import { useState } from "react";
import { Plus, X } from "lucide-react";

import { matchesPerson } from "@/lib/search";
import { SearchBox } from "@/components/search-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Pick a contribution's committee: tick members (searchable), or type in someone who is not on
 * the members list. The committee is kept as names, so people outside the organization can be on it.
 */
export function CommitteePicker({
  value,
  onChange,
  members,
  idPrefix,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  members: { id: string; name: string; phone?: string | null }[];
  idPrefix: string;
}) {
  const [search, setSearch] = useState("");
  const [outsider, setOutsider] = useState("");
  const has = (name: string) => value.some((n) => n.toLowerCase() === name.toLowerCase());
  const add = (name: string) => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean && !has(clean)) onChange([...value, clean]);
  };
  const remove = (name: string) => onChange(value.filter((n) => n !== name));
  const shown = members.filter((m) => matchesPerson(search, m.name, m.phone));

  return (
    <div className="space-y-2">
      <Label>Committee ({value.length})</Label>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((n) => (
            <Badge key={n} variant="secondary" className="gap-1 pr-1">
              {n}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background"
                aria-label={`Remove ${n} from the committee`}
                onClick={() => remove(n)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nobody on the committee yet.</p>
      )}

      <div className="space-y-2 rounded-2xl border border-border p-3">
        {members.length > 8 && (
          <SearchBox value={search} onChange={setSearch} placeholder="Find a member" />
        )}
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {shown.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">
              {members.length === 0 ? "No members yet." : "No member matches."}
            </p>
          )}
          {shown.map((m) => (
            <label key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm">
              <Checkbox
                checked={has(m.name)}
                onCheckedChange={(v) =>
                  v
                    ? add(m.name)
                    : onChange(value.filter((n) => n.toLowerCase() !== m.name.toLowerCase()))
                }
              />
              {m.name}
            </label>
          ))}
        </div>
        <div className="flex gap-2 border-t border-border pt-2">
          <Input
            id={`${idPrefix}-committee-other`}
            aria-label="Someone not on the members list"
            placeholder="Someone not on the members list"
            maxLength={100}
            value={outsider}
            onChange={(e) => setOutsider(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(outsider);
                setOutsider("");
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            disabled={!outsider.trim()}
            onClick={() => {
              add(outsider);
              setOutsider("");
            }}
          >
            <Plus className="size-4" /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}
