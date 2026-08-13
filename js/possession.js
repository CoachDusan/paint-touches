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

// The same six outcomes read from the other bench. Identical values and
// identical point math — only the wording changes, so muscle memory carries
// over between the two sides. A turnover is the one that flips meaning:
// on defense it's something you forced, not something you lost.
export const DEFENSE_OUTCOME_LABELS = {
  "2PM": "2PT Allowed",
  "2PA": "2PT Missed",
  "3PM": "3PT Allowed",
  "3PA": "3PT Missed",
  FT: "Free Throws",
  TO: "Forced TO",
};

// Which side of the ball a possession belongs to. Records written before
// the defensive side existed have no marker at all and are read as offense,
// which is what they are — see sideOf().
export const SIDES = { OFFENSE: "offense", DEFENSE: "defense" };

export function sideOf(possession) {
  return possession.side === SIDES.DEFENSE ? SIDES.DEFENSE : SIDES.OFFENSE;
}

// Marks a possession where the coverage was executed cleanly. Stored as a
// real value rather than null so "we ran it right" is a countable result,
// not an absence — without it there's no denominator to judge a coverage by.
export const NO_MISTAKE = { id: "none", name: "No mistake" };

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
