# fedcourts.ai

The public site for [FedCourtsAI](https://github.com/ModelMirrorAI/fedcourtsai). Static, built with Astro, hosted on Cloudflare Pages.

## How it fits together

- **Content** is Markdown/MDX under `src/pages/`. Edit it in the GitHub UI, open a PR, and Cloudflare Pages attaches a preview URL to the branch.
- **Data** is never hand-edited. `scripts/fetch-ledger.mjs` runs before every build (`prebuild`), downloads the `fedcourtsai` repo tarball, counts what is in `data/cases`, copies the committed `metrics/` roll-ups, and writes `src/data/ledger.json` (gitignored). Components read from that file.
- **Freshness** comes from `.github/workflows/rebuild.yml`, which calls the Cloudflare deploy hook daily. It never commits here.

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
