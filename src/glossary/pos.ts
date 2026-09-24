/** Dictionary POS display: keep English tags, ensure trailing period (n. / v. / vt.). */
export function formatPos(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return s.endsWith(".") ? s : `${s}.`;
}
