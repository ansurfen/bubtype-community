export const BUILTIN_FONT = "JetBrains Mono";
export const BUILTIN_FONT_SIZE = 28;

export function fontStack(family: string) {
  const safe = family.replace(/["\\]/g, "").trim() || BUILTIN_FONT;
  if (safe === BUILTIN_FONT) {
    return `"JetBrains Mono", "Cascadia Mono", "Consolas", "Microsoft YaHei", monospace`;
  }
  return `"${safe}", "JetBrains Mono", "Segoe UI", "Microsoft YaHei", sans-serif`;
}
