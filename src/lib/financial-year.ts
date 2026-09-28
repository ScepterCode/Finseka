import { localIso } from "@/lib/format";

// Financial years as the database defines them (financial_year_of): a year starts on the
// 1st of the organization's chosen month. January gives "FY 2026"; April gives "FY 2026/27".

export const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type FinancialYear = { startsOn: string; endsOn: string; label: string };

export function financialYearOf(d: Date, startMonth: number): FinancialYear {
  const m = startMonth - 1;
  const year = d.getMonth() >= m ? d.getFullYear() : d.getFullYear() - 1;
  const start = new Date(year, m, 1);
  const end = new Date(year + 1, m, 0);
  const label =
    startMonth === 1 ? `FY ${year}` : `FY ${year}/${String((year + 1) % 100).padStart(2, "0")}`;
  return { startsOn: localIso(start), endsOn: localIso(end), label };
}

/** The current financial year and the ones before it, newest first. */
export function recentFinancialYears(today: Date, startMonth: number, count = 5) {
  const years: FinancialYear[] = [];
  for (let i = 0; i < count; i++) {
    years.push(
      financialYearOf(
        new Date(today.getFullYear() - i, today.getMonth(), today.getDate()),
        startMonth,
      ),
    );
  }
  return years;
}
