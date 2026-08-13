import React, { createContext, useContext, useMemo, useRef } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

import type { EntityPage } from "@/services/entities";

/**
 * THE MOVIE SHEET'S ONE CLOCK.
 *
 * The movie detail page presents as a card sheet over whatever screen the user
 * was on, and that screen visibly RECEDES behind it — scales down, drops below
 * the status bar, dims (the Plex / iOS card-stack look, Bryan 2026-08-11).
 * The native pageSheet could not be used for this: whatever UIKit currently
 * does with `presentation: "modal"` on this device, its interactive drag never
 * reaches JS, so the background could only ever react AFTER the gesture — the
 * exact early/late trap the nav pill timing rounds were about. So the app owns
 * the layer, and this context is the single clock both sides read:
 *
 *   · /movie/[id] (a transparent route) WRITES `progress`: 0 = no sheet,
 *     1 = sheet seated. It is the only writer.
 *   · The (tabs) layout READS it and recedes its whole tree by exactly that
 *     amount, every frame, on the UI thread.
 *
 * Because sheet travel and background recede are pure functions of one shared
 * value, they cannot disagree — during the spring in, the eased slide out, and
 * (increment 2) under a live finger mid-drag.
 *
 * The geometry both sides must agree on lives here too, so there is exactly
 * one copy of the presentation grammar.
 */

/** How small the receded card gets. Derived, not tuned: the Plex card shows
 *  ~16pt of black gutter each side, and 1 − 32/W ≈ 0.92 on this class of
 *  phone. The one knob for "how far away the old screen feels". */
export const RECEDE_SCALE = 0.92;

/** Corner radius the receded card wears. Small on purpose — at 0.92 scale it
 *  reads as the "square edges" Bryan described on the Plex card; the round
 *  device contour takes over as the card returns to full bleed. */
export const RECEDE_RADIUS = 14;

/** The frost over the receded card — max blur intensity at progress 1. The card
 *  used to DIM instead (black at 0.38, the Plex treatment); Bryan's ruling
 *  2026-08-12: no dark — the parked screen wears a blur. If this reads as too
 *  obstructive on device, the agreed retreat is a low-alpha veil (an ink wash
 *  standing in for glass), never a darker tint. */
export const RECEDE_BLUR = 40;

/** ▸ THE FROST'S RESPONSE CURVE — strength at each stage of the pull.
 *
 *  The frost does not ride the sheet linearly (Bryan, 2026-08-12): seated, the
 *  background wears the full defocus; the FIRST stretch of a drag sheds most
 *  of it, so the background refocuses early and the rest of the pull is about
 *  scale, not fog; and the same curve in reverse means a snapped-back sheet
 *  only fully defocuses the background as it reseats — the sheet visibly
 *  reclaims the focus.
 *
 *  The two tables are paired stops: at progress FROST_STOPS[i] the intensity
 *  is RECEDE_BLUR × FROST_RESPONSE[i], interpolated between. Progress 1 is
 *  seated, and with ~800pt of sheet travel each 0.1 of progress ≈ 80pt of
 *  finger. The default table therefore reads:
 *
 *      pulled ~20% (p 0.8) → 40% of the blur left   (the fast early shed)
 *      pulled ~50% (p 0.5) → 10% left               (background essentially clear)
 *      the rest            → melts to 0
 *
 *  TUNING: lower a middle FROST_RESPONSE number to clear faster at that stage,
 *  raise it to hold the fog longer; slide a FROST_STOPS number toward 1 to
 *  make its stage happen earlier in the pull. Both tables must stay ascending
 *  and the same length. RECEDE_BLUR above stays the "seated look" knob. */
export const FROST_STOPS: number[] = [0, 0.5, 0.8, 1];
export const FROST_RESPONSE: number[] = [0, 0.1, 0.15, 1];

/** Air between the receded card's top (it parks at the status bar's foot) and
 *  the sheet's top edge — i.e. how much of the old screen stays in view. */
export const SHEET_TOP_GAP = 12;

/** The sheet's own top corner radius. */
export const SHEET_RADIUS = 18;

