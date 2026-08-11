import React, { createContext, useContext, useMemo } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

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

type MovieSheetContextValue = {
  /** 0 = no movie sheet · 1 = sheet fully seated. Written only by the movie
   *  route; read by the recede stage in (tabs). */
  progress: SharedValue<number>;
};

const MovieSheetContext = createContext<MovieSheetContextValue | null>(null);

export function MovieSheetProvider({ children }: { children: React.ReactNode }) {
  const progress = useSharedValue(0);
  const value = useMemo(() => ({ progress }), [progress]);
  return <MovieSheetContext.Provider value={value}>{children}</MovieSheetContext.Provider>;
}

export function useMovieSheet(): MovieSheetContextValue {
  const value = useContext(MovieSheetContext);
  if (!value) {
    throw new Error("useMovieSheet must be used inside MovieSheetProvider");
  }
  return value;
}
