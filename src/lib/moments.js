// The declared forecast moments, keyed by event id. A hand-kept mirror of
// DECLARED_MOMENTS in fedcourtsai/src/fedcourtsai/pipeline/moments.py — that
// table is closed and code-owned, so this changes only when a row is added there.
// `binary` names what `probability` is the probability OF at that stage
// (docs/predicted-artifacts.md); `hasCall` is false where predicted_disposition
// carries nothing (merits cells write `other`; the forecast lives in `judgment`).
// `chance` is the plain-language label for the probability, and `calls` maps
// each disposition the ledger writes at that stage to the words the board shows.
const STAGES = {
  cert: {
    label: "cert",
    question: "Will the Court take the case?",
    binary: "granted",
    hasCall: true,
    chance: "Chance the Court takes the case",
    calls: {
      granted: "take the case",
      denied: "turn it down",
      gvr: "send it back for reconsideration (GVR)",
      "summary-reversal": "reverse without hearing argument",
      dismissed: "dismiss it",
    },
  },
  interim: {
    label: "interim",
    question: "Will the Court grant the emergency application?",
    binary: "granted",
    hasCall: true,
    chance: "Chance the Court grants the application",
    calls: {
      granted: "grant it",
      denied: "deny it",
      dismissed: "dismiss it",
    },
  },
  merits: {
    label: "merits",
    question: "Will the Court reverse or vacate the decision below?",
    binary: "disturbed",
    hasCall: false,
    chance: "Chance the Court reverses or vacates",
    calls: {},
  },
};

const m = (stage, when) => ({ stage, when, ...STAGES[stage] });

export const MOMENTS = {
  "evt-petition-arrival-disposition": m("cert", "when the petition was docketed, before it was distributed or the docket showed anything"),
  "evt-petition-disposition": m("cert", "once the petition was distributed for conference (and again after each relist)"),
  "evt-order-cvsg-disposition": m("cert", "after the Court asked for the Solicitor General's views"),
  "evt-motion-disposition": m("interim", "when the application arrived"),
  "evt-order-response-requested-disposition": m("interim", "after the Court called for a response"),
  "evt-brief-response-disposition": m("interim", "once a response was filed"),
  "evt-order-judgment": m("merits", "when the Court agreed to hear the case"),
  "evt-brief-judgment": m("merits", "once both sides' merits briefs were in"),
};

export const STAGE_ORDER = ["cert", "interim", "merits"];
export { STAGES };
export const momentFor = (eventId) => MOMENTS[eventId] ?? null;

// Plain words for a disposition, falling back to the ledger's own token.
export const plainCall = (stage, disposition) => STAGES[stage]?.calls?.[disposition] ?? disposition;

// Plain words for what the Court actually did on an event.
export const plainOutcome = (stage, disposition) => {
  const words = {
    cert: { granted: "took the case", denied: "turned it down", gvr: "sent it back for reconsideration (GVR)", "summary-reversal": "reversed without argument", dismissed: "dismissed it" },
    interim: { granted: "granted the application", denied: "denied the application", dismissed: "dismissed the application" },
    merits: { disturbed: "reversed or vacated", affirmed: "affirmed", dismissed: "dismissed the case" },
  };
  return words[stage]?.[disposition] ?? disposition;
};
