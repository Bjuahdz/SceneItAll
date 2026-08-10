// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL — the design system, ported from Paper.
//
// Values are pulled from the Paper file "SCENE IT ALL" via the MCP (get_jsx /
// get_computed_styles), never read off a screenshot. The token names match the
// canvas token names so the two can be diffed by eye.
//
// Search is the first surface built to Signal; the rest of the app still runs the
// older palette (#0b0b0f ground, #9ccadf pasted as a literal in a dozen files).
// This module is deliberately additive — it changes nothing that already ships.
// ─────────────────────────────────────────────────────────────────────────────

export const SIGNAL = {
  ground: "#0A0908",
  surface: "#141210",
  surface2: "#1C1916",
  line: "#2A2521",
  ink: "#F2EDE4",
  muted: "#8A8279",
  accent: "#9CCADF", // --color-enlarger; the app's one verb colour
  accentDim: "#16242B",
  stock: "#EDE7DB",
  vermillion: "#E8442E", // faults only — never "your data"
} as const;

// Row colour tiers. These dim the WHOLE row, not just the title.
//
// Two different meanings share this palette, and conflating them is a real bug:
//   · In the TYPING list, bright vs dim encodes THE MATCHED PREFIX — every row's
//     matched characters are `ink` and the remainder is `titleDim`, whether or not
//     you have an entry. The entry is carried by the star alone.
//   · On an entity page's film sheet, bright vs dim encodes THE ENTRY — films you
//     have journaled are `titleEntry`, films you have not are `titleDim`.
export const ROW = {
  titleOpen: "#F7F3EC", // expanded marquee title, brightest tier
  titleEntry: "#E6E0D6", // has an entry
  titleDim: "#6F6862", // no entry / unmatched remainder / upcoming
  index: "#5C5651",
  indexDim: "#4A453F",
  year: "#8A8279",
  yearDim: "#5C5651",
} as const;

// ── Type ─────────────────────────────────────────────────────────────────────
// Static instances live in assets/fonts and are loaded by useFonts() in
// app/_layout.tsx — the KEYS there must match these strings exactly.
//
// ⚠ Each weight is its OWN family, and styles using them must NOT also set
// fontWeight. React Native cannot select a weight axis within a custom family, so a
// fontWeight alongside a custom fontFamily either does nothing or triggers synthetic
// bolding on Android — an already-ExtraBold face smeared bolder still.
export const FONT = {
  /** Bricolage Grotesque 800 — titles and display type. */
  display: "BricolageGrotesque_800ExtraBold",
  /** JetBrains Mono 400 — micro labels, indices, meta lanes. */
  mono: "JetBrainsMono_400Regular",
  /** JetBrains Mono 500 — the one weight up, used on section labels. */
  monoMedium: "JetBrainsMono_500Medium",
} as const;

// Paper expresses tracking in `em`; React Native's letterSpacing is in PX. Values
// must be multiplied by the font size at the point of use, so they are pre-computed
// here rather than recalculated (and mis-rounded) per component.
export const TRACK = {
  /** 0.14em at 11px — section labels, counts. */
  micro11: 1.54,
  /** 0.14em at 10px — row meta lane. */
  micro10: 1.4,
  /** 0.06em at 11px — row index. */
  index11: 0.66,
  /** -0.02em at 19px — row title. */
  title19: -0.38,
} as const;

// Tracking values for the larger type, same em→px conversion as above.
export const TRACK2 = {
  /** -0.02em at 18px — collapsed row titles (ledger + submitted results). */
  title18: -0.36,
  /** -0.03em at 25px — marquee title. */
  marquee25: -0.75,
  /** -0.035em at 25px — the person marquee's slightly tighter title. */
  marquee25Person: -0.875,
  /** -0.03em at 30px — the empty-state headline. */
  display30: -0.9,
  /** 0.12em at 11px — the marquee's index. */
  marqueeIndex: 1.32,
  /** 0.18em at 9px — the marquee's type tag and CTA label. */
  tag9: 1.62,
} as const;

