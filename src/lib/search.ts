// Finding people by what the user types: parts of their name in any order, or phone digits.

function phoneDigits(value: string) {
  let d = value.replace(/\D/g, "");
  if (d.startsWith("234")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return d;
}

/**
 * True when every word typed appears in the name ("ada obi" finds "Ada Chioma Obi"),
 * or the typed digits appear in the phone number, however either is written.
 * An empty search matches everyone.
 */
export function matchesPerson(query: string, name: string, phone?: string | null): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const words = q.split(/\s+/);
  const lowerName = name.toLowerCase();
  if (words.every((w) => lowerName.includes(w))) return true;

  const digits = phoneDigits(q);
  return digits.length >= 3 && !!phone && phoneDigits(phone).includes(digits);
}