// ── THE ESCAPE HOLD (deep-stack clear-all, Bryan 2026-08-12) ────────────────
// No second glyph exists anywhere and nothing new arrives: hold the sheet's
// own close chevron, and that same chevron slides down a track. Reaching the
// foot drops the whole tower.
//
// ▸ WHAT THIS IS NOT, AND WHY. The instrument spent a long arc as a particle
// field: a swarm, then a violet capsule, then Sediment's strata under a glass
// pill. All of it is gone by his ruling — the readable version is the chevron
// you already tapped, moving. Everything below is what is left after that cut:
// a path, a glyph on it, and a commit at the end.

/** Sheets that must be stacked before the hold arms. Below this the chevron
 *  is just a chevron — one tap is already the whole way out. */
export const ESCAPE_MIN_SHEETS = 2;

/** How long a finger rests on the control before it takes the gesture. Long
 *  enough that no ordinary tap ever trips it; the tap stays instant. */
export const ESCAPE_HOLD_MS = 400;

/** The appear / retract clock — the track and its chevron, both directions. */
export const ESCAPE_BREAK_MS = 180;

/** Finger travel (pt) from the seat to a full pull, and so the whole gesture's
 *  gearing. SHORTENED from 220 on his ruling ("decrease the height that the
 *  user has to travel"): the 400ms hold is what guards against an accident, so
 *  the travel does not have to, and at 140 the entire gesture stays inside the
 *  reach of the thumb that is already on the chevron — no regrip, and it never
 *  leaves the top of the screen. This is the one knob if it wants to be
 *  shorter still. */
export const ESCAPE_TRAVEL = 140;

/** ▸ NO RUBBER AT EITHER END (his ruling: "get rid of the stretchiness"). The
 *  pull simply stops at the foot and at the seat. The elastic overpull existed
 *  to give the particle field something to stretch, and the field is gone. */

/** THE TRACK — the chevron's path, drawn behind it: a vertical pill in a very
 *  subtle grey, faintly glassy. Its LENGTH is the whole readout, printed
 *  before the finger moves: this far, and you are out. The width is ALSO the
 *  RING's diameter (his 2026-08-13 ask — the standing invitation around the
 *  chevron whenever the hold is armed): the resting circle IS the track's top
 *  cap, which is what lets the hold read as the ring growing into the field. */
export const ESCAPE_TRACK_W = 36;
/** Half the width — the cap radius, and so the chevron's inset from each end.
 *  This is what makes the geometry exact: the glyph rides from the centre of
 *  the top cap to the centre of the bottom cap. */
export const ESCAPE_TRACK_LEAD = ESCAPE_TRACK_W / 2;
/** A full pull plus a cap at each end. */
export const ESCAPE_TRACK_H = ESCAPE_TRAVEL + ESCAPE_TRACK_W;

/** How much the chevron swells over a full pull (scale 1 → 1+SWELL) — the
 *  glyph gaining weight as it approaches the drop. */
export const ESCAPE_SWELL = 0.3;

/** ▸ THE CRESCENDO (his ruling, 2026-08-12): "an initial thump to indicate
 *  they've activated... as they slide down it gets more intense... another
 *  confirmation thump when they reach the bottom", and then: "it feels like
 *  building up to a ramp with the final end being the climax."
 *
 *  ⚠ IT IS PACED BY TIME, NOT BY TRAVEL, and that is the whole correction.
 *  Two builds fired a thump every time the finger crossed a distance rung,
 *  which means the RHYTHM was never ours — it was whatever the hand did. Pause
 *  mid-pull and the ramp fell silent; jerk and it dumped four thumps at once;
 *  cross the tight rungs near the foot at speed and iOS coalesced them, so the
 *  climax came out THINNER than the middle. No arrangement of rung spacing
 *  fixes that, because the tempo was never being authored.
 *
 *  So the pull now drives a PULSE whose period and weight are both functions
 *  of depth. Shallow: slow and light. Deep: fast and heavy. The rhythm is
 *  identical every time regardless of how the thumb moves, a held position
 *  sits at a steady rate (it reads as charge held), and a fast pull sweeps the
 *  whole ramp quickly instead of skipping it. */

