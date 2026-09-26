// Supabase returns at most 1,000 rows per request. For lists that must be complete
// (every member, every contribution), fetch page by page until a short page comes back.
// The query must have a stable order (end with .order("id")) so pages don't overlap.

export const PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

export async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}
