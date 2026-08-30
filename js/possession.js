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
    // A foul is worth nothing by itself. If it sent them to the line, that
    // trip gets logged as FT instead, which is where the points come from.
    case "FOUL":
    default:
      return 0;
  }
}

export const OUTCOMES = ["2PM", "2PA", "3PM", "3PA", "FT", "FOUL", "TO"];

// A non-shooting foul doesn't end the trip down the floor — the ball comes
// back in and play continues — so it is logged and counted, but held out of
// every PPP denominator. Counting it as a 0-point possession would punish an
// offense for drawing fouls and flatter a defense for committing them, which
// is exactly backwards. Every stat bucket therefore tracks two totals:
// `trips` (everything you tapped) and `possessions` (what PPP divides by).
export function endsPossession(outcome) {
  return outcome !== "FOUL";
}

export const QUARTERS = ["1", "2", "3", "4", "OT"];

export const OUTCOME_LABELS = {
  "2PM": "2PT Made",
  "2PA": "2PT Miss",
  "3PM": "3PT Made",
  "3PA": "3PT Miss",
  FT: "Free Throw",
  FOUL: "Foul",
  TO: "Turnover",
};

// The same outcomes read from the other bench. Identical values and
// identical point math — only the wording changes, so muscle memory carries
// over between the two sides. A turnover is the one that flips meaning:
// on defense it's something you forced, not something you lost.
export const DEFENSE_OUTCOME_LABELS = {
  "2PM": "2PT Made",
  "2PA": "2PT Missed",
  "3PM": "3PT Made",
  "3PA": "3PT Missed",
  FT: "Free Throws",
  FOUL: "Foul",
  TO: "Forced TO",
};

// Colour is the fastest thing to hit under pressure — the eye lands on the
// green block before it reads the word. Deliberately colour-by-event, not
// colour-by-good-news: green always means the ball went in, on either side
// of the ball. So a tap keeps the same place AND the same colour whichever
// bench you're tracking, and switching sides never costs you a beat.
export const OUTCOME_TONES = {
  "2PM": "make",
  "2PA": "miss",
  "3PM": "make",
  "3PA": "miss",
  FT: "ft",
  FOUL: "foul",
  TO: "to",
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