/* ┌──────────────────────────────────────────────────────────────────────────┐
   │ ▸ TUNING THE RAMP — three paired tables, and nothing else to touch.       │
   │                                                                          │
   │ Same grammar as FROST_STOPS / FROST_RESPONSE above, for the same reason:  │
   │ a curve you want to FEEL your way to is easier to author as control       │
   │ points than as a formula.                                                 │
   │                                                                          │
   │   STOPS  — where in the pull each control point sits. 0 = the seat,       │
   │            1 = the foot. Must ascend, and all three tables must be the    │
   │            same length. Add or remove points freely: more points = finer  │
   │            control over the shape.                                        │
   │   PERIOD — the GAP at that point, in ms. This is "fewer gaps": lower the  │
   │            numbers. Between points it interpolates, so the gap closes     │
   │            smoothly rather than stepping.                                 │
   │   WEIGHT — how hard the thump hits there, 0 → 1. Picks from the LADDER    │
   │            below, so its meaning follows whatever you put in that list.   │
   │                                                                          │
   │ TWO PHYSICAL FLOORS worth knowing before tuning:                          │
   │   · Periods under ~45ms stop being distinct — iOS coalesces impacts that  │
   │     close together, so going lower makes a fast pull feel EMPTIER, not    │
   │     denser. 45 is about as tight as the device delivers.                  │
   │   · The ladder is the only intensity iOS exposes; there is no continuous  │
   │     amplitude. WEIGHT is therefore a selector, not a volume knob.         │
   └──────────────────────────────────────────────────────────────────────────┘ */
export const ESCAPE_PULSE_STOPS: number[] = [0.04, 0.22, 0.45, 0.68, 0.85, 0.94];
export const ESCAPE_PULSE_PERIOD: number[] = [100, 95, 48, 38, 18, 5];
export const ESCAPE_PULSE_WEIGHT: number[] = [0.1, 0.28, 0.48, 0.68, 0.86, 1.0];

/** The impacts WEIGHT chooses between, quietest first. Weight 0→1 maps evenly
 *  across this list, so its length is how many distinct steps the ramp has.
 *
 *  Default is three of the SAME KIND of thud, climbing purely in amplitude —
 *  light, medium, heavy. `'rigid'` is available and is the sharpest impact iOS
 *  has, but it is CRISPER rather than stronger: dropping it into the middle of
 *  a ramp changes the character partway up, which reads as inconsistency
 *  rather than as a build. Use it for a whole ramp, not part of one. `'soft'`
 *  exists too and is muted almost to nothing under a moving thumb. */
export const ESCAPE_PULSE_LADDER: string[] = ['light', 'medium', 'heavy'];

/** ▸ THE SPEED PROBLEM, AND THE TWO TRIGGERS THAT SOLVE IT (his report: "if I
 *  go fast, I kind of don't feel any of it").
 *
 *  Pacing a ramp by TIME fixes the slow case and breaks the fast one, exactly
 *  as pacing it by TRAVEL did the reverse. Swipe the whole pull in 200ms and a
 *  time-paced ramp has only had time to emit one or two of its beats — the
 *  build never happens. So a beat now fires on EITHER of two conditions:
 *
 *    · TIME  — period(p) has elapsed. Owns slow pulls and held positions; this
 *              is what makes a paused thumb sit at a steady rate.
 *    · DEPTH — the pull has advanced by one beat's worth of TRAVEL. Owns fast
 *              pulls: however briefly the thumb is at a given depth, that
 *              depth's beat still gets played.
 *
 *  ...under one floor (below), which is what stops the fast case from
 *  degenerating into a call storm the device merges into nothing.
 *
 *  A beat's worth of travel is period(p) / REF_MS — his own period table,
 *  converted from time-spacing into depth-spacing, so tuning the table still
 *  drives BOTH regimes and they cannot disagree about the shape. REF_MS is the
 *  pull duration that makes the two identical: twice the dwell that starts the
 *  gesture, which is about what a considered pull takes. Pull slower than that
 *  and time leads; faster and depth leads. */
