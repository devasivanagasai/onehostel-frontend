/** Hostel-local calendar date as YYYY-MM-DD (not the UTC date that `toISOString()` gives). */
export function localDateIso(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
