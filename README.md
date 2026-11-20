# fedcourts.ai

The public site for [FedCourtsAI](https://github.com/ModelMirrorAI/fedcourtsai). Static, built with Astro, hosted on Cloudflare Pages.

## How it fits together

- **Content** is Markdown/MDX under `src/pages/`. Edit it in the GitHub UI, open a PR, and Cloudflare Pages attaches a preview URL to the branch.
- **Data** is never hand-edited. `scripts/fetch-ledger.mjs` runs before every build (`prebuild`), downloads the `fedcourtsai` repo tarball, counts what is in `data/cases`, copies the committed `metrics/` roll-ups, and writes `src/data/ledger.json` (gitignored). Components read from that file. The ledger rows, `ledger.counts` and `ledger.predictors` are the Supreme Court docket's; events in any other court belong to a prediction slice and are written apart, under `ledger.slices`, so no figure of the Court's counts them.
- **Results** come from `scripts/fetch-results.mjs`, which runs after the ledger fetch. The list of releases is the release manifest committed in `fedcourtsai` (`docs/releases.json`), read from `main`, so publishing a release needs no change here. Each release it lists is read from the `fedcourtsai` repo at its own tag (for Release 1, `docs/release-ot2026-public-summary.md` at `results/ot2026-longconf`) and nowhere else. `/results` lists every release, newest first, and each published one gets its own page at `/results/<slug>`; a release whose tag doesn't exist yet is listed as upcoming, and the first rebuild after the tag is pushed publishes it. A manifest that cannot be read, does not parse or lists no releases fails the build, and so, once a release's tag exists, does an unreadable summary or any unfilled `‹…›` placeholder, so Pages keeps the last good deploy.
- **Freshness** comes from `.github/workflows/rebuild.yml`, which runs the same build daily and calls the Cloudflare deploy hook only if it passes, so a ledger change that breaks the site shows up as a red scheduled run instead of a silently failed deploy. It never commits here.
- **Status** comes from `scripts/fetch-status.mjs`, which copies `status.json` from the `fedcourtsai` repo's `ops-metrics` branch to `src/data/status.json` (gitignored). The pipeline's run-ops job writes that file every morning, before the daily rebuild: which scheduled jobs are on time, what they produced over 7 days, 30 days and the Term, coverage, and the back-test headlines. `/status` lays it out as written. A malformed file or an unexpected schema fails the build; a file not yet published leaves the page saying so.
- **Checks**: `.github/workflows/build.yml` runs `npm ci` and `npm run build` on every PR into `main`, and its `build` check is required before a PR can merge. `.github/workflows/lint-actions.yml` runs zizmor and actionlint on any change under `.github/`, and `.github/dependabot.yml` keeps the pinned actions and npm dependencies current. Agent conventions are in [AGENTS.md](AGENTS.md).

## Components available in MDX

| Component | What it renders |
|---|---|
| `<LedgerTable />` | Every event with a forward prediction, newest first |
| `<Stamp />` | "Updated `<date>` · ledger commit `<sha>`", pointing at the exact commit read |
| `<BigCaseBoard />` | The front page's big-case board, built from `<BigCaseEntry />` and `<CaseTimeline />` |
| `<EventKey />` | The collapsed key to the forecast moments in `src/lib/moments.js` |
| `<Signup />` | The email signup form |

Figures on a page come from `ledger.counts` in `src/data/ledger.json`. Import a component at the top of a page: `import Stamp from "../components/Stamp.astro";`

## Local build (optional)

```bash
npm install
npm run build      # runs the three fetches first
npm run preview
```

`npm run dev` needs the fetched files under `src/data/` to exist; run `npm run fetch` once first.
