export const TOOLBAR_IDS = [
  "prev",
  "next",
  "replay",
  "copy",
  "panel",
  "combo",
  "lookup",
  "rate",
  "bookmark",
] as const;

export type ToolbarId = (typeof TOOLBAR_IDS)[number];

/** Catalog rows in settings — prev/next shown as one pair. */
export const TOOLBAR_ROWS: Array<{ id: ToolbarId; pair?: "nav" }> = [
  { id: "prev", pair: "nav" },
  { id: "replay" },
  { id: "copy" },
  { id: "panel" },
  { id: "combo" },
  { id: "lookup" },
  { id: "rate" },
  { id: "bookmark" },
];

export const DEFAULT_TOOLBAR: ToolbarId[] = [
  "prev",
  "next",
  "replay",
  "copy",
  "panel",
  "combo",
  "lookup",
  "rate",
  "bookmark",
];

export const RATE_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function isToolbarId(value: string): value is ToolbarId {
  return (TOOLBAR_IDS as readonly string[]).includes(value);
}

/** Keep prev+next as an adjacent pair whenever either is present. */
export function sanitizeToolbar(items: string[] | null | undefined): ToolbarId[] {
  if (items == null) return [...DEFAULT_TOOLBAR];
  const seen = new Set<string>();
  const raw: ToolbarId[] = [];
  for (const id of items) {
    if (!isToolbarId(id) || seen.has(id)) continue;
    seen.add(id);
    raw.push(id);
  }

  const hasPrev = raw.includes("prev");
  const hasNext = raw.includes("next");
  if (!hasPrev && !hasNext) return raw;
  const without: ToolbarId[] = raw.filter((id) => id !== "prev" && id !== "next");
  if (hasPrev && hasNext) {
    const anchor = Math.min(raw.indexOf("prev"), raw.indexOf("next"));
    without.splice(Math.min(anchor, without.length), 0, "prev", "next");
    return without;
  }
  const alone = hasPrev ? "prev" : "next";
  const anchor = raw.indexOf(alone);
  without.splice(Math.max(0, Math.min(anchor, without.length)), 0, "prev", "next");
  return without;
}

export function toggleNavPair(enabled: ToolbarId[], on: boolean): ToolbarId[] {
  const without: ToolbarId[] = enabled.filter((id) => id !== "prev" && id !== "next");
  if (!on) return without;
  return ["prev", "next", ...without];
}

export function moveNavBlock(enabled: ToolbarId[], direction: -1 | 1): ToolbarId[] {
  const start = enabled.indexOf("prev");
  if (start < 0 || enabled[start + 1] !== "next") return enabled;
  const target = start + direction;
  if (target < 0 || target + 1 >= enabled.length) return enabled;
  const without: ToolbarId[] = enabled.filter((id) => id !== "prev" && id !== "next");
  without.splice(target, 0, "prev", "next");
  return without;
}

/** Reorder enabled toolbar blocks (nav = prev+next as one unit). */
export function reorderToolbarBlocks(
  enabled: ToolbarId[],
  fromKey: string,
  toKey: string,
): ToolbarId[] {
  if (fromKey === toKey) return enabled;
  type Block = { key: string; ids: ToolbarId[] };
  const blocks: Block[] = [];
  let i = 0;
  while (i < enabled.length) {
    if (enabled[i] === "prev" && enabled[i + 1] === "next") {
      blocks.push({ key: "nav", ids: ["prev", "next"] });
      i += 2;
      continue;
    }
    blocks.push({ key: enabled[i], ids: [enabled[i]] });
    i += 1;
  }
  const from = blocks.findIndex((b) => b.key === fromKey);
  const to = blocks.findIndex((b) => b.key === toKey);
  if (from < 0 || to < 0) return enabled;
  const next = [...blocks];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next.flatMap((b) => b.ids);
}

export function nextRate(current: number): number {
  const idx = RATE_STEPS.findIndex((step) => Math.abs(step - current) < 0.001);
  if (idx < 0) return 1;
  return RATE_STEPS[(idx + 1) % RATE_STEPS.length];
}

export function formatRate(rate: number): string {
  const matched = RATE_STEPS.find((step) => Math.abs(step - rate) < 0.001);
  const value = matched ?? rate;
  const label = Number.isInteger(value) ? `${value}` : String(value);
  return `${label}x`;
}
