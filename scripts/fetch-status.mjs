// Build-time fetch of the pipeline's daily status snapshot.
//
// fedcourtsai's run-ops job renders status.json every morning (`fedcourts
// ops-report --status-out`) and pushes it to the repo's `ops-metrics` branch,
// beside its ops snapshots: it carries a time of day, so it never lands on
// `main`. This copies it to src/data/status.json for the Status page as
// published. Every figure and every state in it was decided by the pipeline;
// the page only lays it out.
//
// Fails closed like the other fetches: an unreachable branch, a malformed file,
// or a schema this page was not written for fails the build, and Pages keeps
// the last good deploy. A 404 alone is not a failure: until the snapshot has
// first been published the page says so instead.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "ModelMirrorAI/fedcourtsai";
const BRANCH = "ops-metrics";
const URL_ = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/status.json`;
const OUT = new URL("../src/data/status.json", import.meta.url);
const SCHEMA = "1.0";

async function main() {
  const res = await fetch(URL_);
  let status = null;
  if (res.status === 404) {
    console.log(`status.json: not yet published on ${BRANCH}`);
  } else if (!res.ok) {
    throw new Error(`status fetch failed: ${res.status}`);
  } else {
    status = await res.json();
    if (status?.schema_version !== SCHEMA) {
      throw new Error(`status.json: schema ${status?.schema_version} is not ${SCHEMA}`);
    }
    for (const key of ["generated_at", "lanes", "production", "coverage", "backtests"]) {
      if (status[key] == null) throw new Error(`status.json: no ${key}`);
    }
    console.log(`status.json: generated ${status.generated_at}, ${status.lanes.length} lanes, ${status.backtests.length} back-tests`);
  }
  const out = { source: { repo: REPO, branch: BRANCH, url: URL_ }, status };
  await mkdir(dirname(fileURLToPath(OUT)), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1));
}

await main();
