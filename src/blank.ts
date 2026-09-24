const SMALL = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "am",
  "be",
  "to",
  "of",
  "in",
  "on",
  "at",
  "it",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
]);

type WordSpan = { start: number; end: number; word: string };

function wordsOf(text: string): WordSpan[] {
  const out: WordSpan[] = [];
  const re = /[A-Za-z']+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    out.push({ start: match.index, end: match.index + match[0].length, word: match[0] });
  }
  return out;
}

function pickCount(n: number, salt: number) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  return 1 + (Math.abs(salt) % Math.min(2, n));
}

/** Char-level mask: true means this character is a blank until typed. */
export function blankMask(text: string, salt: number): boolean[] {
  const mask = Array.from(text, () => false);
  const words = wordsOf(text);
  if (words.length === 0) return mask;

  let pool = words.filter((item) => !SMALL.has(item.word.toLowerCase()));
  if (pool.length === 0) pool = words.slice();

  const count = pickCount(pool.length, salt);
  const chosen: WordSpan[] = [];
  let cursor = Math.abs(salt) % pool.length;
  for (let i = 0; i < count; i += 1) {
    const item = pool[(cursor + i * 3) % pool.length];
    if (!chosen.some((other) => other.start === item.start)) chosen.push(item);
  }

  for (const item of chosen) {
    for (let i = item.start; i < item.end; i += 1) mask[i] = true;
  }
  return mask;
}
