/** Cheap metadata search: Unicode folding, unordered tokens and bounded typo distance. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const rows = [Array.from({ length: b.length + 1 }, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        row[j - 1] + 1,
        rows[i - 1][j] + 1,
        rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        row[j] = Math.min(row[j], rows[i - 2][j - 2] + 1);
    }
    rows.push(row);
  }
  return rows[a.length][b.length];
}
export function searchScore(text: string, query: string, fuzzy = true): number {
  const source = normalizeSearch(text),
    needle = normalizeSearch(query).slice(0, 160);
  if (!needle) return 1;
  if (source === needle) return 100;
  if (source.includes(needle)) return 90;
  if (!fuzzy) return 0;
  const words = source.split(" ");
  let score = 70;
  for (const token of needle.split(" ")) {
    if (words.some((word) => word.startsWith(token))) continue;
    const tolerance = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
    const best = Math.min(
      ...words.map((word) =>
        Math.abs(word.length - token.length) <= tolerance
          ? distance(token, word)
          : 3,
      ),
    );
    if (best > tolerance) return 0;
    score -= best * 10;
  }
  return Math.max(1, score);
}