export const ESCAPE_PULSE_REF_MS = ESCAPE_HOLD_MS * 2;

/** THE FLOOR — the closest two beats may ever land, whatever the table asks
 *  for. This is hardware, not taste: the taptic engine needs recovery time
 *  between impacts, and calls closer than roughly this merge into one blur or
 *  are dropped outright. Periods in the table BELOW this value therefore buy
 *  nothing — they read as less at the climax, not more, which is the trap to
 *  know about when the end is meant to be the loudest part. Lower it if you
 *  want to chase a rumble; raise it if the tail feels mushy. */
export const ESCAPE_PULSE_MIN_GAP = 30;

/** How often the player wakes to check its two triggers. Must be well under
 *  the shortest gap you intend to feel, or a fast pull's beats land late. */
export const ESCAPE_PULSE_TICK = 16;

/** THE HUSH. Past the last stop the ramp cuts out for the rest of the travel,
 *  so a beat of silence lands before the confirmation. The gap is what makes
 *  the finale read as an arrival rather than one more thump in the sequence —
 *  a climax needs the intake of breath before it. Set it to 1 to run the ramp
 *  right into the foot instead. */
export const ESCAPE_PULSE_HUSH = ESCAPE_PULSE_STOPS[ESCAPE_PULSE_STOPS.length - 1];

/** The ramp read at a point in the pull, or null where it is silent — below
 *  the first stop (you have barely moved and the latch thump has only just
 *  landed) and through the hush. Plain interpolation between control points;
 *  lives beside the tables so the whole tuning surface is one place. */
export function escapePulseAt(p: number): { period: number; weight: number } | null {
  const stops = ESCAPE_PULSE_STOPS;
  if (p < stops[0] || p >= ESCAPE_PULSE_HUSH) return null;
  let i = stops.length - 1;
  while (i > 0 && p < stops[i]) i--;
  const j = Math.min(stops.length - 1, i + 1);
  const span = stops[j] - stops[i];
  const u = span > 0 ? (p - stops[i]) / span : 0;
  return {
    period: ESCAPE_PULSE_PERIOD[i] + (ESCAPE_PULSE_PERIOD[j] - ESCAPE_PULSE_PERIOD[i]) * u,
    weight: ESCAPE_PULSE_WEIGHT[i] + (ESCAPE_PULSE_WEIGHT[j] - ESCAPE_PULSE_WEIGHT[i]) * u,
  };
}

/** ▸ THE STRETCH, back but barely (his ruling: "a bit of stretch back to the
 *  slider field, but make it super subtle"). Finger past either end maps at a
 *  QUARTER into instrument travel, capped here — and the cap is what keeps it
 *  honest: 8pt against the track's own 18pt cap radius is under half a cap, so
 *  it reads as the track giving a little rather than as more travel. The
 *  escape clock stays clamped through it, so the commit line cannot be reached
 *  by stretching. */
export const ESCAPE_OVERPULL = 8;

/** ▸ THE CASCADE — what a committed pull actually does (Bryan, 2026-08-12:
 *  "the movements happen in reverse order... it'll go repeating that order
 *  until they get back to wherever they were at originally", and on seeing it,
 *  "that's actually so good").
 *
 *  The tower does NOT ride the pull. The pull is a gauge; the commit is a
 *  performance. On release at the foot, the stack unwinds top-down, one layer
 *  at a time, each leaving in its OWN language: a sheet slides its card down
 *  on this clock — and the layer beneath un-recedes for free, because the
 *  falling card's slide IS that layer's cover clock — while a person page
 *  folds home into the card it grew out of, on the fold's own existing timing.
 *  Each layer waits for the one above it to finish, which is what makes it
 *  read as a rewind of the journey rather than a dissolve. */

/** One step of the cascade: how long a sheet takes to slide off the layer
 *  beneath it. Quicker than a lone dismissal (there may be several in a row)
 *  but the same accelerate-away shape. */
export const ESCAPE_STEP_MS = 230;

