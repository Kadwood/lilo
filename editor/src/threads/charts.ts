/**
 * "Search online": where to look a spool up when its code isn't in the catalogue. Brands we have a
 * checked colour-chart page for go in `KNOWN`; every other brand gets a web search for its chart,
 * which always works and never goes stale.
 */
const KNOWN: Record<string, string> = {};

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The brand's colour-chart page, or a web search for it. `code` narrows the search to that colour. */
export function brandChartUrl(brand: string, line?: string, code?: string): string {
  const known = KNOWN[key(brand)];
  if (known && !code) return known;
  const words = [brand, line ?? "", "embroidery thread", code ? `colour ${code}` : "colour chart"].map((w) => w.trim()).filter(Boolean);
  return `https://duckduckgo.com/?q=${encodeURIComponent(words.join(" "))}`;
}