// ── The expanded marquee card ────────────────────────────────────────────────
// One component across every board; only the image, the scrim stops and the CTA
// verb change. Verified byte-identical on the recents ledger, the submitted result
// and the person result.
export const MARQUEE = {
  // NO WIDTH. The card SPANS THE CONTENT COLUMN, exactly like a collapsed row —
  // its width is `screenW − 2 · padH`, derived where it is used.
  //
  // There was a `width: 350` here, straight off the board, capped by a
  // `Math.min(350, column)`. On the 390pt frame it was drawn for, 350 IS the
  // column, so the two agreed and nobody noticed. On any wider phone the cap won:
  // the card stayed 350 while the rows spanned the full column, and because the
  // card is left-aligned in that column every pixel of slack collected on the
  // right — a card visibly narrower than the list and off-centre with it (Bryan,
  // device, 2026-08-01).
  //
  // The HEIGHTS below stay exactly as tuned. A wider card at the same height is a
  // slightly wider frame, and the artwork is cover-fit, so the only effect is a
  // marginally different crop — no distortion, and no re-tuning of numbers Bryan
  // set on device.
  height: 290,
  /**
   * PEOPLE GET A TALLER CARD (Bryan, 2026-07-30, from device testing).
   *
   * Every other entity opens into landscape artwork — a film backdrop, a collection
   * backdrop — which is what 219 was drawn for. A person only has a PORTRAIT, and
   * TMDB profiles are 2:3. Cropping one into a 350×219 box shows a horizontal band
   * roughly a third of the way down the frame, so faces came out sliced: forehead
   * and eyes, no chin.
   *
   * Bryan tuned this to 400 on device. That is taller than the card is wide, which
   * is correct for the one entity whose artwork is genuinely a portrait — it shows
   * roughly three quarters of the frame instead of a third.
   *
   * ⚠ If you change this, re-check SCRIM.person. Those stops are proportional, so a
   * height change moves where the dark ramp lands on the face.
   */
  heightPerson: 430,
  radius: 16,
  /** The wrapper's own padding — the card sits in a 249-tall slot. */
  padTop: 14,
  padBottom: 16,
  /** Overlay insets. Everything hangs off left 18 / top 16 / bottom 16. */
  inset: 18,
  insetTop: 16,
  /**
   * The identity plate's bottom inset — and the card's ONLY bottom anchor.
   *
   * There were two (plate 44, CTA 16) because the verb had its own line under the
   * plate. It now shares the plate's bottom lane, so 44 would leave exactly the hole
   * the verb used to fill.
   *
   * 30 IS DERIVED, not picked. The old three-line composition spanned 16→87 from the
   * card's bottom edge, so its optical centre sat at ~51. Losing a line makes the
   * block 43 tall (title 26 + gap 5 + lane 12); anchoring that at 16 dragged the
   * whole thing 28px DOWN and jammed it against the edge — Bryan's "everything now
   * is being squished down to the bottom". 51 − 43/2 ≈ 30 puts the block's centre
   * back where the composition (and the card heights tuned around it) expects it.
   */
  plateBottom: 30,
} as const;

