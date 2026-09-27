// Build-time fetch of the Release 1 public summary.
//
// The Results page renders docs/release-ot2026-public-summary.md from the
// fedcourtsai repo, read at the results/ot2026-longconf tag and nowhere else.
// Until that tag exists the page shows its pending state, so it goes live on
// the first rebuild after the tag is pushed, with no change here.
//
// Fail closed: once the tag exists, any problem reading or checking the
// summary fails the build, so Cloudflare Pages keeps serving the last good
// deploy rather than publishing a partial or unfilled page.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO = "ModelMirrorAI/fedcourtsai";
const TAG = "results/ot2026-longconf";
const DOC = "docs/release-ot2026-public-summary.md";
const AUDIT = "docs/release-ot2026-long-conference.md";
const OUT = new URL("../src/data/results/", import.meta.url);

// The tag's commit, via git's smart-HTTP protocol: no API token, no rate limit.
// Returns { exists, sha }; sha is null only if git itself is unavailable.
async function resolveTag() {
  try {
    const { stdout } = await promisify(execFile)(
      "git", ["ls-remote", `https://github.com/${REPO}`, `refs/tags/${TAG}`, `refs/tags/${TAG}^{}`],
      { timeout: 30_000 },
    );
    const refs = Object.fromEntries(stdout.trim().split("\n").filter(Boolean).map((l) => l.split("\t").reverse()));
    const sha = refs[`refs/tags/${TAG}^{}`] ?? refs[`refs/tags/${TAG}`] ?? null; // annotated tags peel to the commit
    return { exists: Boolean(sha), sha };
  } catch (e) {
    console.warn(`results: git ls-remote failed (${e.message.split("\n")[0]}); falling back to a raw fetch`);
    const res = await fetch(rawUrl(`refs/tags/${TAG}`), { method: "HEAD" });
    if (res.status === 404) return { exists: false, sha: null };
    if (!res.ok) throw new Error(`results: could not tell whether ${TAG} exists (HTTP ${res.status})`);
    return { exists: true, sha: null };
  }
}

const rawUrl = (ref) => `https://raw.githubusercontent.com/${REPO}/${ref}/${DOC}`;

// The page shows the "## Draft" section only: the preamble and the filling
// rules are for maintainers, and they stay one click away in the repo.
function extractDraft(text) {
  const start = text.search(/^## Draft\s*$/m);
  const end = text.search(/^## Rules for filling this in\s*$/m);
  if (start < 0 || end < 0 || end < start) throw new Error("results: summary has no ## Draft … ## Rules section; its layout changed");
  return text
    .slice(start, end)
    .replace(/^## Draft\s*\n/, "")
    .replace(/\n-{3,}\s*$/, "\n")        // the horizontal rule before ## Rules
    .replace(/^### /gm, "## ")           // the draft's sections sit under the page's own h1
    .trim() + "\n";
}

// Relative links in the summary point at repo files beside it; resolve them
// to GitHub at the tagged commit so they keep meaning exactly that version.
function absolutizeLinks(md, ref) {
  const base = `https://github.com/${REPO}/blob/${ref}/docs/`;
  return md.replace(/\]\((?!https?:|mailto:|#|\/)([^)\s]+)\)/g, (_, href) => `](${new URL(href, base).href})`);
}

async function main() {
  const dir = fileURLToPath(OUT);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const { exists, sha } = await resolveTag();
  const meta = {
    state: exists ? "published" : "pending",
    tag: TAG,
    sha,
    release_url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(TAG)}`,
    summary_url: null,
    audit_url: null,
    checked_at: new Date().toISOString(),
  };

  if (exists) {
    const ref = sha ?? `refs/tags/${TAG}`;
    const res = await fetch(rawUrl(ref));
    if (!res.ok) throw new Error(`results: tag ${TAG} exists but ${DOC} could not be read at it (HTTP ${res.status})`);
    const draft = extractDraft(await res.text());

    // The repo's own publishability check: no placeholder may survive. A tag
    // over an unfilled page should never happen; if it does, publish nothing.
    const left = draft.split("\n").filter((l) => l.includes("\u2039") || l.includes("\u203A"));
    if (left.length) throw new Error(`results: ${left.length} unfilled placeholder line(s) at ${TAG}:\n${left.slice(0, 5).join("\n")}`);

    const blobRef = sha ?? TAG;
    meta.summary_url = `https://github.com/${REPO}/blob/${blobRef}/${DOC}`;
    meta.audit_url = `https://github.com/${REPO}/blob/${blobRef}/${AUDIT}`;
    await writeFile(new URL("summary.md", OUT), absolutizeLinks(draft, blobRef));
  }

  await writeFile(new URL("meta.json", OUT), JSON.stringify(meta, null, 1));
  console.log(exists ? `results: published from ${TAG} @ ${sha ?? "unknown sha"}` : `results: ${TAG} not tagged yet; page shows its pending state`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
