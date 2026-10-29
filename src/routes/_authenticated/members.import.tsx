import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchAll } from "@/lib/fetch-all";
import { friendlyError } from "@/lib/errors";
import { naira, shortDate } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import {
  buildImportRows,
  guessMapping,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  newBranches,
  parseCsv,
  TEMPLATE_EXAMPLE,
  TEMPLATE_HEADINGS,
  type Cell,
  type FieldKey,
  type ImportRow,
  type Mapping,
} from "@/lib/member-import";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { ConfirmButton } from "@/components/confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/members/import")({
  head: () => ({
    meta: [{ title: "Import members — FinSeka" }, { name: "robots", content: "noindex" }],
  }),
  component: ImportMembersPage,
});

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SKIP = "skip";

type Loaded = { fileName: string; sheets: { name: string; table: Cell[][] }[]; sheet: number };
type Result = { import_id: string; members: number; branches: number; debts: number; owed: number };

function ImportMembersPage() {
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<Mapping>([]);
  const [names, setNames] = useState<Record<number, string>>({}); // names typed in for rows without one
  const [keepDuplicates, setKeepDuplicates] = useState<Set<number>>(new Set());
  const [owedLabel, setOwedLabel] = useState("Owed before FinSeka");
  const [result, setResult] = useState<Result | null>(null);

  const existing = useQuery({
    queryKey: ["members", orgId, "for-import"],
    enabled: !!orgId,
    queryFn: () =>
      fetchAll((from, to) =>
        supabase.from("members").select("id, name, phone").order("id").range(from, to),
      ),
  });
  const branches = useQuery({
    queryKey: ["branches", orgId],
    enabled: !!orgId,
    queryFn: () =>
      fetchAll((from, to) =>
        supabase.from("branches").select("id, name").order("name").order("id").range(from, to),
      ),
  });
  const imports = useQuery({
    queryKey: ["member-imports", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("member_imports")
        .select("id, file_name, member_count, branch_count, debt_total, undone_at, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const table = useMemo(() => (loaded ? (loaded.sheets[loaded.sheet]?.table ?? []) : []), [loaded]);
  const headings = table[0] ?? [];

  const rows: ImportRow[] = useMemo(() => {
    const built = buildImportRows(table, mapping, existing.data ?? []);
    // A name typed in on the page fixes a row that had none.
    return built.map((r) => {
      const typed = names[r.line]?.trim();
      return typed && !r.values.name
        ? { ...r, values: { ...r.values, name: typed }, errors: [] }
        : r;
    });
  }, [table, mapping, existing.data, names]);

  const willImport = rows.filter(
    (r) => r.errors.length === 0 && (!r.duplicateOf || keepDuplicates.has(r.line)),
  );
  const skipped = rows.length - willImport.length;
  const owedTotal = willImport.reduce((s, r) => s + (r.values.owed ?? 0), 0);
  const branchesToCreate = newBranches(willImport, branches.data ?? []);
  const nameMapped = mapping.includes("name");

  async function readFile(file: File) {
    setResult(null);
    if (file.size > MAX_FILE_BYTES) {
      toast.error("That file is over 5 MB. Remove extra sheets or columns and try again.");
      return;
    }
    const lower = file.name.toLowerCase();
    setReading(true);
    try {
      let sheets: Loaded["sheets"];
      if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
        sheets = [{ name: file.name, table: parseCsv(await file.text()) }];
      } else if (lower.endsWith(".xlsx")) {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        const all = await readXlsxFile(file);
        sheets = all
          .map((s) => ({
            name: s.sheet,
            table: (s.data as Cell[][]).filter((r) => r.some((c) => c != null && c !== "")),
          }))
          .filter((s) => s.table.length > 0);
      } else if (lower.endsWith(".xls")) {
        toast.error(
          "That is an old Excel file (.xls). In Excel, choose File → Save As → Excel Workbook (.xlsx), then upload it.",
        );
        return;
      } else {
        toast.error("Upload an Excel file (.xlsx) or a CSV file.");
        return;
      }
      if (sheets.length === 0 || (sheets[0]?.table.length ?? 0) < 2) {
        toast.error(
          "No members found. The first row should be headings, with one member per row below.",
        );
        return;
      }
      setLoaded({ fileName: file.name, sheets, sheet: 0 });
      resetForSheet(sheets[0]!.table);
    } catch {
      toast.error("That file could not be read. Save it again as .xlsx or CSV and try again.");
    } finally {
      setReading(false);
    }
  }

  function resetForSheet(t: Cell[][]) {
    setMapping(guessMapping(t[0] ?? []));
    setNames({});
    setKeepDuplicates(new Set());
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = willImport.map((r) => ({
        ...r.values,
        ...(r.values.owed ? { owed_label: owedLabel.trim() || "Owed before FinSeka" } : {}),
      }));
      const { data, error } = await supabase.rpc("import_members", {
        _rows: payload,
        _file_name: loaded?.fileName ?? "",
      });
      if (error) throw error;
      return data as unknown as Result;
    },
    onSuccess: (r) => {
      setResult(r);
      setLoaded(null);
      for (const key of [
        "members",
        "branches",
        "member-imports",
        "dashboard",
        "brought-forward-overview",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const undo = useMutation({
    mutationFn: async (importId: string) => {
      const { data, error } = await supabase.rpc("undo_member_import", { _import_id: importId });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast.success(`Import undone: ${n} ${n === 1 ? "member" : "members"} removed`);
      setResult(null);
      for (const key of ["members", "member-imports", "dashboard", "brought-forward-overview"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  function downloadTemplate() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    downloadCsv(
      "finseka-members-template.csv",
      [TEMPLATE_HEADINGS, TEMPLATE_EXAMPLE].map((r) => r.map(esc).join(",")).join("\r\n"),
    );
  }

  if (!isAdmin) {
    return (
      <EmptyState title="Admins only" hint="Ask an admin of your organization to import members." />
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link to="/members">
          <ArrowLeft className="size-4" /> All members
        </Link>
      </Button>
      <PageHeader
        title="Import members"
        subtitle="Bring in your members list from Excel or a CSV file. You check everything before it is saved."
      />

      {result && (
        <section className="rounded-3xl border border-success/40 bg-success/10 p-6 shadow-soft">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-semibold">
                {result.members} {result.members === 1 ? "member" : "members"} imported
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  result.branches > 0 &&
                    `${result.branches} new ${result.branches === 1 ? "branch" : "branches"}`,
                  result.debts > 0 && `${naira(result.owed)} brought forward for ${result.debts}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Everyone is on your members list now."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild>
                  <Link to="/members">See members</Link>
                </Button>
                <ConfirmButton
                  variant="outline"
                  className="gap-2"
                  title="Undo this import?"
                  description={`This removes the ${result.members} members it added (and what they owed from before). Use it if the wrong file or columns were used.`}
                  confirmLabel="Yes, undo it"
                  onConfirm={() => undo.mutate(result.import_id)}
                >
                  <Undo2 className="size-4" /> Undo this import
                </ConfirmButton>
              </div>
            </div>
          </div>
        </section>
      )}

      {!loaded && (
        <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
              <FileSpreadsheet className="size-5" />
            </span>
            <div className="min-w-0 space-y-2 text-sm text-muted-foreground">
              <p>
                Use your existing list: the <strong>first row must be headings</strong> (Name,
                Phone, Branch…) and each row below it one member. Only <strong>Name</strong> is
                required. A column for what each member owed from before brings it forward too.
              </p>
              <p>
                Starting from paper?{" "}
                <button type="button" className="link font-medium" onClick={downloadTemplate}>
                  <Download className="mr-1 inline size-3.5" />
                  Download the template
                </button>
                , fill it in Excel, and upload it here.
              </p>
            </div>
          </div>
          <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border px-6 py-10 text-center hover:border-primary/50 hover:bg-secondary/40">
            {reading ? (
              <Loader2 className="size-6 animate-spin text-primary" />
            ) : (
              <FileSpreadsheet className="size-6 text-primary" />
            )}
            <span className="font-medium">
              {reading ? "Reading the file…" : "Choose an Excel (.xlsx) or CSV file"}
            </span>
            <span className="text-xs text-muted-foreground">
              Up to {MAX_IMPORT_ROWS.toLocaleString()} members, 5 MB
            </span>
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={reading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void readFile(f);
              }}
            />
          </label>
        </section>
      )}

      {loaded && (
        <>
          <section className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">1. Check the columns</h2>
                <p className="text-sm text-muted-foreground">
                  {loaded.fileName} · {table.length - 1} rows. Tell FinSeka what each column is.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setLoaded(null)}>
                Choose another file
              </Button>
            </div>
            {loaded.sheets.length > 1 && (
              <div className="max-w-xs space-y-2">
                <Label>Sheet</Label>
                <Select
                  value={String(loaded.sheet)}
                  onValueChange={(v) => {
                    setLoaded({ ...loaded, sheet: Number(v) });
                    resetForSheet(loaded.sheets[Number(v)]?.table ?? []);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {loaded.sheets.map((s, i) => (
                      <SelectItem key={s.name + i} value={String(i)}>
                        {s.name} ({s.table.length - 1} rows)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {headings.map((h, col) => {
                const sample = table
                  .slice(1, 4)
                  .map((r) =>
                    String(
                      r[col] instanceof Date
                        ? (r[col] as Date).toISOString().slice(0, 10)
                        : (r[col] ?? ""),
                    ).trim(),
                  )
                  .filter(Boolean)
                  .join(", ");
                return (
                  <div key={col} className="space-y-1.5 rounded-2xl border border-border p-3">
                    <p className="truncate text-sm font-medium">
                      {String(h ?? "").trim() || `Column ${col + 1}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{sample || "—"}</p>
                    <Select
                      value={mapping[col] ?? SKIP}
                      onValueChange={(v) =>
                        setMapping((m) => {
                          const next = [...m];
                          // A field fills one column: move it here from wherever it was.
                          for (let i = 0; i < next.length; i++) if (next[i] === v) next[i] = null;
                          next[col] = v === SKIP ? null : (v as FieldKey);
                          return next;
                        })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>Don’t import</SelectItem>
                        {IMPORT_FIELDS.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            {!nameMapped && (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Pick which column has the members’ names.
              </p>
            )}
            {mapping.includes("owed") && (
              <div className="max-w-sm space-y-2">
                <Label htmlFor="owed-label">Call what they owed from before</Label>
                <Input
                  id="owed-label"
                  maxLength={200}
                  value={owedLabel}
                  onChange={(e) => setOwedLabel(e.target.value)}
                />
              </div>
            )}
          </section>

          {nameMapped && (
            <section className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold">2. Check the members</h2>
                <p className="text-sm text-muted-foreground">
                  Rows with a problem are skipped. Notes show values that were left out or fixed;
                  those members are still imported.
                </p>
              </div>
              {rows.length > MAX_IMPORT_ROWS && (
                <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  This file has {rows.length} rows. Import up to {MAX_IMPORT_ROWS.toLocaleString()}{" "}
                  at a time: split it into smaller files.
                </p>
              )}
              <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Row</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Phone · Branch · Joined</th>
                      <th className="px-4 py-3 text-right">Owed</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.slice(0, MAX_IMPORT_ROWS).map((r) => {
                      const missingName = !r.values.name || names[r.line] !== undefined;
                      return (
                        <tr key={r.line} className={r.errors.length ? "bg-destructive/5" : ""}>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.line}</td>
                          <td className="px-4 py-2">
                            {missingName ? (
                              <Input
                                aria-label={`Name for row ${r.line}`}
                                className="h-8"
                                placeholder="Type a name"
                                value={names[r.line] ?? ""}
                                onChange={(e) =>
                                  setNames((n) => ({ ...n, [r.line]: e.target.value }))
                                }
                              />
                            ) : (
                              <span className="font-medium">{r.values.name}</span>
                            )}
                            {r.values.tags?.length ? (
                              <span className="block text-xs text-muted-foreground">
                                {r.values.tags.join(", ")}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {[
                              r.values.phone,
                              r.values.branch,
                              r.values.joined_on && shortDate(r.values.joined_on),
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {r.values.owed ? naira(r.values.owed) : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            {r.errors.length > 0 ? (
                              <Badge
                                variant="secondary"
                                className="bg-destructive/12 text-destructive"
                              >
                                Skipped: {r.errors.join(", ")}
                              </Badge>
                            ) : r.duplicateOf ? (
                              <label className="flex items-center gap-2 text-xs">
                                <Checkbox
                                  checked={keepDuplicates.has(r.line)}
                                  onCheckedChange={(v) =>
                                    setKeepDuplicates((s) => {
                                      const next = new Set(s);
                                      if (v) next.add(r.line);
                                      else next.delete(r.line);
                                      return next;
                                    })
                                  }
                                />
                                <span>
                                  Looks like <strong>{r.duplicateOf}</strong>. Import anyway?
                                </span>
                              </label>
                            ) : (
                              <Badge variant="secondary" className="bg-success/12 text-success">
                                Ready
                              </Badge>
                            )}
                            {r.notes.map((n) => (
                              <span key={n} className="mt-1 block text-xs text-muted-foreground">
                                {n}
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-3xl border border-border bg-card p-4 shadow-lift">
                <span className="min-w-0 flex-1 text-sm">
                  <strong>{willImport.length}</strong> to import
                  {skipped > 0 && ` · ${skipped} skipped`}
                  {owedTotal > 0 && ` · ${naira(owedTotal)} brought forward`}
                  {branchesToCreate.length > 0 &&
                    ` · new ${branchesToCreate.length === 1 ? "branch" : "branches"}: ${branchesToCreate.join(", ")}`}
                </span>
                <Button
                  size="lg"
                  disabled={
                    save.isPending || willImport.length === 0 || rows.length > MAX_IMPORT_ROWS
                  }
                  onClick={() => save.mutate()}
                >
                  {save.isPending && <Loader2 className="size-4 animate-spin" />}
                  Import {willImport.length} {willImport.length === 1 ? "member" : "members"}
                </Button>
              </div>
            </section>
          )}
        </>
      )}

      {(imports.data ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Recent imports</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            {(imports.data ?? []).map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block font-medium ${i.undone_at ? "line-through opacity-60" : ""}`}
                  >
                    {i.member_count} {i.member_count === 1 ? "member" : "members"}
                    {i.file_name ? ` from ${i.file_name}` : ""}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {shortDate(i.created_at)}
                    {Number(i.debt_total) > 0 &&
                      ` · ${naira(Number(i.debt_total))} brought forward`}
                    {i.undone_at && ` · undone ${shortDate(i.undone_at)}`}
                  </span>
                </span>
                {!i.undone_at && (
                  <ConfirmButton
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    title="Undo this import?"
                    description={`This removes the ${i.member_count} members it added. It only works while no payments or pledges have been recorded for any of them.`}
                    confirmLabel="Yes, undo it"
                    onConfirm={() => undo.mutate(i.id)}
                  >
                    <Undo2 className="size-3.5" /> Undo
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
