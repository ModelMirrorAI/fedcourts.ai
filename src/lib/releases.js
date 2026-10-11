// Results releases, newest first. Each one is published from its git tag in
// the fedcourtsai repo by scripts/fetch-results.mjs and gets its own page at
// /results/<slug>. A release listed here before its tag exists shows on the
// Results index as upcoming, and publishes on the first rebuild after the tag.
//
// Interim: this list lives in the site for now. It moves to a manifest
// committed in fedcourtsai alongside each release, so publishing a release
// never needs a site change (fedcourts.ai#31, fedcourtsai#2356).

export const RESULTS_REPO = "ModelMirrorAI/fedcourtsai";

export const RELEASES = [
  {
    slug: "ot2026-longconf",
    label: "Release 1",
    tag: "results/ot2026-longconf",
    published: "2026-10-09",
    covers: "The Supreme Court’s first conference of the October 2026 Term: which petitions it would take up",
    summary: "docs/release-ot2026-public-summary.md",
    audit: "docs/release-ot2026-long-conference.md",
    data_doi: "10.5281/zenodo.23263986",
  },
];
