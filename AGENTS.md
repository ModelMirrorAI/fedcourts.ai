# AGENTS.md

Instructions for AI coding agents working on this repository. `CLAUDE.md`
points here. Read it before changing anything.

## What this repository is

The public site for [FedCourtsAI](https://github.com/ModelMirrorAI/fedcourtsai):
a static Astro site, deployed by Cloudflare Pages from `main`. Pages are
Markdown/MDX under `src/pages/`; components under `src/components/`. The
README describes how the pieces fit together.

The site **states what the fedcourtsai repo states and computes nothing**.
Every figure, ledger row and result comes from fedcourtsai at build time:
`scripts/fetch-ledger.mjs` reads `main`, `scripts/fetch-results.mjs` reads
each release at its own tag. Never type a figure, a count, a date of a
result or a quoted finding into a page: render it from the fetched data, or
change fedcourtsai so the data carries it. A page that restates a result in
prose quotes the release's own public summary, not a paraphrase of it.

## How a change lands

- **Branch and PR.** Never push to `main`. Branch off `main`
  (`git switch -c <type>/<short-description> origin/main`), open one focused
  PR against `main` with a conventional-commit title and a description of what
  changed and why. There is no staging branch: `main` is what deploys.
- **The maintainer approves and merges every PR.** The `main` ruleset
  requires the maintainer's approval and a green `build` check. Do not merge,
  and never submit an approving review on any PR.
- **Interactive sessions act as the agent account** (`modelmirror-agent`),
  which holds write and no bypass. `gh api user --jq .login` says which
  account you are; a session holding the maintainer's credentials is bound by
  these rules as discipline rather than by the platform.
- **Show the change.** Cloudflare Pages attaches a preview deployment to each
  PR branch. For a visible change, name the pages it affects in the PR
  description so the maintainer knows where to look on the preview.

## Local gate

```bash
npm ci
npm run build      # runs both fetches first, then the Astro build
```

The build needs network access to `github.com`, `codeload.github.com` and
`raw.githubusercontent.com`. CI runs the same two commands
(`.github/workflows/build.yml`), and that `build` check is required on `main`.
Run it before you push. A build that fails on a fetch is a real failure:
the fetch scripts fail closed, so Pages keeps the last good deploy.

## Conventions

- **Node** version is pinned in `.nvmrc`; dependencies through
  `package-lock.json` (`npm ci`, never `npm install` in CI).
- **Workflows.** Anything under `.github/` is the deploy and permission
  surface. Pin every action to a full commit SHA with its version in a
  comment, grant `permissions` per workflow at the minimum, and say in the PR
  description what the change can reach. `rebuild.yml` only pokes the
  Cloudflare deploy hook; it never commits here.
- **No secrets.** The deploy hook URL is a repository secret; never print it,
  log it, or copy it anywhere. Refer to configuration by its role in PR and
  issue text, not by a variable name or value.
- **Identity.** Commits use a GitHub `noreply` address. No personal or
  organizational email addresses anywhere in the repository.
- **Docs and comments describe the current design**, not its history: no
  "we used to / now we", no changelog prose. Issue numbers belong in PR
  descriptions and commit messages only.
- **Cross-repository changes.** A fedcourtsai change that alters a file or
  field the fetch scripts read (`metrics/*.json`, the case and event records
  under `data/cases/`, the summaries, a release document) needs a matching PR
  here, opened alongside it and linked from both descriptions.
