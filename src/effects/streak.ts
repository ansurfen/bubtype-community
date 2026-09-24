export const STREAK_MS = 10_000;

const THRESHOLDS = [20, 50, 100, 200, 500];

const LINES = [
  "Super!",
  "Radical!",
  "Fantastic!",
  "Great!",
  "OMG",
  "Whoah!",
  ":O",
  "Nice!",
  "Splendid!",
  "Wild!",
  "Grand!",
  "Impressive!",
  "Stupendous!",
  "Extreme!",
  "Awesome!",
];

export type BurstKind = "message" | "bingo" | "up" | "down" | "level" | "max";

export type Burst = {
  text: string;
  kind: BurstKind;
};

export function levelOf(streak: number) {
  let level = 0;
  for (const threshold of THRESHOLDS) {
    if (streak < threshold) break;
    level += 1;
  }
  return level;
}

export const defaultComboTheme = "#f5b8c8";

export function levelColor(level: number, theme: string = defaultComboTheme) {
  const base = rgbOf(theme);
  const shade = 1 - (Math.min(Math.max(level, 0), 5) / 5) * 0.28;
  return rgbString({
    r: Math.round(base.r * shade),
    g: Math.round(base.g * shade),
    b: Math.round(base.b * shade),
  });
}

function rgbOf(hex: string) {
  const clean = hex.replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((part) => part + part).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  return {
    r: Number.parseInt(value.slice(0, 2), 16) || 245,
    g: Number.parseInt(value.slice(2, 4), 16) || 184,
    b: Number.parseInt(value.slice(4, 6), 16) || 200,
  };
}

function rgbString(color: { r: number; g: number; b: number }) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

export function gainStreak(previous: number, maxStreak: number, done: boolean) {
  const levelBefore = levelOf(previous);
  const added = levelBefore + 1;
  const streak = previous + added;
  const level = levelOf(streak);
  let max = maxStreak;
  let burst: Burst;
  if (streak > max) {
    max = streak;
    burst = { text: "NEW MAX!!!", kind: "max" };
  } else if (level !== levelBefore) {
    burst = { text: `${level + 1}x`, kind: "level" };
  } else if (done) {
    burst = { text: "BINGO", kind: "bingo" };
  } else if (streak % 10 === 0) {
    burst = { text: LINES[Math.floor(Math.random() * LINES.length)] ?? "Nice!", kind: "message" };
  } else {
    burst = { text: `+${added}`, kind: "up" };
  }
  return { streak, max, level, burst };
}
