// Build-time fetch of the FedCourtsAI ledger.
//
// Downloads the public repo tarball (no API token, no rate limit), walks
// data/cases/** for the derived judgments, reads the committed metrics
// roll-ups, and writes src/data/ledger.json for the pages to render.
// The site never computes anything the repo doesn't already state; it
// counts files and copies figures, each stamped with the commit they came from.

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { glob } from "node:fs/promises";
import * as tar from "tar";
import YAML from "yaml";

const REPO = "ModelMirrorAI/fedcourtsai";
const BRANCH = "main";
const TARBALL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;
const COMMITS_FEED = `https://github.com/${REPO}/commits/${BRANCH}.atom`;
const OUT = new URL("../src/data/ledger.json", import.meta.url);

const WANT = /^[^/]+\/(metrics\/[^/]+\.json|data\/cases\/.*\/(event\.yaml|outcome\.json|prediction\.json|evaluation\.json))$/;

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
    for (const name of ["leaderboard", "claim-scores", "statpack", "backtest"]) {
      try { metrics[name] = await readJSON(join(dir, "metrics", `${name}.json`)); } catch { metrics[name] = null; }
    }
    const frozen = metrics.leaderboard?.frozen_process ?? { digests: [], since: null };
    const frozenDigests = new Set(frozen.digests ?? []);
    const frozenSince = frozen.since ? Date.parse(frozen.since) : null;

    // --- walk the case tree ---
    const events = new Map();
    const base = join(dir, "data", "cases");
    for await (const f of glob("**/*", { cwd: base })) {
      const parts = f.split(sep);
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
      metrics: { leaderboard: metrics.leaderboard, statpack_terms: metrics.statpack?.interim?.terms ?? null },
    };
    await writeFile(OUT, JSON.stringify(out, null, 1));
    console.log(`ledger.json: ${rows.length} events, ${predictionsTotal} predictions (${predictionsFrozen} frozen-scope), sha ${head.sha ?? "unknown"}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
