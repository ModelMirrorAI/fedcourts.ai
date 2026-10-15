# fedcourts.ai

The public site for [FedCourtsAI](https://github.com/ModelMirrorAI/fedcourtsai). Static, built with Astro, hosted on Cloudflare Pages.

## How it fits together

- **Content** is Markdown/MDX under `src/pages/`. Edit it in the GitHub UI, open a PR, and Cloudflare Pages attaches a preview URL to the branch.
- **Data** is never hand-edited. `scripts/fetch-ledger.mjs` runs before every build (`prebuild`), downloads the `fedcourtsai` repo tarball, counts what is in `data/cases`, copies the committed `metrics/` roll-ups, and writes `src/data/ledger.json` (gitignored). Components read from that file.
- **Results** come from `scripts/fetch-results.mjs`, which runs after the ledger fetch. Each release listed in `src/lib/releases.js` is read from the `fedcourtsai` repo at its own tag (for Release 1, `docs/release-ot2026-public-summary.md` at `results/ot2026-longconf`) and nowhere else. `/results` lists every release, newest first, and each published one gets its own page at `/results/<slug>`; a release whose tag doesn't exist yet is listed as upcoming, and the first rebuild after the tag is pushed publishes it. Once a release's tag exists, an unreadable summary or any unfilled `‹…›` placeholder fails the build, so Pages keeps the last good deploy. The release list is an interim site-side copy; it moves to a manifest committed in `fedcourtsai` (#31).
- **Freshness** comes from `.github/workflows/rebuild.yml`, which calls the Cloudflare deploy hook daily. It never commits here.
- **Checks**: `.github/workflows/build.yml` runs `npm ci` and `npm run build` on every PR into `main`, and its `build` check is required before a PR can merge. Agent conventions are in [AGENTS.md](AGENTS.md).

## Components available in MDX

| Component | What it renders |
|---|---|
| `<Stats />` | The headline counters with a ledger stamp |
| `<LedgerStat key="…" label="…" note="…" />` | One figure from `ledger.counts` (`events_open`, `events_resolved`, `events_with_predictions`, `predictions`, `predictions_frozen`, `evaluations`, `leaderboard_events_scored`, `leaderboard_predictors_ranked`) |
| `<LedgerTable limit={n} onlyOpen onlyResolved />` | The ledger table, newest first |
| `<Stamp />` | "ledger `<sha>` · `<time>`" pointing at the exact commit read |

Import them at the top of a page: `import Stats from "../components/Stats.astro";`

## Local build (optional)

```bash
npm install
npm run build      # runs the fetch first
npm run preview
```

`npm run dev` needs `src/data/ledger.json` to exist; run `npm run fetch` once first.
