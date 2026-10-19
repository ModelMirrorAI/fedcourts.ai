// Results releases as written by scripts/fetch-results.mjs at build time:
// every release's metadata, and each published release's summary as a
// rendered Markdown module. Nothing here is computed or edited.
const indexFile = Object.values(import.meta.glob("../data/results/index.json", { eager: true, import: "default" }))[0];

export const RESULTS_REPO = indexFile?.repo;
const summaries = import.meta.glob("../data/results/*/summary.md", { eager: true });

export const releases = indexFile?.releases ?? [];
export const published = releases.filter((r) => r.state === "published");
export const upcoming = releases.filter((r) => r.state !== "published");

export function summaryFor(slug) {
  return summaries[`../data/results/${slug}/summary.md`];
}

// "2026-10-09" -> "October 9, 2026", without a timezone shift.
export function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
