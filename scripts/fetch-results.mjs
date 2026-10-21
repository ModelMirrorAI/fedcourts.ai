// Build-time fetch of every results release's public summary.
//
// The list of releases is the release manifest committed in the fedcourtsai
// repo (docs/releases.json), read from `main`. Each release renders its public
// summary from that repo, read at the release's own tag and nowhere else, so
// the list can grow while every published page stays fixed to its tagged
// text. A release whose tag does not exist yet is written out as pending: the
// Results index lists it as upcoming, and it publishes on the first rebuild
// after the tag is pushed, with no change here.
//
// Fail closed: a manifest that cannot be fetched, does not parse, or breaks
// its shape fails the build, and so, once a release's tag exists, does any
// problem reading or checking its summary. Cloudflare Pages then keeps
// serving the last good deploy rather than publishing an empty, partial or
// unfilled page.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO = "ModelMirrorAI/fedcourtsai";
const MANIFEST = { branch: "main", path: "docs/releases.json", schema_version: "1.0" };
const OUT = new URL("../src/data/results/", import.meta.url);
const run = promisify(execFile);

// A tag's commit, via git's smart-HTTP protocol: no API token, no rate limit.
// Returns { exists, sha }; sha is null only if git itself is unavailable.
async function resolveTag(tag, doc) {
  try {
    const { stdout } = await run(
      "git", ["ls-remote", `https://github.com/${REPO}`, `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
      { timeout: 30_000 },
    );
    const refs = Object.fromEntries(stdout.trim().split("\n").filter(Boolean).map((l) => l.split("\t").reverse()));
    const sha = refs[`refs/tags/${tag}^{}`] ?? refs[`refs/tags/${tag}`] ?? null; // annotated tags peel to the commit
    return { exists: Boolean(sha), sha };
  } catch (e) {
    console.warn(`results: git ls-remote failed (${e.message.split("\n")[0]}); falling back to a raw fetch`);
    const res = await fetch(rawUrl(`refs/tags/${tag}`, doc), { method: "HEAD" });
    if (res.status === 404) return { exists: false, sha: null };
    if (!res.ok) throw new Error(`results: could not tell whether ${tag} exists (HTTP ${res.status})`);
    return { exists: true, sha: null };
  }
}

const rawUrl = (ref, doc) => `https://raw.githubusercontent.com/${REPO}/${ref}/${doc}`;

// The manifest, read at the commit `main` points to now, so the list and the
// commit stamped beside it agree. Falls back to the branch name if git itself
// is unavailable.
async function fetchManifest() {
  let sha = null;
  try {
    const { stdout } = await run("git", ["ls-remote", `https://github.com/${REPO}`, `refs/heads/${MANIFEST.branch}`], { timeout: 30_000 });
    sha = stdout.trim().split("\t")[0] || null;
    if (!sha) throw new Error(`results: ${REPO} has no ${MANIFEST.branch} branch`);
  } catch (e) {
    if (e.message?.startsWith("results:")) throw e;
    console.warn(`results: git ls-remote failed (${e.message.split("\n")[0]}); reading the manifest at the branch`);
  }
  const ref = sha ?? `refs/heads/${MANIFEST.branch}`;
  const res = await fetch(rawUrl(ref, MANIFEST.path));
  if (!res.ok) throw new Error(`results: the release manifest ${MANIFEST.path} could not be read at ${MANIFEST.branch} (HTTP ${res.status})`);
  let manifest;
  try { manifest = JSON.parse(await res.text()); }
  catch (e) { throw new Error(`results: the release manifest does not parse (${e.message})`); }
  return { sha, releases: checkManifest(manifest) };
}

// The fields the pages read, checked here so a malformed entry fails the
// build instead of rendering a broken page. The repo's own schema and test
// (fedcourtsai's ReleaseManifest) are the full contract; this is the subset
// the site depends on.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOC = /^docs\/[A-Za-z0-9_./-]+\.md$/;
function checkManifest(m) {
  const bad = (why) => { throw new Error(`results: the release manifest ${why}`); };
  if (m?.schema_version !== MANIFEST.schema_version) bad(`has schema_version ${JSON.stringify(m?.schema_version)}, expected "${MANIFEST.schema_version}"`);
  if (!Array.isArray(m.releases) || m.releases.length === 0) bad("lists no releases");
  for (const r of m.releases) {
    const name = r?.slug ?? JSON.stringify(r);
    for (const f of ["slug", "label", "tag", "published", "covers", "summary", "audit"]) {
      if (typeof r?.[f] !== "string" || !r[f].trim()) bad(`entry ${name} has no ${f}`);
    }
    if (!SLUG.test(r.slug)) bad(`entry ${name} has a slug that is not URL-safe`);
    // The page at /results/<slug> shows the documents read at the tag, so the
    // two must name the same release.
    if (r.tag !== `results/${r.slug}`) bad(`entry ${name} has tag ${r.tag}, expected results/${r.slug}`);
    if (!ISO_DATE.test(r.published)) bad(`entry ${name} has a published date that is not YYYY-MM-DD`);
    if (!DOC.test(r.summary) || !DOC.test(r.audit) || /(^|\/)\.\.(\/|$)/.test(r.summary + "/" + r.audit)) bad(`entry ${name} names a document outside docs/`);
  }
  return m.releases;
}

// The page shows the "## Draft" section only, ending at the next level-2
// heading: the preamble, the provenance notes and the filling rules are for
// maintainers, and they stay one click away in the repo. Headings inside
// fenced code blocks (shell comments) are not headings, so they are skipped.
function extractDraft(text) {
  const lines = text.split("\n");
  let start = -1, end = -1, fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
    if (fenced || !/^## /.test(lines[i])) continue;
    if (start < 0) { if (/^## Draft\s*$/.test(lines[i])) start = i; }
    else { end = i; break; }
  }
  if (start < 0 || end < 0) throw new Error("results: summary has no ## Draft section followed by another ## section; its layout changed");
  return lines
    .slice(start, end)
    .join("\n")
    .replace(/^## Draft\s*\n/, "")
    .replace(/\n-{3,}\s*$/, "\n")        // the horizontal rule before the next section
    .replace(/^### /gm, "## ")           // the draft's sections sit under the page's own h1
    .trim() + "\n";
}

// The summary's first heading is its one-sentence headline; the Results
// index shows it as the release's title.
function headline(draft) {
  const m = draft.match(/^## (.+)$/m);
  if (!m) throw new Error("results: summary has no headline heading");
  return m[1].trim();
}

// Relative links in the summary point at repo files beside it; resolve them
// to GitHub at the tagged commit so they keep meaning exactly that version.
function absolutizeLinks(md, ref, doc) {
  const base = `https://github.com/${REPO}/blob/${ref}/${doc.replace(/[^/]+$/, "")}`;
  return md.replace(/\]\((?!https?:|mailto:|#|\/)([^)\s]+)\)/g, (_, href) => `](${new URL(href, base).href})`);
}

async function fetchRelease(r) {
  const { exists, sha } = await resolveTag(r.tag, r.summary);
  const meta = {
    ...r,
    state: exists ? "published" : "pending",
    sha,
    release_url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(r.tag)}`,
    summary_url: null,
    audit_url: null,
    headline: null,
  };
  if (!exists) return meta;

  const ref = sha ?? `refs/tags/${r.tag}`;
  const res = await fetch(rawUrl(ref, r.summary));
  if (!res.ok) throw new Error(`results: tag ${r.tag} exists but ${r.summary} could not be read at it (HTTP ${res.status})`);
  const draft = extractDraft(await res.text());

  // The repo's own publishability check: no placeholder may survive. A tag
  // over an unfilled page should never happen; if it does, publish nothing.
  const left = draft.split("\n").filter((l) => l.includes("‹") || l.includes("›"));
  if (left.length) throw new Error(`results: ${left.length} unfilled placeholder line(s) at ${r.tag}:\n${left.slice(0, 5).join("\n")}`);

  const blobRef = sha ?? r.tag;
  meta.summary_url = `https://github.com/${REPO}/blob/${blobRef}/${r.summary}`;
  meta.audit_url = `https://github.com/${REPO}/blob/${blobRef}/${r.audit}`;
  meta.headline = headline(draft);
  const dir = new URL(`${r.slug}/`, OUT);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL("summary.md", dir), absolutizeLinks(draft, blobRef, r.summary));
  return meta;
}

async function main() {
  const manifest = await fetchManifest();
  console.log(`results: manifest lists ${manifest.releases.length} release(s), read at ${MANIFEST.branch} @ ${manifest.sha ?? "unknown sha"}`);

  await rm(fileURLToPath(OUT), { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const slugs = manifest.releases.map((r) => r.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error("results: duplicate release slug");

  const releases = [];
  for (const r of manifest.releases) {
    const meta = await fetchRelease(r);
    releases.push(meta);
    console.log(meta.state === "published"
      ? `results: ${r.slug} published from ${r.tag} @ ${meta.sha ?? "unknown sha"}`
      : `results: ${r.slug} not tagged yet; listed as upcoming`);
  }
  await writeFile(new URL("index.json", OUT), JSON.stringify({ checked_at: new Date().toISOString(), repo: REPO, manifest_sha: manifest.sha, releases }, null, 1));
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
