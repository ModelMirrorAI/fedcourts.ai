// Build-time fetch of the FedCourtsAI ledger.
//
// Downloads the public repo tarball (no API token, no rate limit), walks
// data/cases/** for the derived judgments, reads the committed metrics
// roll-ups, and writes src/data/ledger.json for the pages to render.
// The site never computes anything the repo doesn't already state; it
// counts files and copies figures, each stamped with the commit they came from.

import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { glob } from "node:fs/promises";
import * as tar from "tar";
import YAML from "yaml";

const REPO = "ModelMirrorAI/fedcourtsai";
const BRANCH = "main";
const TARBALL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;
const COMMITS_FEED = `https://github.com/${REPO}/commits/${BRANCH}.atom`;
const OUT = new URL("../src/data/ledger.json", import.meta.url);

const WANT = /^[^/]+\/(metrics\/[^/]+\.json|data\/cases\/.*\/(event\.yaml|outcome\.json|prediction\.json|evaluation\.json)|data\/cases\/[^/]+\/[^/]+\/summaries\/\d{4}-\d{2}-\d{2}\.md)$/;

// A case summary (docs/case-summaries.md in the ledger repo): YAML front matter
// written by the harness, then exactly three "## " sections of plain prose. The
// harness rejects any markup, so the body is carried as text and rendered escaped.
function parseSummary(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const front = YAML.parse(m[1]) ?? {};
  const sections = [];
  for (const block of m[2].split(/^## /m).slice(1)) {
    const [heading, ...rest] = block.split("\n");
    const paragraphs = rest.join("\n").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (heading.trim() && paragraphs.length) sections.push({ heading: heading.trim(), paragraphs });
  }
  if (sections.length === 0) return null;
  return {
    case_id: front.case_id ?? null,
    snapshot: front.snapshot ? String(front.snapshot) : null,
    model: front.model ?? null,
    generated_at: front.generated_at ? String(front.generated_at) : null,
    sections,
  };
}

async function headCommit() {
  try {
    const xml = await (await fetch(COMMITS_FEED)).text();
    const sha = xml.match(/<id>tag:github\.com,2008:Grit::Commit\/([0-9a-f]{40})<\/id>/)?.[1] ?? null;
    const at = xml.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? null;
    return { sha, at };
  } catch {
    return { sha: null, at: null };
  }
}

async function download(dir) {
  const res = await fetch(TARBALL);
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status}`);
  const file = join(dir, "repo.tgz");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  await tar.x({ file, cwd: dir, strip: 1, filter: (p) => WANT.test(p) });
}

async function readJSON(p) { return JSON.parse(await readFile(p, "utf8")); }

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "fedcourts-"));
  try {
    const [head] = await Promise.all([headCommit(), download(dir)]);

    // --- metrics roll-ups (copied, not recomputed) ---
    const metrics = {};
    for (const name of ["leaderboard", "claim-scores", "statpack", "backtest", "big-cases"]) {
      try { metrics[name] = await readJSON(join(dir, "metrics", `${name}.json`)); } catch { metrics[name] = null; }
    }
    const frozen = metrics.leaderboard?.frozen_process ?? { digests: [], since: null };
    const frozenDigests = new Set(frozen.digests ?? []);
    const frozenSince = frozen.since ? Date.parse(frozen.since) : null;

    // --- walk the case tree ---
    const events = new Map();
    const summaries = {};
    const base = join(dir, "data", "cases");
    for await (const f of glob("**/*", { cwd: base })) {
      const parts = f.split(sep);
      // <court>/<docket>/summaries/<YYYY-MM-DD>.md — keep each case's newest.
      if (parts.length === 4 && parts[2] === "summaries" && parts[3].endsWith(".md")) {
        const caseId = `${parts[0]}/${parts[1]}`;
        const day = parts[3].slice(0, -3);
        if (summaries[caseId] && summaries[caseId].snapshot >= day) continue;
        const parsed = parseSummary(await readFile(join(base, f), "utf8"));
        if (parsed) summaries[caseId] = { ...parsed, snapshot: parsed.snapshot ?? day, path: `data/cases/${caseId}/summaries/${parts[3]}` };
        continue;
      }
      // <court>/<docket>/events/<event>/...
      if (parts.length < 5 || parts[2] !== "events") continue;
      const key = parts.slice(0, 4).join("/");
      const ev = events.get(key) ?? { court: parts[0], docket: parts[1], event_id: parts[3], predictions: [], evaluations: [], outcome: null, meta: null };
      const leaf = parts.at(-1);
      const full = join(base, f);
      if (leaf === "event.yaml" && parts.length === 5) ev.meta = YAML.parse(await readFile(full, "utf8"));
      else if (leaf === "outcome.json" && parts.length === 5) ev.outcome = await readJSON(full);
      else if (leaf === "prediction.json" && parts[4] === "predictions") ev.predictions.push(await readJSON(full));
      else if (leaf === "evaluation.json" && parts[4] === "evaluations") ev.evaluations.push(await readJSON(full));
      else continue;
      events.set(key, ev);
    }

    const isFrozen = (p) => {
      const pv = p.process_version;
      if (!pv || !frozenDigests.has(pv.digest) || !frozenSince) return false;
      const t = Date.parse(pv.stamped_at ?? "");
      return Number.isFinite(t) && t >= frozenSince;
    };
    const isForward = (p) => (p.context?.mode ?? "forward") === "forward";

    // --- ledger rows: every event carrying at least one forward prediction ---
    const rows = [];
    const predictors = {};
    let predictionsTotal = 0, predictionsFrozen = 0, evaluationsTotal = 0;
    for (const ev of events.values()) {
      const fwd = ev.predictions.filter(isForward);
      if (fwd.length === 0) continue;
      predictionsTotal += fwd.length;
      evaluationsTotal += ev.evaluations.length;
      for (const p of fwd) {
        const f = isFrozen(p);
        if (f) predictionsFrozen++;
        const s = (predictors[p.predictor_id] ??= { model: p.model, engine: p.engine, predictions: 0, frozen: 0 });
        s.predictions++; if (f) s.frozen++;
      }
      const times = fwd.map((p) => p.process_version?.stamped_at ?? p.created_at).filter(Boolean).sort();
      const probs = fwd.map((p) => p.probability).filter((x) => typeof x === "number");
      rows.push({
        path: `data/cases/${ev.court}/${ev.docket}/events/${ev.event_id}`,
        court: ev.court, docket: ev.docket, event_id: ev.event_id,
        title: ev.meta?.title ?? null, kind: ev.meta?.kind ?? null, stage: ev.meta?.stage ?? null,
        opened_at: ev.meta?.opened_at ?? null,
        first_predicted_at: times[0] ?? null,
        predictors: [...new Set(fwd.map((p) => p.predictor_id))].sort(),
        frozen: fwd.some(isFrozen),
        mean_p_granted: probs.length ? +(probs.reduce((a, b) => a + b, 0) / probs.length).toFixed(2) : null,
        resolved: Boolean(ev.outcome),
        actual_disposition: ev.outcome?.actual_disposition ?? null,
        resolved_at: ev.outcome?.resolved_at ?? null,
        evaluations: ev.evaluations.length,
      });
    }
    rows.sort((a, b) => (b.first_predicted_at ?? "").localeCompare(a.first_predicted_at ?? ""));

    const out = {
      built_at: new Date().toISOString(),
      source: { repo: REPO, branch: BRANCH, sha: head.sha, committed_at: head.at },
      frozen_process: { since: frozen.since ?? null, digests: frozen.digests?.length ?? 0 },
      counts: {
        events_with_predictions: rows.length,
        events_open: rows.filter((r) => !r.resolved).length,
        events_resolved: rows.filter((r) => r.resolved).length,
        predictions: predictionsTotal,
        predictions_frozen: predictionsFrozen,
        evaluations: evaluationsTotal,
        leaderboard_events_scored: metrics.leaderboard?.events_scored ?? 0,
        leaderboard_predictors_ranked: metrics.leaderboard?.predictors_ranked ?? 0,
      },
      predictors,
      rows,
      summaries,
      metrics: { leaderboard: metrics.leaderboard, big_cases: metrics["big-cases"], statpack_terms: metrics.statpack?.interim?.terms ?? null },
    };
    await mkdir(dirname(fileURLToPath(OUT)), { recursive: true });
    await writeFile(OUT, JSON.stringify(out, null, 1));
    console.log(`ledger.json: ${rows.length} events, ${predictionsTotal} predictions (${predictionsFrozen} frozen-scope), ${Object.keys(summaries).length} case summaries, sha ${head.sha ?? "unknown"}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
