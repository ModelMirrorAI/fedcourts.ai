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
const UPDATES_OUT = new URL("../src/data/updates/", import.meta.url);

const WANT = /^[^/]+\/(metrics\/[^/]+\.json|metrics\/updates\/\d{4}-W\d{2}\.md|data\/qp-topics\/qp-topics(-applications)?\.json|data\/cases\/.*\/(event\.yaml|outcome\.json|prediction\.json|prediction_summary\.md|evaluation\.json)|data\/cases\/[^/]+\/[^/]+\/summaries\/\d{4}-\d{2}-\d{2}\.md)$/;

// A case summary (docs/case-summaries.md in the ledger repo): YAML front matter
// written by the harness, then "## " sections of plain prose — three under body
// contract 1, five under contract 2 (which adds "In brief" first and "What each
// outcome would mean" last). Sections are kept by heading, so either contract
// parses unchanged. The harness rejects any markup, so the body is carried as
// text and rendered escaped.
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

// The weekly public updates (metrics/updates/<YYYY-Www>.md in the ledger repo):
// one file per week the email list was offered, written once by the pipeline
// and never re-rendered. Copied as committed, minus the first-line heading,
// which goes in the index as the week's title. A file whose first line is not
// a heading fails the build rather than publishing an untitled update.
async function copyUpdates(dir) {
  await rm(fileURLToPath(UPDATES_OUT), { recursive: true, force: true });
  await mkdir(UPDATES_OUT, { recursive: true });
  const weeks = [];
  for await (const f of glob("*.md", { cwd: join(dir, "metrics", "updates") })) {
    const week = f.slice(0, -3);
    if (!/^\d{4}-W\d{2}$/.test(week)) continue;
    const text = await readFile(join(dir, "metrics", "updates", f), "utf8");
    const m = text.match(/^# (.+)\n+([\s\S]*)$/);
    if (!m) throw new Error(`updates: metrics/updates/${f} does not open with a heading`);
    await writeFile(new URL(`${week}.md`, UPDATES_OUT), m[2]);
    weeks.push({ week, title: m[1].trim(), path: `metrics/updates/${f}` });
  }
  weeks.sort((a, b) => b.week.localeCompare(a.week));
  await writeFile(new URL("index.json", UPDATES_OUT), JSON.stringify({ weeks }, null, 1));
  return weeks.length;
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

// Every metrics/ file the tarball carries, extracted or not: the Data page
// links only the roll-ups that exist at the commit read.
const METRICS_FILE = /^[^/]+\/(metrics\/(?:[^/]+\.(?:json|md)|updates\/[^/]+\.md))$/;
const metricsFiles = new Set();

async function download(dir) {
  const res = await fetch(TARBALL);
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status}`);
  const file = join(dir, "repo.tgz");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  await tar.x({ file, cwd: dir, strip: 1, filter: (p) => {
    const m = p.match(METRICS_FILE);
    if (m) metricsFiles.add(m[1]);
    return WANT.test(p);
  } });
}

// A cell's prediction_summary.md (docs/predicted-artifacts.md in the ledger
// repo): about 80 words restating the prediction for a lay reader. Plain prose
// by contract, so it is carried as paragraphs of text and rendered escaped.
function parsePredictionSummary(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  return paragraphs.length ? paragraphs : null;
}

async function readJSON(p) { return JSON.parse(await readFile(p, "utf8")); }

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "fedcourts-"));
  try {
    const [head] = await Promise.all([headCommit(), download(dir)]);

    // --- metrics roll-ups (copied, not recomputed) ---
    const metrics = {};
    for (const name of ["leaderboard", "claim-scores", "statpack", "backtest", "big-cases", "docket"]) {
      try { metrics[name] = await readJSON(join(dir, "metrics", `${name}.json`)); } catch { metrics[name] = null; }
    }
    // --- case topics (docs/qp-topic.md): one primary label per case, plus an
    // optional secondary, from two labels artifacts that share one vocabulary —
    // the petitions' questions-presented labels and the emergency applications'
    // (`qp-topic-v1` keeps every petition label and boundary unchanged). Each is
    // copied only when its own run passed the agreement gate. Petitions are read
    // first, so a case carrying both keeps its petition label.
    const topics = {};
    const docketNumbers = {}; // case_id → Court docket number ("25-123"), where a labels artifact records one
    const topicsMeta = {};
    for (const [frame, file] of [["petitions", "qp-topics.json"], ["applications", "qp-topics-applications.json"]]) {
      let qp;
      try { qp = await readJSON(join(dir, "data", "qp-topics", file)); } catch { continue; /* no labels artifact for this frame yet: its cases show no topic tag */ }
      if (!qp.agreement?.gate_passed) continue;
      const own = {};
      for (const e of qp.entries ?? []) {
        if (e.case_id && e.docket_number && !docketNumbers[e.case_id]) docketNumbers[e.case_id] = String(e.docket_number);
        if (!e.case_id || !e.label || (topics[e.case_id] && !own[e.case_id])) continue;
        const prev = own[e.case_id];
        if (prev && (prev.batch ?? 0) > (e.batch ?? 0)) continue;
        own[e.case_id] = topics[e.case_id] = { label: e.label, secondary: e.secondary ?? null, batch: e.batch ?? null };
      }
      topicsMeta[frame] = {
        vocabulary: qp.vocabulary ?? null,
        labeler: qp.labeler ?? null,
        agreement_rate: qp.agreement?.overall_rate ?? null,
        reference_n: qp.agreement?.overall_n ?? null,
        cases: Object.keys(own).length,
      };
    }

    const frozen = metrics.leaderboard?.frozen_process ?? { digests: [], since: null };
    const frozenDigests = new Set(frozen.digests ?? []);
    const frozenSince = frozen.since ? Date.parse(frozen.since) : null;

    // --- walk the case tree ---
    const events = new Map();
    const summaries = {};
    const predictionSummaries = {}; // cell path → paragraphs
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
      else if (leaf === "prediction_summary.md" && parts[4] === "predictions" && parts.length === 8) {
        const parsed = parsePredictionSummary(await readFile(full, "utf8"));
        if (parsed) predictionSummaries[`data/cases/${parts.slice(0, -1).join("/")}`] = parsed;
        continue;
      }
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

    // Prediction summaries go out only for the cells the board shows a read of.
    const boardCells = new Set((metrics["big-cases"]?.rows ?? []).flatMap((r) => (r.events ?? []).flatMap((e) => (e.reads ?? []).map((x) => x.cell_path))));
    const predictionSummariesShown = Object.fromEntries(Object.entries(predictionSummaries).filter(([k]) => boardCells.has(k)));

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
      prediction_summaries: predictionSummariesShown,
      topics,
      topics_meta: topicsMeta,
      docket_numbers: docketNumbers,
      metrics: {
        leaderboard: metrics.leaderboard,
        big_cases: metrics["big-cases"],
        statpack_terms: metrics.statpack?.interim?.terms ?? null,
        // The statpack's per-Term counts the Data page indexes by Term, copied
        // field by field from its cert, interim and merits sections.
        statpack_by_term: metrics.statpack ? {
          cert: (metrics.statpack.terms ?? []).map((t) => ({
            term: t.term,
            grants: t.grants ?? null,
            filings: Object.fromEntries((t.classes ?? []).map((c) => [c.fee_class, c.filings ?? null])),
          })),
          interim: (metrics.statpack.interim?.terms ?? []).map((t) => ({ term: t.term, applications: t.applications ?? null })),
          merits: (metrics.statpack.merits?.terms ?? []).map((t) => ({ term: t.term, granted: t.granted ?? null, parsed: t.parsed ?? null })),
        } : null,
        // The docket pack's topic mix by stage, copied field by field; each
        // stage keeps its scope string, which the page prints beside it.
        topic_mix: (metrics.docket?.topic_mix?.stages ?? []).map((s) => ({
          stage: s.stage,
          vocabulary: s.vocabulary,
          cases: s.cases,
          rows: s.rows,
          scope_note: s.scope_note,
          shares: (s.shares ?? []).map((x) => ({
            label: x.label,
            cases: x.cases,
            rows: x.rows,
            share: x.share,
            classified_share: x.classified_share ?? null,
          })),
        })),
        files: [...metricsFiles].sort(),
      },
    };
    await mkdir(dirname(fileURLToPath(OUT)), { recursive: true });
    await writeFile(OUT, JSON.stringify(out, null, 1));
    const updates = await copyUpdates(dir);
    console.log(`ledger.json: ${rows.length} events, ${predictionsTotal} predictions (${predictionsFrozen} frozen-scope), ${Object.keys(summaries).length} case summaries, ${Object.keys(predictionSummariesShown).length} prediction summaries on the board, ${Object.keys(topics).length} topic labels, ${updates} weekly updates, sha ${head.sha ?? "unknown"}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
