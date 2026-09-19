// The declared forecast moments, keyed by event id. A hand-kept mirror of
// DECLARED_MOMENTS in fedcourtsai/src/fedcourtsai/pipeline/moments.py — that
// table is closed and code-owned, so this changes only when a row is added there.
// `binary` names what `probability` is the probability OF at that stage
// (docs/predicted-artifacts.md); `hasCall` is false where predicted_disposition
// carries nothing (merits cells write `other`; the forecast lives in `judgment`).
const STAGES = {
  cert: { label: "cert", question: "Will the Court take the case?", binary: "granted", hasCall: true },
  interim: { label: "interim", question: "Will the Court grant the emergency application?", binary: "granted", hasCall: true },
  merits: { label: "merits", question: "Will the Court disturb the judgment below?", binary: "disturbed", hasCall: false },
};

const m = (stage, when) => ({ stage, when, ...STAGES[stage] });

export const MOMENTS = {
  "evt-petition-arrival-disposition": m("cert", "at docketing, before the petition is distributed or the docket shows anything"),
  "evt-petition-disposition": m("cert", "once the petition is distributed for conference, relists included"),
  "evt-order-cvsg-disposition": m("cert", "after the Court asks for the Solicitor General's views"),
  "evt-motion-disposition": m("interim", "when the application arrives"),
  "evt-order-response-requested-disposition": m("interim", "after the Court calls for a response"),
  "evt-brief-response-disposition": m("interim", "once a response is filed"),
  "evt-order-judgment": m("merits", "at the cert grant"),
  "evt-brief-judgment": m("merits", "once both sides' merits briefs are in"),
};

export const STAGE_ORDER = ["cert", "interim", "merits"];
export { STAGES };
export const momentFor = (eventId) => MOMENTS[eventId] ?? null;