/** THE ULTRAVIOLET (P1, chosen over ember/phosphor/iridescent) — the colour
 *  the chevron floods with once the pull is armed, and the only colour in the
 *  whole gesture. */
export const ESCAPE_UV_UNIFY = '#A78BFA';

/** THE DISSOLVE — the commit's confirmation (his ask, 2026-08-13): released at
 *  the foot, the pill ERODES bottom-to-top, shedding little ultraviolet bits
 *  as it goes — the instrument's own material carrying the commit colour out,
 *  instead of the old fade-in-place.
 *
 *  ▸ THE STILL BEAT (round 2 — "I honestly don't see any disintegration"): v1
 *    ran the dissolve and the cascade on the same frame, and a 140ms erosion
 *    in a corner cannot compete with a full-screen card slide — especially
 *    when its opening act happens at the foot, under the very thumb that is
 *    still lifting off it. So the cascade now waits ONE BREAK before its first
 *    step: guards are up instantly (escaping flips on the release frame), but
 *    the screen holds still while the pill visibly eats itself, and the tower
 *    starts falling as the last bits fly. A confirmation you can see, then the
 *    consequence. Zero this to restore the old simultaneous exit. */
export const ESCAPE_CASCADE_LEAD_MS = ESCAPE_BREAK_MS;
/** ▸ HARD BUDGET: the flourish must finish inside the route's OWN exit. The
 *  committing route is always the cascade's first step — its card slides for
 *  ESCAPE_STEP_MS, one lead after the release, and the route (instrument
 *  included) unmounts right after — so the dissolve's total IS that sum; any
 *  longer and the last bits would be cut off mid-air by the unmount. */
export const ESCAPE_DISSOLVE_MS = ESCAPE_CASCADE_LEAD_MS + ESCAPE_STEP_MS;
/** One freed bit's flight (pop at the eroding edge, drift, fade) — one break,
 *  the instrument's own tempo. The erosion runs the remainder of the budget
 *  (exactly one step), so edge and bits share one linear clock and the last
 *  bit dies just before the unmount. */
export const ESCAPE_DISSOLVE_BIT_MS = ESCAPE_BREAK_MS;

/** Release at or past this much of the pull commits the drop; anything less
 *  rides home. Hysteresis against the arm (armed at ~1.0, disarmed below
 *  this), so the boundary can't flutter under a resting finger. */
export const ESCAPE_COMMIT_P = 0.95;

/** The chevron's ride home on cancel — the rating knob's own seat, so the
 *  app's instruments settle with one temperament. */
export const ESCAPE_SEAT_SPRING = { damping: 26, stiffness: 320, mass: 1 };

