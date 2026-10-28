import { whatsappNumber } from "@/lib/whatsapp";

// Importing members from a spreadsheet: read the table (CSV here; Excel is read by
// read-excel-file on the import page), guess which column is which, tidy each value, and say
// what is wrong with each row before anything is saved. Saving is import_members() in the
// database, all at once.

export const MAX_IMPORT_ROWS = 2000;

export type Cell = string | number | boolean | Date | null | undefined;

export const IMPORT_FIELDS = [
  { key: "name", label: "Name", hint: "Required" },
  { key: "phone", label: "Phone" },
  { key: "branch", label: "Branch" },
  { key: "joined_on", label: "Joined on", hint: "e.g. 15/03/2019" },
  { key: "tags", label: "Labels", hint: "e.g. choir, executive" },
  { key: "email", label: "Email" },
  { key: "gender", label: "Gender" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "address", label: "Address" },
  { key: "occupation", label: "Occupation" },
  { key: "next_of_kin_name", label: "Next of kin" },
  { key: "next_of_kin_phone", label: "Next of kin's phone" },
  { key: "owed", label: "Owed before FinSeka (₦)" },
] as const;

export type FieldKey = (typeof IMPORT_FIELDS)[number]["key"];
/** For each column of the file, the field it fills, or null to leave it out. */
export type Mapping = (FieldKey | null)[];

// Headings people use for each field, compared without case, spaces or punctuation.
const SYNONYMS: Record<FieldKey, string[]> = {
  name: [
    "name",
    "fullname",
    "membername",
    "names",
    "member",
    "nameofmember",
    "surnameandothernames",
  ],
  phone: [
    "phone",
    "phonenumber",
    "phoneno",
    "mobile",
    "mobilenumber",
    "telephone",
    "tel",
    "gsm",
    "whatsapp",
    "contact",
    "contactnumber",
  ],
  branch: ["branch", "chapter", "zone", "unit", "group", "district", "station"],
  joined_on: [
    "joined",
    "joinedon",
    "datejoined",
    "joindate",
    "dateofjoining",
    "membersince",
    "yearjoined",
    "startdate",
  ],
  tags: ["labels", "label", "tags", "tag", "category", "categories", "role", "position", "office"],
  email: ["email", "emailaddress", "mail"],
  gender: ["gender", "sex"],
  date_of_birth: ["dateofbirth", "dob", "birthday", "birthdate", "born"],
  address: ["address", "homeaddress", "residentialaddress", "location"],
  occupation: ["occupation", "job", "profession", "work", "business"],
  next_of_kin_name: ["nextofkin", "nextofkinname", "nok", "kin"],
  next_of_kin_phone: [
    "nextofkinphone",
    "nextofkinnumber",
    "nokphone",
    "nokphonenumber",
    "kinphone",
  ],
  owed: [
    "owed",
    "owing",
    "debt",
    "arrears",
    "balance",
    "outstanding",
    "amountowed",
    "owedbeforefinseka",
    "broughtforward",
    "bf",
  ],
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The field a column heading most likely means, or null. */
export function guessField(heading: string): FieldKey | null {
  const h = squash(heading);
  if (!h) return null;
  for (const f of IMPORT_FIELDS) if (SYNONYMS[f.key].includes(h)) return f.key;
  // Looser: "Phone number (WhatsApp)", "Amount owed (₦)", "Next of kin phone no".
  if (h.includes("kin"))
    return h.includes("phone") || h.includes("number") ? "next_of_kin_phone" : "next_of_kin_name";
  if (h.includes("phone") || h.includes("mobile")) return "phone";
  if (h.includes("email")) return "email";
  if (h.includes("birth")) return "date_of_birth";
  if (h.includes("join")) return "joined_on";
  if (h.includes("owe") || h.includes("debt") || h.includes("arrear")) return "owed";
  if (h.includes("name")) return "name";
  return null;
}

/** A first guess for every column; each field is used once (the first column that fits). */
export function guessMapping(headings: Cell[]): Mapping {
  const used = new Set<FieldKey>();
  return headings.map((h) => {
    const f = guessField(cellText(h));
    if (!f || used.has(f)) return null;
    used.add(f);
    return f;
  });
}

/**
 * Reads CSV text (as saved by Excel or Google Sheets): quoted cells, commas or line breaks inside
 * quotes, "" for a quote. Semicolon- and tab-separated files are recognised too.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, ""); // the byte-order mark Excel puts first
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function cellText(c: Cell): string {
  if (c == null) return "";
  if (c instanceof Date) return isoDate(c) ?? "";
  return String(c).trim();
}

function isoDate(d: Date) {
  if (Number.isNaN(d.getTime())) return null;
  // Spreadsheet dates have no time zone: read the calendar date as written.
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function validDate(y: number, m: number, d: number) {
  if (y < 100) y += y < 50 ? 2000 : 1900;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return isoDate(dt);
}

/**
 * A date as YYYY-MM-DD, or null if it cannot be read. Day comes before month, as in Nigeria:
 * 05/03/2019 is 5 March. Also: 2019-03-05, 5 Mar 2019, March 5 2019, a year alone (1 January),
 * Excel dates, and Excel's day numbers.
 */
export function parseDate(c: Cell): string | null {
  if (c == null || c === "") return null;
  if (c instanceof Date) return isoDate(c);
  if (typeof c === "number") {
    if (c >= 1900 && c <= 2100 && Number.isInteger(c)) return `${c}-01-01`;
    if (c > 0 && c < 80000) return isoDate(new Date(Date.UTC(1899, 11, 30) + c * 86400000));
    return null;
  }
  const s = String(c)
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  const month = (name = "") => MONTHS.indexOf(name) + 1; // 0 when it is not a month
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2}|\d{4})$/);
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s,-]+(\d{4})$/);
  if (m && month(m[2])) return validDate(Number(m[3]), month(m[2]), Number(m[1]));
  m = s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/);
  if (m && month(m[1])) return validDate(Number(m[3]), month(m[1]), Number(m[2]));
  if (/^\d{4}$/.test(s)) return validDate(Number(s), 1, 1);
  return null;
}