// Scrim stops. Every one of these is the SAME colour — rgba(10,9,8) = the ground.
// Paper authors them in oklab, and one extraction pass mis-resolved the person
// variant as --color-surface; read at the source, `oklab(14.1% 0.001 0.003)` is
// #0A0908 on all three. Only the ALPHAS and STOPS genuinely differ.
type Stop = { a: number; at: number };
export const SCRIM: Record<"default" | "submitted" | "person", Stop[]> = {
  /** Recents ledger, collection and person-page marquees. */
  default: [
    { a: 0.4, at: 0 },
    { a: 0.12, at: 0.32 },
    { a: 0.72, at: 0.74 },
    { a: 0.96, at: 1 },
  ],
  /** Submitted results — a stronger top stop, because over a bright sky (Dune 2021)
   *  the index + type tag was illegible at 0.40. */
  submitted: [
    { a: 0.66, at: 0 },
    { a: 0.16, at: 0.3 },
    { a: 0.74, at: 0.74 },
    { a: 0.96, at: 1 },
  ],
  /**
   * The person result marquee.
   *
   * Retuned 2026-07-30 for the taller card: the dark ramp used to reach 0.80 by 70%,
   * which on a 219px card was a small band but at 400px buried the middle of the
   * portrait — roughly 0.52 alpha across the face. The stops below hold a genuine
   * clear window from 30% to 56% and only start flooding at 56%, hitting full cover
   * at 80%.
   *
   * The floor on how low it can start is the identity plate: its top edge lands near
   * 78% of the card, so the ramp has to be well underway by then or the title loses
   * contrast against a bright portrait.
   */
  person: [
    { a: 0.55, at: 0 },
    { a: 0.1, at: 0.3 },
    { a: 0.14, at: 0.56 },
    { a: 0.74, at: 0.8 },
    { a: 0.97, at: 1 },
  ],
};

/** Ground with an alpha — the only colour any scrim uses. */
export const groundAlpha = (a: number) => `rgba(10,9,8,${a})`;
/** SIGNAL.ink at an alpha — the WARM light. */
export const inkAlpha = (a: number) => `rgba(242,237,228,${a})`;
/** SIGNAL.accent at an alpha — the COLD light. The two temperatures drifting past
 *  each other is what makes the arrival band read as an aurora rather than a haze. */
export const accentAlpha = (a: number) => `rgba(156,202,223,${a})`;

// How much colour comes out of artwork. React Native 0.76+ supports the `filter`
// style prop natively on both platforms, so these are real values, not aspirations.
export const GRAYSCALE = {
  /** Backdrops — film, collection, and the collapsed bars. */
  backdrop: 0.22,
  /** A person's photo cropped into a landscape marquee. */
  personMarquee: 0.3,
  /** A person's full-bleed portrait hero — heavier, so it doesn't fight the
   *  colour marquees below it. */
  personHero: 0.38,
  /** The studio poster wall, where many posters must read as one surface. */
  posterWall: 0.88,
} as const;

// ── Search-list geometry, straight off the TYPING board ──────────────────────
export const SEARCH_LAYOUT = {
  /** Page gutters: paddingInline 20, paddingTop 76 on the Results frame. */
  padH: 20,
  padTop: 76,
  /**
   * The search screen's scroll content inset. 64 clears the 62px status bar on every
   * state except the new-account board, which sits 76 down for its headline.
   *
   * Named because the recents board has to convert a tile's board-space Y into a
   * SCREEN Y to know how close it is to the bottom edge, and that sum starts here.
   * It was a bare 64 in the screen's stylesheet, invisible to anything that needed it.
   */
  contentTop: 64,
  /**
   * ▸ THE TOP EDGE TREATMENT, as geometry rather than as a stylesheet detail.
   *
   * `topEdge` is the whole band; `topEdgeSolid` is the head of its mask, above which
   * content is completely hidden. The remainder is the ramp where it is dissolving.
   *
   * Named because the recents board fades a tile out AS IT GOES UNDER THIS BAND, and
   * that only works if both are reading the same two numbers. They were constants in
   * the screen's stylesheet and hand-guessed approximations in the tile, and the two
   * disagreed by more than 100pt — which put the whole top of the board permanently
   * inside a fade meant for content on its way out.
   */
  topEdge: 308,
  topEdgeSolid: 54,
  /** Every result row is exactly this tall, hairline included. */
  rowHeight: 62,
  /** Gap between the index, the title block and the marker slot. */
  rowGap: 14,
  /** The index lane. Fixed so titles start on one vertical line. */
  indexWidth: 20,
  /** The marker slot ALWAYS occupies this width, even when empty — dropping it
   *  when there is no star breaks the year lane across rows. */
  markerWidth: 14,
} as const;