type MovieSheetContextValue = {
  /** 0 = no movie sheet · 1 = a sheet fully seated. Read by the recede stage in
   *  (tabs); it is the BOTTOM of the cover-clock stack — see below. */
  progress: SharedValue<number>;
  /** The cover clock of the CURRENT topmost layer — the value the next sheet to
   *  mount must adopt as its slide. Read once at a sheet's first render. */
  peekCoverClock: () => SharedValue<number>;
  /** Mount-effect bookkeeping: push this sheet's OWN cover clock (the value a
   *  sheet stacked above it would drive) and its STEP-OUT — the routine that
   *  plays this one layer's exit when the cascade reaches it. Get back the pop.
   *  Sheets unmount LIFO (they are a navigation stack), so a plain stack is the
   *  whole registry. */
  registerSheet: (
    cover: SharedValue<number>,
    stepOut: () => Promise<void>,
    /** Was this sheet pushed BY an entity page? Only meaningful on the FIRST
     *  sheet, and there it is decisive: a sheet-hosted page can only ever push
     *  a sheet ONTO the tower, so a base sheet carrying a lineage stamp can
     *  only have been pushed by the ground's own page. That is what tells the
     *  cascade whether the ground has a layer in THIS chain — as opposed to a
     *  page parked in the search tab from some earlier session, which survives
     *  a tab switch by design and must not be swept up by a chain that began
     *  somewhere else entirely. */
    fromEntityPage: boolean
  ) => () => void;
  /**
   * THE GROUND'S OWN EXIT, run LAST — after every sheet has gone.
   *
   * A sheet route folds the person page it hosts as part of its own step, so
   * the unwind reaches the tab it started from. But a chain can also BEGIN on a
   * page: from search or recents you open a person, and only then start opening
   * films. That first page is hosted by the search screen, not by any sheet, so
   * the cascade used to pop the whole tower and leave it standing — Discover
   * chains landed on the tab, search chains landed on a page, and the same
   * gesture meant two different things (Bryan, 2026-08-13: "there is a
   * disparity on where we cascade to").
   *
   * The ground answers for its own layer, exactly as a route does for its. If
   * nothing is registered — the Discover case, where the chain starts at a
   * sheet — the cascade simply ends at the tab, unchanged.
   */
  registerGroundExit: (stepOut: () => Promise<void>) => () => void;
  /** How many movie sheets are mounted right now (the tabs layer excluded).
   *  Written by registerSheet on the JS thread; read by the escape hold —
   *  its worklet guards read it directly, its gesture-enabled flag mirrors
   *  it into React state. A SharedValue so neither reader re-renders. */
  sheetCount: SharedValue<number>;
  /** THE PULL: 0 = no escape · 1 = a full pull. Written only by the held
   *  sheet's control, read only by the instrument — the field, the lens, the
   *  tint and the snap. The tower does not ride this; a committed pull is a
   *  cascade, not a scrub. */
  escape: SharedValue<number>;
  /** 1 while a committed cascade is unwinding the stack. Every navigation verb
   *  (dismiss, pop, pan, a fresh hold) stands down while it runs — two drivers
   *  popping routes at once is the one way this can go wrong. */
  escaping: SharedValue<number>;
  /** THE DROP: replay the journey in reverse, top-down. Each layer leaves in
   *  its own language and waits for the one above it to finish — see the
   *  cascade note above. */
  escapeCascade: () => void;
};

const MovieSheetContext = createContext<MovieSheetContextValue | null>(null);

/**
 * ▸ THE COVER-CLOCK STACK (enhance/cast). Every layer that can be covered by a
 * sheet exposes one shared value — its COVER CLOCK — and a mounting sheet's
 * slide IS the cover clock of the layer beneath it:
 *
 *   · the tabs' cover clock is `progress` (the recede stage reads it), so the
 *     BASE sheet's slide recedes+frosts the tab tree — the original behavior,
 *     byte-identical, finger-tracked;
 *   · each sheet ROUTE registers its own cover clock, so a sheet stacked above
 *     it (a cast member's filmography pushing a film) drives THAT — and the
 *     lower route recedes+frosts its own content (its card, its person page)
 *     with the same grammar, at any depth (Bryan, 2026-08-12: the recede and
 *     the defocus "we lose that, and we should probably bring that back").
 *
 * One mechanism, no base/upper special-casing: slide-in, drag, and dismissal
 * all animate "whatever is beneath me" because the slide IS that layer's clock.
 * The cascade gets its reverse-order unwind free from the same fact.
 */