/** An amount like "₦5,000", "N 5000.50" or 5000; null when blank, NaN when unreadable. */
export function parseAmount(c: Cell): number | null {
  if (c == null || c === "") return null;
  if (typeof c === "number") return c;
  const s = String(c)
    .trim()
    .replace(/^(₦|ngn|n)\s*/i, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");
  if (s === "" || s === "-") return null;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

export type ImportRow = {
  /** Row number in the file (1 = the heading row). */
  line: number;
  values: Partial<Record<Exclude<FieldKey, "tags" | "owed">, string>> & {
    tags?: string[];
    owed?: number;
  };
  /** Why the row cannot be imported as it is (it is skipped). */
  errors: string[];
  /** Values left out or fixed up; the row is still imported. */
  notes: string[];
  /** Looks like someone already on the list (or earlier in the file). */
  duplicateOf: string | null;
};

const personKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

/** Every data row of the file, tidied and checked. */
export function buildImportRows(
  table: Cell[][],
  mapping: Mapping,
  existing: { name: string; phone: string | null }[],
): ImportRow[] {
  const knownNames = new Map(existing.map((m) => [personKey(m.name), m.name]));
  const knownPhones = new Map<string, string>();
  for (const m of existing) {
    const p = whatsappNumber(m.phone);
    if (p) knownPhones.set(p, m.name);
  }

  return table.slice(1).map((cells, i) => {
    const row: ImportRow = { line: i + 2, values: {}, errors: [], notes: [], duplicateOf: null };
    mapping.forEach((field, col) => {
      if (!field) return;
      const raw = cells[col];
      const text = cellText(raw);
      if (text === "") return;
      switch (field) {
        case "joined_on":
        case "date_of_birth": {
          const d = parseDate(raw);
          if (d) row.values[field] = d;
          else
            row.notes.push(
              `${field === "joined_on" ? "Joined date" : "Date of birth"} “${text}” not understood${
                field === "joined_on" ? " (today is used)" : " (left out)"
              }`,
            );
          break;
        }
        case "owed": {
          const n = parseAmount(raw);
          if (n == null || n === 0) break;
          if (Number.isNaN(n) || n < 0)
            row.notes.push(`Amount owed “${text}” not understood (left out)`);
          else row.values.owed = Math.round(n * 100) / 100;
          break;
        }
        case "tags":
          row.values.tags = [
            ...new Set(
              text
                .split(/[,;/|]/)
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ];
          break;
        case "gender": {
          const g = text.toLowerCase();
          if (["m", "male", "man"].includes(g)) row.values.gender = "male";
          else if (["f", "female", "woman"].includes(g)) row.values.gender = "female";
          else row.notes.push(`Gender “${text}” not understood (left out)`);
          break;
        }
        case "email":
          if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) row.values.email = text;
          else row.notes.push(`Email “${text}” does not look right (left out)`);
          break;
        case "phone":
        case "next_of_kin_phone": {
          // Excel keeps a number typed as 0803… as 803…: put the 0 back.
          const digits = typeof raw === "number" ? String(Math.trunc(raw)) : null;
          const phone =
            digits && digits.length === 10 && !digits.startsWith("0") ? `0${digits}` : text;
          row.values[field] = phone;
          if (field === "phone" && !whatsappNumber(phone))
            row.notes.push(`Phone “${phone}” does not look like a Nigerian number`);
          break;
        }
        default:
          row.values[field] = text.replace(/\s+/g, " ").slice(0, field === "address" ? 500 : 200);
      }
    });

    const name = row.values.name ?? "";
    if (!name) row.errors.push("No name");
    else {
      const phoneKey = whatsappNumber(row.values.phone);
      row.duplicateOf =
        knownNames.get(personKey(name)) ??
        (phoneKey ? knownPhones.get(phoneKey) : undefined) ??
        null;
      knownNames.set(personKey(name), `${name} (row ${row.line})`);
      if (phoneKey && !knownPhones.has(phoneKey))
        knownPhones.set(phoneKey, `${name} (row ${row.line})`);
    }
    return row;
  });
}

/** Branch names in the rows that are not branches yet (they are created on import). */
export function newBranches(rows: ImportRow[], existing: { name: string }[]) {
  const known = new Set(existing.map((b) => b.name.toLowerCase().replace(/\s+/g, " ").trim()));
  const fresh = new Map<string, string>();
  for (const r of rows) {
    const b = r.values.branch?.replace(/\s+/g, " ").trim();
    if (b && !known.has(b.toLowerCase()) && !fresh.has(b.toLowerCase()))
      fresh.set(b.toLowerCase(), b);
  }
  return [...fresh.values()];
}

/** The template a secretary can fill in. */
export const TEMPLATE_HEADINGS = [
  "Name",
  "Phone",
  "Branch",
  "Joined on",
  "Labels",
  "Email",
  "Gender",
  "Date of birth",
  "Address",
  "Occupation",
  "Next of kin",
  "Next of kin phone",
  "Owed before FinSeka",
];
export const TEMPLATE_EXAMPLE = [
  "Ngozi Eze",
  "0803 123 4567",
  "Aba Branch",
  "15/03/2019",
  "choir, executive",
  "ngozi@example.com",
  "Female",
  "02/11/1985",
  "12 Aba Road, Umuahia",
  "Trader",
  "Chidi Eze",
  "0806 765 4321",
  "5000",
];
