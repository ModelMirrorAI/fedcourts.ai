// The weekly public updates as written by scripts/fetch-ledger.mjs at build
// time: each week's update as a rendered Markdown module, and an index of
// weeks, newest first. Nothing here is computed or edited.
const indexFile = Object.values(import.meta.glob("../data/updates/index.json", { eager: true, import: "default" }))[0];
const bodies = import.meta.glob("../data/updates/*.md", { eager: true });

export const UPDATES_REPO = "ModelMirrorAI/fedcourtsai";
export const weeks = indexFile?.weeks ?? [];

export function updateFor(week) {
  return bodies[`../data/updates/${week}.md`];
}

export function sourceUrl(entry) {
  return `https://github.com/${UPDATES_REPO}/blob/main/${entry.path}`;
}