export function MovieSheetProvider({ children }: { children: React.ReactNode }) {
  const progress = useSharedValue(0);
  const sheetCount = useSharedValue(0);
  const escape = useSharedValue(0);
  const escaping = useSharedValue(0);
  const stackRef = useRef<SharedValue<number>[] | null>(null);
  const stepsRef = useRef<(() => Promise<void>)[]>([]);
  // The ground's own exit, if the screen beneath the tower is showing something
  // the unwind should also put away — see registerGroundExit.
  const groundRef = useRef<(() => Promise<void>) | null>(null);
  // Did THIS chain begin on the ground's page? Decided when the base sheet
  // registers, and only then — see registerSheet's `fromEntityPage`.
  const groundInChainRef = useRef(false);
  if (stackRef.current === null) stackRef.current = [progress];

  const value = useMemo(
    () => ({
      progress,
      sheetCount,
      escape,
      escaping,
      peekCoverClock: () => {
        const stack = stackRef.current!;
        return stack[stack.length - 1];
      },
      registerSheet: (
        cover: SharedValue<number>,
        stepOut: () => Promise<void>,
        fromEntityPage: boolean
      ) => {
        stackRef.current!.push(cover);
        stepsRef.current.push(stepOut);
        // The tabs' clock is element 0, so sheets = length − 1.
        sheetCount.value = stackRef.current!.length - 1;
        if (sheetCount.value === 1) groundInChainRef.current = fromEntityPage;
        return () => {
          const stack = stackRef.current!;
          const i = stack.lastIndexOf(cover);
          if (i >= 0) stack.splice(i, 1);
          const j = stepsRef.current.lastIndexOf(stepOut);
          if (j >= 0) stepsRef.current.splice(j, 1);
          sheetCount.value = stack.length - 1;
          // The last sheet leaving is the one deterministic "escape is over"
          // moment — a committed cascade holds the clock at 1 through its run
          // so the field stays unified, and this is where it comes home.
          if (stack.length - 1 === 0) {
            escape.value = 0;
            escaping.value = 0;
            groundInChainRef.current = false;
          }
        };
      },
      registerGroundExit: (stepOut: () => Promise<void>) => {
        groundRef.current = stepOut;
        return () => {
          if (groundRef.current === stepOut) groundRef.current = null;
        };
      },
      escapeCascade: () => {
        if (escaping.value === 1) return;
        escaping.value = 1;
        // Snapshot top-down BEFORE anything pops — each step removes itself
        // from the live registry as its route unmounts.
        const steps = [...stepsRef.current].reverse();
        const ground = groundInChainRef.current ? groundRef.current : null;
        (async () => {
          // THE STILL BEAT — see ESCAPE_CASCADE_LEAD_MS. The guards are
          // already up (escaping flipped above, on the release frame), so
          // nothing can navigate into the pause; the screen simply holds
          // while the instrument's dissolve plays, and the tower starts
          // falling as the last bits fly.
          await new Promise((r) => setTimeout(r, ESCAPE_CASCADE_LEAD_MS));
          for (const step of steps) await step();
          // ...and then the ground puts its own layer away, so the unwind ends
          // on the tab you came in from however the chain began.
          if (ground) await ground();
        })().finally(() => {
          escaping.value = 0;
          escape.value = 0;
        });
      },
    }),
    [progress, sheetCount, escape, escaping]
  );
  return <MovieSheetContext.Provider value={value}>{children}</MovieSheetContext.Provider>;
}

export function useMovieSheet(): MovieSheetContextValue {
  const value = useContext(MovieSheetContext);
  if (!value) {
    throw new Error("useMovieSheet must be used inside MovieSheetProvider");
  }
  return value;
}

/**
 * ▸ SHEET LINEAGE — who a sheet is sitting on, for the LOOP GUARD (Bryan,
 * 2026-08-12): on Tom Holland's page you open The Odyssey; in its cast you tap
 * Tom Holland again. A fresh page of the person you are literally standing on
 * is a loop — so instead, the sheet folds back down to the page beneath,
 * "wherever I left off."
 *
 * Entity pages stamp their identity onto every sheet they push (openFilm's
 * fromKind/fromId params); the sheet route provides that identity here plus its
 * own dismissal, and the cast tab consults it before opening anything. Null
 * outside a sheet, and null on sheets not pushed from an entity page — the
 * guard simply never fires there.
 */
export type SheetBeneath = { kind: EntityPage["kind"]; id: number } | null;

const SheetLineageContext = createContext<{
  beneath: SheetBeneath;
  dismissSheet: () => void;
} | null>(null);

export function SheetLineageProvider({
  value,
  children,
}: {
  value: { beneath: SheetBeneath; dismissSheet: () => void };
  children: React.ReactNode;
}) {
  return <SheetLineageContext.Provider value={value}>{children}</SheetLineageContext.Provider>;
}

/** Null when not inside a movie sheet — callers must handle both worlds. */
export function useSheetLineage() {
  return useContext(SheetLineageContext);
}
