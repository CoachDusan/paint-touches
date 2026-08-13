// The single, locked rule for how many points a possession is worth.
// Called once, at the moment a possession closes, and the result is
// stored on the record permanently — nothing ever recomputes this later,
// so live stats (Stage 4) and historical stats (Stage 5) can never
// disagree with each other.
export function pointsForOutcome(outcome, { andOne, ftAttempt } = {}) {
  switch (outcome) {
    case "2PM":
      return 2 + (andOne && andOne.made ? 1 : 0);
    case "3PM":
      return 3 + (andOne && andOne.made ? 1 : 0);
    case "FT":
      return ftAttempt ? ftAttempt.made : 0;
    case "2PA":
    case "3PA":
    case "TO":
    default:
      return 0;
  }
}

export const OUTCOMES = ["2PM", "2PA", "3PM", "3PA", "FT", "TO"];

export const QUARTERS = ["1", "2", "3", "4", "OT"];

export const OUTCOME_LABELS = {
  "2PM": "2PT Made",
  "2PA": "2PT Miss",
  "3PM": "3PT Made",
  "3PA": "3PT Miss",
  FT: "Free Throw",
  TO: "Turnover",
};

// One tap per valid free-throw trip (up to 3 attempts covers every normal
// game situation: 1-and-1, 2-shot foul, 3-shot foul/technicals).
export const FT_COMBOS = [
  { made: 0, attempts: 1 },
  { made: 1, attempts: 1 },
  { made: 0, attempts: 2 },
  { made: 1, attempts: 2 },
  { made: 2, attempts: 2 },
  { made: 0, attempts: 3 },
  { made: 1, attempts: 3 },
  { made: 2, attempts: 3 },
  { made: 3, attempts: 3 },
];
