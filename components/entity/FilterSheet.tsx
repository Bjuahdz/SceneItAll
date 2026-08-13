import { BlurView } from "expo-blur";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import {
  NAV_BLUR_INTENSITY,
  NAV_FILTER_RECT,
  NAV_GLASS_RIM,
  NAV_GLASS_TINT,
} from "@/constants/navMetrics";
import {
  CommitBar,
  CatalogueBand,
  ChipRow,
  CycleButton,
  DecadeScroller,
  GenreMap,
  RatingField,
  SectionLabel,
  SortBar,
} from "@/components/entity/FilterControls";
import { useEntityOverlay } from "@/contexts/EntityOverlayContext";
import { countMatching, decadesIn, type EntityFilm } from "@/services/entities";
import {
  FILTER_DEFAULTS,
  KIND_CYCLE,
  KNOWN_FOR_CYCLE,
  SORT_CYCLE,
  STATUS_CYCLE,
  isDefault,
  sameFilter,
  sortStopsFor,
  useFilterState,
  type FilterState,
  type KindKey,
  type SizeBandKey,
  type SortKey,
} from "@/hooks/useFilterState";
import {
  ENTITY_BANDS,
  IMPLEMENTED_BANDS,
  bandLabel,
  bandNumber,
  numberedBands,
  sizeBandsFor,
  statusLabelsFor,
  type FilterBand,
} from "@/constants/filterBands";

/** The board's wording, kept out of the state so the keys stay data. */
const SORT_LABELS: Record<SortKey, string> = {
  // Bryan's word, 2026-08-05 — it names the ordering itself rather than
  // describing one row's relationship to the query.
  relevance: "RELEVANCE",
  alpha: "A–Z",
  release: "RELEASE DATE",
  rating: "AVG RATING",
  size: "SIZE",
};
/**
 * The direction's words BELONG TO THE FIELD — one boolean, two vocabularies.
 * "NEWEST" and "HIGHEST" are the same answer to the same question, and saying
 * DESCENDING in both places would be technically true and useless.
 */
const DIRECTION_LABELS: Record<SortKey, { desc: string; asc: string }> = {
  // The search surface only. CLOSEST/FURTHEST rather than BEST/WORST because the
  // ranking measures distance from what you typed, and "worst match" reads as a
  // judgement of the film rather than of the match.
  relevance: { desc: "CLOSEST", asc: "FURTHEST" },
  // ASC / DESC, not A→Z / Z→A (Bryan, 2026-08-09: the arrow pair "I don't really
  // like" — plain ascending/descending acronyms read better beside the A–Z value).
  // ⚠ THE SLOTS ARE INVERTED FOR ALPHA, ON PURPOSE. The state's `desc` slot is a
  // sort's DEFAULT direction, and alpha's default order is A→Z — which is
  // alphabetically ASCENDING. The labels follow the alphabet, not the slot name;
  // swapping these "to match the keys" would caption the default A→Z list DESC.
  alpha: { desc: "ASC", asc: "DESC" },
  release: { desc: "NEWEST", asc: "OLDEST" },
  rating: { desc: "HIGHEST", asc: "LOWEST" },
  // Studios and collections only — the count is films held, so BIGGEST reads more
  // plainly than MOST and does not collide with the rating's HIGHEST.
  size: { desc: "BIGGEST", asc: "SMALLEST" },
};
// On an ENTITY PAGE, SHOWS is drawn but inert until combined_credits ships — a
// person's TV work is a separate request and its own project; FILM works today.
// On RESULTS all six are live, and the last three are what turn this control from
// a format question into a "what kind of thing" one.
const KIND_LABELS: Record<KindKey, string> = {
  any: "ANY",
  film: "FILM",
  shows: "SHOWS",
  person: "PEOPLE",
  studio: "STUDIOS",
  collection: "COLLECTIONS",
};

/**
 * THE FILTER SHEET — F2.
 *
 * ▸ IT IS THE PILL, AND IT GROWS FROM ITS OWN CENTRE. Traced frame by frame off
 *   the reference Bryan filmed (a pill → full page, 2.12 → 2.39 ≈ 270ms):
 *     · the pill LIFTS off the bar before it is meaningfully bigger;
 *     · it rounds into a BUBBLE and swells in BOTH directions at once — up and
 *       down — riding its own centre toward the middle of the screen;
 *     · the corners stay heavily rounded almost the whole way, squaring off
 *       only as it meets the screen's edges;
 *     · it lands EMPTY, wearing nothing but its title;
 *     · the content arrives afterwards — see THE PANEL FILLING IN below.
 *   Two earlier attempts failed on geometry, not timing. A per-axis SCALE of a
 *   screen-sized window loses the pill's shape within two frames and turns its
 *   capsule corners into flat ellipses (no non-uniform scale can preserve a
 *   radius). Pinning the box's BOTTOM edge — the obvious reading of "it comes
 *   out of the bar" — is what made it read as a bottom sheet: if only the top
 *   edge travels, the eye sees a panel sliding up, not an object expanding.
 *   The bubble has to open downward as well, even though it only has 25pt of
 *   room to do it in.
 *
 * ▸ THE WORD IS THE SHARED ELEMENT. "FILTER" never leaves the screen: it rides
 *   from the capsule's centre to the header's title slot in one move, which is
 *   what makes this read as one object becoming another rather than a panel
 *   replacing a button. The pill's sliders glyph hands over to the chevron
 *   across the same beat. Everything the sheet wears is positioned relative to
 *   the WINDOW, not the screen, so it travels with the bubble and is already
 *   home when the bubble is.
 *
 * ▸ LAYOUT IS NOT ON THE ANIMATION PATH — except the window's own frame. The
 *   body is one fixed screen-sized box; nothing inside it is ever re-solved or
 *   squashed, whatever the bubble is doing.
 *
 * ▸ NO NATIVE LAYERS IN FLIGHT. The BlurView mounts on landing, never during
 *   the morph — the same settled-strip law EntityScreen folds by, and the same
 *   reason the pill itself lost its blur (see `filterBlur` in the nav).
 */

/* ────────────────────────────────────────────────────────────────────────────
   ▸ TUNE ME — the sheet's material. Bryan's three numbers; nothing else in the
   file needs touching to change how the glass reads.

   SHEET_BLUR      How frosted the sheet is. 0 = clear glass, 100 = milk.
                   ⚠ Deliberately its OWN number rather than the nav's
                   NAV_BLUR_INTENSITY, which is 45 and is now approved on all
                   three islands — tuning the sheet must not drag the bar with
                   it. Start here, not below.
   SHEET_TINT      The dark wash laid OVER that blur. Raise the last number for
                   a heavier, more opaque sheet; lower it to let more of the
                   page read through. Keep the RGB — it is the board's ground
                   (#0A0908) and the hue is what makes it the same material as
                   everything else in Signal.
   SCRIM_MAX       How far the page BEHIND the sheet is washed back while the
                   bubble opens, 0–1. This is the depth cue; too low and the
                   sheet floats on nothing, too high and the page is gone
                   before the bubble arrives.
   ──────────────────────────────────────────────────────────────────────────── */
const SHEET_BLUR = 65;
const SHEET_TINT = "rgba(10, 9, 8, 0.66)";
const SCRIM_MAX = 0.55;

const SCREEN_W = Dimensions.get("window").width;
const SCREEN_H = Dimensions.get("window").height;

/** How round the bubble stays for most of its flight — traced off the
 *  reference, where a half-screen-tall shape still wears heavy corners. */
const BUBBLE_R = 52;
const GROW_MS = 340;
const CLOSE_MS = 260;
const SNAP_MS = 180;
const DRAG_CLOSE_FRACTION = 0.3;
const DRAG_CLOSE_VELOCITY = 900;

/* ────────────────────────────────────────────────────────────────────────────
   ▸ THE PANEL FILLING IN.

   The bubble still lands EMPTY — that is the reference's own behaviour and it
   is not up for renegotiation. What lands *after* it used to arrive in a single
   frame, all six sections at once, which reads as a screenshot being pasted in
   rather than an instrument coming up.

   So the rows now PRINT, top to bottom, in the order their own numbers already
   promise (01 … 06). Each row prints in two beats:

     · THE LINE — the numbered mono label slides in from the left margin while
       the row inks up and rises the last few points into its slot. A plotter
       laying down a line of type.
     · THE INSTRUMENT — the control it names follows a beat behind, fading and
       settling under its label.

   The rows' slices OVERLAP heavily: a row starts long before the row above it
   has finished, so the eye reads one swell moving down the page rather than six
   separate events. That overlap is the whole difference between "authored" and
   "staggered by a for-loop".

   ONE driver, six windows. No timers, no staggered state, nothing on the JS
   thread once it starts — and transforms and opacity ONLY, so no row is ever
   re-laid-out while it arrives.

   REVEAL_MS   The whole cascade, first row's first frame to last row's last.
               The first row is home at roughly a third of it, so this is not a
               wait — it is how long the page takes to finish filling behind
               content you can already read. Raise for a slower fill.
   REVEAL_SPAN How much of that run any ONE row owns, 0–1. Bigger = each row is
               slower and the rows overlap more (softer, more liquid); smaller =
               each row snaps and the cascade reads as distinct steps.
   ──────────────────────────────────────────────────────────────────────────── */
/**
 * ▸ WHEN THE FILL STARTS. Measured from the tap, NOT from the landing.
 *
 * Bryan: "if we can make it load in the moment that the filter page expands to
 * contain the entire device's screen, that would be nice — that way the user
 * isn't waiting." So the cascade no longer waits for the bubble; it overlaps
 * the tail of it, and the top rows are home at almost the same moment the
 * bubble becomes the screen.
 *
 * It cannot start any EARLIER than this. The window is still narrower than the
 * screen until p ≈ 0.8 (see the width ramp), and the body inside it is always
 * full-screen width — so a row printed before then would be printing into a
 * box too narrow to hold it, and you would watch a full-width control get
 * sliced by the bubble's edges. 0.8 of GROW_MS is the first frame at which the
 * page is as wide as its contents. Rows are still clipped VERTICALLY at that
 * point, which is fine and in fact correct: they emerge with the shape.
 */
const CASCADE_LEAD_MS = Math.round(GROW_MS * 0.8);
/**
 * How far into the grow the sheet stops wearing the PILL'S material and starts
 * wearing its own. See `tintStyle` — this is the other half of the handover.
 */
const PILL_MATCH = 0.2;
/**
 * How long the window stays PILL-SIZED. The centre travels from the first
 * frame but the box does not grow until here, which is the "lift" in the
 * reference. The pill's own blur lives exactly this long and no longer: past
 * this point the box is no longer a pill, so there is nothing left to match.
 */
const PILL_SIZE_HOLD = 0.12;

/* ────────────────────────────────────────────────────────────────────────────
   ▸ THE RIM — A PILL DETAIL, NOT A PAGE ONE.

   It exists for the two frames either side of the swap and for nothing else.
   The nav pill wears a 1pt hairline, so a capsule claiming to BE that pill has
   to wear one too, or the exchange shows. It leaves on the same ramp as the
   tint, and the landed page has no rim at all — Bryan's call after seeing one:
   "I still don't really like the look of it. I think it's just not needed."

   It began life as an accident. The window carried `borderWidth: 1` so the
   sheet could wear the pill's rim, but the tint behind it fills the CONTENT
   box — inside the border — so that 1pt ring was a see-through slot onto the
   page: a hairline against the bright top of a portrait, nothing against the
   dark bottom. It is a real, painted line now (an overlay drawn LAST, over the
   tint and the body), which is what made it fair to judge — and the judgement
   was that the page is better without it.

   Because it is gone well before the sheet lands, none of the display-corner
   guesswork a full-page rim would have needed applies. A hairline that only
   ever exists at capsule size is always simply a capsule.
   ──────────────────────────────────────────────────────────────────────────── */

const REVEAL_MS = 440;
const REVEAL_SPAN = 0.38;
/**
 * ⚠ THE CASCADE'S STEP IS NOW DERIVED FROM THE ROW COUNT, because the row count
 * varies per kind — PEOPLE has three bands where COLLECTIONS has five, and the last
 * row must finish exactly at 1 on both or the sheet stops arriving cleanly.
 *
 * This used to be a hand-maintained `ROW_COUNT = 6` with a comment begging whoever
 * edited the JSX to keep it in step. It is counted now.
 */
const revealStep = (rowCount: number): number => (1 - REVEAL_SPAN) / Math.max(1, rowCount - 1);
/** Where inside a row's own slice the label is home, and the control sets off. */
const LABEL_DONE = 0.7;
const BODY_START = 0.3;
/** Travel, in points. A settle, not an entrance — but the first pass at 12/6/10
 *  was invisible even once the timing bug below was out of the way, so these are
 *  roughly doubled. Past ~28 the rows start sliding rather than settling. */
const ROW_RISE = 20;
const BODY_SETTLE = 10;
const LABEL_DRIFT = 16;

/**
 * One numbered row of the instrument, arriving under its own slice of the
 * cascade. `label` is passed separately from `children` because the two beats
 * are the point: the line prints, then the control settles beneath it.
 */
function RevealRow({
  index,
  rowCount,
  driver,
  label,
  style,
  children,
}: {
  index: number;
  /** How many rows this sheet has, INCLUDING the commit bar — the step is derived
   *  from it so a three-band sheet and a five-band one both finish at 1. */
  rowCount: number;
  driver: SharedValue<number>;
  /** Omitted by rows that have nothing to print above themselves — see the
   *  commit bar. Those arrive on the body beat alone. */
  label?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const start = index * revealStep(rowCount);

  // Cubic-out, written out longhand in each worklet: a shared `ease()` helper
  // would be an ordinary JS function called from the UI thread, which is the
  // exact crash scripts/check-worklets.mjs exists to catch.
  const rowStyle = useAnimatedStyle(() => {
    const s = interpolate(driver.value, [start, start + REVEAL_SPAN], [0, 1], "clamp");
    const a = interpolate(s, [0, LABEL_DONE], [0, 1], "clamp");
    const e = 1 - (1 - a) * (1 - a) * (1 - a);
    return { opacity: e, transform: [{ translateY: (1 - e) * ROW_RISE }] };
  });
  const labelStyle = useAnimatedStyle(() => {
    const s = interpolate(driver.value, [start, start + REVEAL_SPAN], [0, 1], "clamp");
    const a = interpolate(s, [0, LABEL_DONE], [0, 1], "clamp");
    const e = 1 - (1 - a) * (1 - a) * (1 - a);
    return { transform: [{ translateX: (1 - e) * -LABEL_DRIFT }] };
  });
  const bodyStyle = useAnimatedStyle(() => {
    const s = interpolate(driver.value, [start, start + REVEAL_SPAN], [0, 1], "clamp");
    const b = interpolate(s, [BODY_START, 1], [0, 1], "clamp");
    const e = 1 - (1 - b) * (1 - b) * (1 - b);
    return { opacity: e, transform: [{ translateY: (1 - e) * BODY_SETTLE }] };
  });

  return (
    <Animated.View style={[style, rowStyle]}>
      {label != null && <Animated.View style={labelStyle}>{label}</Animated.View>}
      <Animated.View style={bodyStyle}>{children}</Animated.View>
    </Animated.View>
  );
}

// Straight off the board (PERSON · FILTER V3 · instrument).
const PAD_H = 20;
/**
 * ▸ THE GAP BELOW THE SYSTEM UI, not a second margin stacked on top of it.
 *
 * The board's 30 was measured from the top of a 390×844 artboard that draws no
 * status bar — so it already INCLUDED the room the island takes. Adding it to
 * `insets.top` charged for that room twice: 59 + 30 on a Dynamic Island phone,
 * which is why the title sat so far under the camera. Bryan: "the title with
 * the chevron and the number is pretty low compared to where my camera is."
 *
 * 16 is a real gap below whatever the system reserves, so it is right on an
 * island (59), a notch (47) and a plain status bar (20) without any of them
 * being special-cased.
 */
const PAD_TOP = 16;
const HEADER_SLOT_W = 64;
const HEADER_H = 36;
const INK = "#F2EDE4";
const MUTED = "#8A8279";
const ACCENT = "#9CCADF";
/** The board's `#9CCADF80` — the same rim the sheet's touched controls wear. */
const ACCENT_LINE = "rgba(156, 202, 223, 0.5)";
/** The pill's own ink row, so the handover starts from what was on screen. */
const PILL_INK_GAP = 9;
/** The commit bar clears the home indicator by the gutter's own half. */
const COMMIT_BOTTOM = 12;
const COMMIT_H = 46;

/* ────────────────────────────────────────────────────────────────────────────
   ▸ FIT — the sheet answers to the screen it is actually on.

   The body is one fixed box, which is what keeps it off the morph's animation
   path, and the commit bar is pinned to the bottom of it. That was fine on a
   full-size phone and a real bug below roughly 810pt of screen: the bar simply
   sat on top of the genre grid. Bryan: "it should adjust to whatever the
   user's device screen real estate allows us to have access to."

   Everything above the grid is either a control's own height or a gap, and the
   two are not equally negotiable, so the space is spent in that order:

     ① FIXED — the header, every label, every control box. Never touched. A
       46pt box is 46pt tall on an SE and on a Pro Max; shrinking controls to
       fit is how instruments become toys.
     ② THE GENRE WINDOW — one row or two. Two is Bryan's ruling and what every
       full-size phone gets; a short screen drops to one rather than sliding
       the commit bar over the grid. This is chosen FIRST, against the padding
       floor, so a screen never loses a row it could have afforded.
     ③ THE RHYTHM — all five section gaps scale together by one factor, so the
       deliberately-uneven proportions (36 after SORT, 26 between filters, 30
       under the header) survive at every size instead of collapsing into a
       uniform list. Floored at 70%: below that the sheet stops reading as one
       surface with sections and starts reading as a stack.

   `insets` carries the device's own hardware — a Dynamic Island, a notch, a
   home indicator or none of them — so nothing here is per-phone. It is one
   subtraction, and every model falls out of it.
   ──────────────────────────────────────────────────────────────────────────── */
/** What the sections' controls and labels cost, before any gap. */
const FIT_FIXED = HEADER_H + 12 * 5 + 12 * 5 + 46 * 3 + 47;
/** The five section paddings at full rhythm: 30 + 36 + 26 + 26 + 26. */
const FIT_PAD_FULL = 144;
const FIT_PAD_FLOOR = 0.7;
/** Breathing room between the last control and the bar. Not decoration — a bar
 *  touching the grid reads as part of it. */
const FIT_MIN_GAP = 20;
/** The genre window's own arithmetic, mirrored from FilterControls. */
const FIT_CELL_H = 76;
const FIT_ROW_GAP = 6;

/** "08 OF 48" — the board pads both sides, so 8 never reads as a different
 *  shape of number from 48. Three digits are left alone rather than truncated. */
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * ▸ ONE SHEET, TWO SURFACES (Bryan, V3 ruling B+C: "the entity FilterSheet
 * REUSED verbatim — same layout, entrance, dismissal, look").
 *
 * Everything that makes this thing what it is — the bubble growing out of the
 * nav pill, the staggered reveal, the drag-close, the commit bar — is surface
 * independent, so none of it is parameterised. Only the four things that are
 * genuinely a property of WHAT IS BEING FILTERED are:
 *
 *   · `rows`      what to filter and count (and what the decade and genre lists
 *                 are derived from — both are adaptive, never a fixed range);
 *   · `applied`   / `onApply` — the committed filter, which is per surface by
 *                 ruling ⑦, or a filmography you filtered would arrive on an
 *                 unrelated result set claiming a filter you cannot see;
 *   · `defaults`  / `sortCycle` — the search surface starts on RELEVANCE and can
 *                 cycle to it; an entity page has no ranking, so it cannot;
 *   · `showTotal` ruling B-i, below.
 *
 * Omit them all and it behaves exactly as it did before this increment: the
 * entity overlay's own filmography, read from its context.
 */
export default function FilterSheet({
  open,
  onClose,
  rows,
  applied,
  onApply,
  defaults = FILTER_DEFAULTS,
  sortCycle = SORT_CYCLE,
  kindCycle = KIND_CYCLE,
  kindLabel = "FORMAT",
  bands: bandsProp,
  subtitle,
  genreOptions,
  decadeOptions,
  countryOptions,
  countFor,
  showTotal = true,
}: {
  open: boolean;
  onClose: () => void;
  /** What to filter. Omitted = the open entity page's filmography. */
  rows?: EntityFilm[];
  applied?: FilterState;
  onApply?: (next: FilterState) => void;
  defaults?: FilterState;
  sortCycle?: readonly SortKey[];
  kindCycle?: readonly KindKey[];
  /** The section's word. An entity page filters a FORMAT (film vs television);
   *  a result set filters a KIND, because three of its stops are not formats at
   *  all. */
  kindLabel?: string;
  /** Which bands this surface shows, in order. Defaults to the composition for the
   *  CURRENT KIND, which is what the results sheet wants; an entity page passes
   *  ENTITY_BANDS because it is not one of the six kinds. */
  bands?: readonly FilterBand[];
  /** The word under FILTER — which pile this sheet narrows ("PEOPLE"). Results
   *  only; an entity page's subject is the page behind the sheet. */
  subtitle?: string;
  /** Override the option lists, which otherwise come from `rows`. The results
   *  surface passes the genres and decades of the CURRENT KIND's rows — see the
   *  note where these are read. Omitted on entity pages: there, `rows` IS the
   *  subject and deriving from it is exactly right. */
  genreOptions?: number[];
  decadeOptions?: number[];
  /** The countries the studios in this result set are based in. Absent on every
   *  other surface, which has no CATALOGUE band to feed. */
  countryOptions?: string[];
  /**
   * How many rows the DRAFT would leave, when counting them is more than
   * counting films.
   *
   * The entity sheet's subject is a flat list of films, so `countMatching` over
   * `rows` is the whole truth. A result set is mixed and its pipeline has a type
   * gate in front of the film predicate, so only the screen can answer — and it
   * must be the SAME function that builds the list, or the header would promise
   * a number the rows disagree with (the exact failure entities.ts warns about).
   */
  countFor?: (draft: FilterState) => number;
  /**
   * ▸ RULING B-i, and it is a per-surface question.
   *
   * An entity page prints "08 OF 48" because 48 is a real, knowable catalogue and
   * the pair tells you how much of it you just cut. A result set has no such
   * number worth printing, so the slot stays EMPTY until a filter is on and then
   * prints only what survived: "a count now only appears when it is answering
   * something you changed".
   */
  showTotal?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const filter = useFilterState(defaults, sortCycle, kindCycle);
  // The entity overlay is still read unconditionally — it owns the sheet's
  // PRESENTATION (the uncover handshake with the nav) on every surface, and a
  // hook cannot be called conditionally anyway. What the props override is only
  // the subject matter.
  const overlay = useEntityOverlay();
  const { uncoverFilter } = overlay;
  // Adaptive to THIS subject — decades and genres fall out of the rows
  // themselves (newest first, and no future decade unless a dated unreleased
  // title puts one there).
  const films = rows ?? overlay.films;
  const appliedFilter = applied ?? overlay.appliedFilter;
  const setAppliedFilter = onApply ?? overlay.setAppliedFilter;
  const derivedDecades = useMemo(() => decadesIn(films), [films]);
  // Same rule as the decades: only offer what this filmography actually
  // contains. A comedian has no business being offered WESTERN.
  const derivedGenres = useMemo(() => {
    const seen = new Set<number>();
    for (const f of films) for (const id of f.genreIds) seen.add(id);
    return [...seen];
  }, [films]);
  /**
   * ▸ ON RESULTS THE OPTIONS BELONG TO THE KIND, NOT TO THE FILMS (increment 06).
   *
   * `films` is the film-and-show slice, which is the whole subject on an entity page
   * but only part of it here — a person's genres, a studio's decades and a
   * collection's are all carried on rows that are not films at all. Derived from
   * `films` the grid would offer a searched-for actor the genres of some unrelated
   * movie in the same result set, and would offer NOTHING at all to a query that
   * returned no films. The results surface computes these from the rows its current
   * kind will actually filter and passes them in.
   */
  const decades = decadeOptions ?? derivedDecades;
  const genresPresent = genreOptions ?? derivedGenres;

  /* ── THE COUNT, AND WHY IT IS LIVE. ───────────────────────────────────────
     The sheet covers the page it filters, so the number in the header is the
     only feedback there is: it is how you find out that RELEASED + 2020S + 8.0
     leaves you two films BEFORE you commit to seeing two films. Counted with
     `countMatching` — the page's own predicate, so this number and the rows
     behind the sheet can never be two different claims (see entities.ts).

     It counts the DRAFT. The page is still showing `appliedFilter` until APPLY
     says otherwise, which is the whole point of having both. */
  const shown = useMemo(
    () => (countFor ? countFor(filter.state) : countMatching(films, filter.state)),
    [countFor, films, filter.state]
  );

  /* ── THE DRAFT IS SEEDED FROM WHAT THE PAGE IS SHOWING, on every open. ─────
     Two reasons, and the second is the one that bites. (1) Reopening the sheet
     must show you the filter you are actually looking at, not a blank one that
     would silently undo it on the next APPLY. (2) The sheet is mounted for the
     life of the page now, so its draft outlives any single visit — without this
     it would also outlive a CLOSE, and abandoning a sheet would leave the
     abandoned picks lying in wait for the next time it opened. Closing throws
     the draft away; this is where that happens. */
  /** Is there anything to COMMIT? Not "is anything picked" — see CommitBar. */
  const dirty = useMemo(
    () => !sameFilter(filter.state, appliedFilter),
    [filter.state, appliedFilter]
  );

  const setDraft = filter.setState;
  const appliedRef = useRef(appliedFilter);
  appliedRef.current = appliedFilter;
  useEffect(() => {
    if (open) setDraft(appliedRef.current);
  }, [open, setDraft]);

  // 0 = the pill, 1 = the sheet. The drag writes it too, so the interactive
  // close and the button close are one geometry.
  const p = useSharedValue(0);
  // 0 = an empty panel, 1 = every row home. Starts the instant the rows mount.
  const reveal = useSharedValue(0);
  // Native layers only once nothing is moving. See the header note.
  const [settled, setSettled] = useState(false);

  /* ── ARMED: the instrument is BUILT BEFORE IT IS ASKED FOR. ────────────────
     This is why the content used to take so long to appear, and no amount of
     animation tuning was ever going to fix it. Building these five sections is
     real work — seventy-six animated dots, eighteen SVG marks, two scrollers —
     and it used to happen at the moment the bubble landed, in the one task
     between the morph finishing and the first row being able to paint. The
     user had already watched the page open; then they waited for it to exist.

     So the sheet is now MOUNTED for the whole life of an entity page (see the
     search screen) and builds itself once, quietly, after the page's own
     opening animation is done — InteractionManager, so this never competes
     with a transition that is already running. By the time anyone taps FILTER
     the instrument is built, laid out, and merely invisible. The tap costs a
     timing and nothing else.

     A tap that somehow beats the idle callback arms it immediately rather than
     opening onto an empty sheet — correctness first, the smooth path second. */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (armed) return;
    if (open) {
      setArmed(true);
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => setArmed(true));
    return () => task.cancel();
  }, [armed, open]);

  const startMotion = useCallback(
    (to: number, duration: number, done?: () => void) => {
      p.value = withTiming(to, { duration, easing: Easing.inOut(Easing.cubic) }, (finished) => {
        "worklet";
        if (finished && done) runOnJS(done)();
      });
    },
    [p]
  );

  // ▸ ONE TAP, TWO CLOCKS, STARTED TOGETHER. The bubble's and the cascade's.
  //   Because the rows are already built (see ARMED), the cascade is pure
  //   transform and opacity on the UI thread — so it can be scheduled up front,
  //   overlap the tail of the grow, and land its first rows as the bubble
  //   becomes the screen. Nothing here waits for anything to be constructed.
  //   The driver runs LINEARLY; each row eases cubic-out inside its own slice.
  const land = useCallback(() => setSettled(true), []);
  useEffect(() => {
    if (!open) {
      // ▸ REWOUND WHENEVER IT IS NOT SHOWING. On the ordinary close this is a
      //   no-op — the motion already finished at zero before `open` flipped.
      //   It is here for the path that skips the sheet's own close entirely: a
      //   page can be folded away while the sheet is still up (hardware back,
      //   the nav's search disc), and the provider simply drops `filterOpen`.
      //   While the sheet unmounted on close that reset itself; now that it
      //   lives as long as the page, an un-rewound `p` would leave the NEXT
      //   open with nothing to animate — the sheet would just appear, already
      //   full screen, with no morph at all.
      p.value = 0;
      reveal.value = 0;
      setSettled(false);
      return;
    }
    startMotion(1, GROW_MS, land);
    reveal.value = withDelay(
      CASCADE_LEAD_MS,
      withTiming(1, { duration: REVEAL_MS, easing: Easing.linear })
    );
  }, [open, startMotion, land, reveal, p]);

  // Strip the blur before folding, then run the motion; the caller's state flip
  // is the last thing that happens, never the first. The cascade is rewound
  // here rather than on open, so a re-opened sheet prints again instead of
  // arriving already full.
  //
  // ▸ AND THE BAR COMES BACK NOW, on this frame — not on `onClose`.
  //   The bubble is a shared element and it needs something to be shared WITH.
  //   While `filterOpen` alone drove both the mount and the bar, the pill only
  //   reappeared once the sheet had already finished collapsing and unmounted,
  //   so the bubble was shrinking toward an empty bar and then being replaced
  //   by three islands fading in behind it. It never landed in anything; it
  //   just left, and the nav arrived separately. The sheet is still a full
  //   screen at this instant, so the bar is entirely hidden behind it and this
  //   costs nothing visually — by the time the shrinking bubble uncovers the
  //   bottom of the screen, the pill it is aiming at is already sitting there,
  //   at full strength, in its final pose.
  const closeNow = useCallback(() => {
    setSettled(false);
    reveal.value = 0;
    uncoverFilter();
    startMotion(0, CLOSE_MS, onClose);
  }, [startMotion, onClose, reveal, uncoverFilter]);

  // APPLY commits and leaves — committing without leaving would strand you on a
  // sheet you cannot see the result through. The commit lands BEFORE the
  // collapse and in the same task, so the page re-renders while the sheet still
  // covers the whole screen: the filmography is already filtered by the time
  // the shrinking bubble uncovers it, rather than visibly re-shuffling once it
  // has. That ordering is also the cheapest place to put the work — the one
  // moment in the whole motion when nothing of the page is on screen.
  const applyNow = useCallback(() => {
    setAppliedFilter(filter.state);
    closeNow();
  }, [setAppliedFilter, filter.state, closeNow]);

  const R = NAV_FILTER_RECT;
  const titleRestY = insets.top + PAD_TOP + (HEADER_H - 24) / 2;

  /** See the FIT block. Two rows if the screen can pay for them at the padding
   *  floor; then whatever is left buys back the rhythm, up to full. */
  const fit = useMemo(() => {
    const budget =
      SCREEN_H -
      insets.top -
      PAD_TOP -
      insets.bottom -
      COMMIT_BOTTOM -
      COMMIT_H -
      FIT_MIN_GAP -
      FIT_FIXED;
    const window = (rows: number) => FIT_CELL_H * rows + FIT_ROW_GAP * (rows - 1);
    const rows = budget - window(2) >= FIT_PAD_FULL * FIT_PAD_FLOOR ? 2 : 1;
    const forPadding = budget - window(rows);
    const scale = Math.max(FIT_PAD_FLOOR, Math.min(1, forPadding / FIT_PAD_FULL));
    return { rows, scale };
  }, [insets.top, insets.bottom]);
  // Rounded once here rather than at five call sites, so the sections cannot
  // drift apart by a subpixel and stop looking like one rhythm.
  const padFirst = Math.round(30 * fit.scale);
  const padBreak = Math.round(36 * fit.scale);
  const padStep = Math.round(26 * fit.scale);

  /**
   * ▸ THE PILL'S FILTERED STATE, WORN BY THE CAPSULE THAT IS THE PILL.
   *
   * The nav pill goes accent when the page is filtered (see `filtersOn` in the
   * tab layout). This sheet's first and last frames ARE that pill — same rect,
   * same word — and the exchange between them is a single frame with no
   * crossfade, so they have to be the same colour or the handover flashes.
   *
   * It reads the APPLIED filter, never the draft: the draft going blue mid-edit
   * would repaint the sheet's own title while you were still deciding, and the
   * pill you are going back to has not changed yet. On APPLY the commit lands
   * before the collapse, so by the time these frames are drawn this is already
   * the truth about the page underneath.
   */
  const filtersOn = !isDefault(appliedFilter, defaults);
  const pillInk = filtersOn ? ACCENT : INK;

  /**
   * ▸ THE SHEET IS COMPOSED FROM A TABLE, NOT WRITTEN OUT (increment 04).
   *
   * `bands` is whichever composition this surface asked for — an entity page's
   * ENTITY_BANDS, or BANDS_FOR[kind] on results. Building the rows by hand for six
   * kinds is exactly how they drifted apart the first time.
   *
   * ⚠ A BAND WITH NO CONTROL YET IS DROPPED, NOT DRAWN EMPTY. KNOWN FOR, CATALOGUE
   * and SIZE arrive in increments 05, 08 and 09; until then those kinds simply show
   * fewer bands, which is still strictly better than today's sheet showing four film
   * controls that do nothing to a list of people. Filtering BEFORE numbering is what
   * keeps `01 · SORT BY / 02 · GENRE` gapless in the meantime.
   */
  const bands = useMemo(
    // ⚠ THE DEFAULT IS THE ENTITY PAGE'S COMPOSITION, NOT BANDS_FOR[kind]. An entity
    // page mounts this with no props at all, and its kind is "any" — defaulting to
    // the ALL sheet would silently take its MINIMUM RATING away and unpair its
    // STATUS + FORMAT row. The results surface is the one that opts in.
    //
    // Filtered against a LIST of built bands, never by calling renderBand — that
    // reads values declared below this memo and crashed the sheet on first mount.
    () => (bandsProp ?? ENTITY_BANDS).filter((b) => IMPLEMENTED_BANDS.has(b)),
    [bandsProp]
  );
  // `bandRows`, not `rows` — `rows` is already this component's films prop.
  const bandRows = numberedBands(bands);
  /** Bands plus the commit bar — what the cascade's step is divided by. */
  const rowCount = bandRows.length + 1;

  /** The stops this kind actually offers, and the source the dots count. Replaces
   *  the old `sortLocked` boolean: PEOPLE is no longer relevance-only, it is
   *  relevance + A–Z, so "locked" was never the real question. */
  const sortStops = sortStopsFor(filter.state.kind, sortCycle);

  /**
   * ▸ GENRE TAKES THE ROOM THE MISSING BANDS LEAVE (Bryan, 2026-08-08: "when we
   * have a large gap like this, make it so that the genre tiles keep on expanding
   * down to fill up that space").
   *
   * The `fit` budget is computed for the FULLEST sheet — five rows of bands. A
   * three-band sheet like PEOPLE leaves two bands' worth of floor (~96pt each), and
   * a genre row costs ~82, so each absent band buys exactly one more visible row.
   * Capped at what the grid actually holds: a viewport taller than the genres it
   * offers would be an empty frame pretending there is more to scroll to.
   */
  const genreRows = Math.min(
    fit.rows + Math.max(0, 5 - bandRows.length),
    Math.max(1, Math.ceil(genresPresent.length / 4))
  );
  /** TV's word for RELEASED is AIRED. Same state, per-kind vocabulary. */
  const statusLabels = statusLabelsFor(filter.state.kind);

  function renderBand(band: FilterBand): React.ReactNode {
    switch (band) {
      case "sort":
        // Which zone is not really a filter — see the colour rule in
        // FilterControls. Read off the SURFACE'S defaults rather than written
        // out, so the two can never drift apart — and so that RELEVANCE reads as
        // the resting order on results exactly as RELEASE DATE does on an entity
        // page.
        return (
          <SortBar
            field={SORT_LABELS[filter.state.sort]}
            // The dots count the stops this KIND has, so the control can never
            // promise a stop it does not own — one dot on a one-stop cycle is how
            // this instrument has always said "this is the whole cycle".
            fieldIndex={Math.max(0, sortStops.indexOf(filter.state.sort))}
            fieldCount={sortStops.length}
            fieldActive={filter.state.sort !== defaults.sort}
            onCycleField={filter.cycleSort}
            descLabel={DIRECTION_LABELS[filter.state.sort].desc}
            ascLabel={DIRECTION_LABELS[filter.state.sort].asc}
            desc={filter.state.desc}
            dirActive={filter.state.desc !== defaults.desc}
            onSetDesc={filter.setDesc}
            // RELEVANCE has no second end worth offering — the row rests as one
            // full-width button and only splits once you cycle to a field that
            // does. Entity pages never reach this value, so this is `true` for
            // the life of that sheet.
            showDirection={filter.state.sort !== "relevance"}
          />
        );
      // Two half-width cycles sharing one row, and their labels sharing another —
      // the board pairs them deliberately, because they are the same kind of
      // question. They print as ONE row of the cascade for the same reason.
      case "statusKind":
        return (
          <View style={styles.pairRow}>
            <CycleButton
              label={statusLabels[filter.state.status]}
              index={STATUS_CYCLE.indexOf(filter.state.status)}
              count={STATUS_CYCLE.length}
              active={filter.state.status !== defaults.status}
              onPress={filter.cycleStatus}
            />
            <CycleButton
              label={KIND_LABELS[filter.state.kind]}
              index={kindCycle.indexOf(filter.state.kind)}
              count={kindCycle.length}
              active={filter.state.kind !== defaults.kind}
              onPress={filter.cycleKind}
            />
          </View>
        );
      // STATUS ON ITS OWN, FULL WIDTH (increment 05). On results there is nothing
      // left to pair it with — kind is navigation now — so the half-width cycle it
      // used to share a row with became a three-chip row that says all three
      // answers at once instead of making you tap to discover them.
      case "status":
        return (
          <ChipRow
            options={STATUS_CYCLE.map((k) => ({ key: k, label: statusLabels[k] }))}
            value={filter.state.status}
            defaultKey={defaults.status}
            onChange={filter.setStatus}
          />
        );
      // CATALOGUE — two fields in one band, each opening to take the whole width.
      // STUDIOS only; see Row G of the master flow.
      case "catalogue":
        return (
          <CatalogueBand
            basedIn={filter.state.basedIn}
            onBasedIn={filter.setBasedIn}
            countries={countryOptions ?? []}
            size={filter.state.sizeBand}
            onSize={filter.setSizeBand}
            sizeBands={sizeBandsFor(filter.state.kind)}
          />
        );
      // SIZE on COLLECTIONS is a band of its own, so unlike the studio version it
      // needs no tap-to-open — it is already the chip row.
      case "size":
        return (
          <ChipRow
            options={[
              { key: "any", label: "ANY" },
              ...sizeBandsFor(filter.state.kind).map((b) => ({ key: b, label: b })),
            ]}
            value={filter.state.sizeBand ?? "any"}
            defaultKey="any"
            onChange={(k) => filter.setSizeBand(k === "any" ? null : (k as SizeBandKey))}
          />
        );
      // KNOWN FOR — PEOPLE only. ANY is the first chip and it is load-bearing:
      // defaulting to ACTING would hide every director on a sheet that never said
      // it was filtering. CREW is the catch-all for TMDB's long department tail.
      // KNOWN FOR is a CYCLE, not a chip row (Bryan, 2026-08-08): "tap on it and
      // it rotates through the options... like the Sort by", minus the direction
      // morph SORT has, because there is nothing to reverse. The dots say how many
      // stops there are and which one you are on — the control's standing idiom.
      // ANY is still the first stop, so the sheet still rests unfiltered.
      case "knownFor":
        return (
          <CycleButton
            label={filter.state.knownFor.toUpperCase()}
            index={KNOWN_FOR_CYCLE.indexOf(filter.state.knownFor)}
            count={KNOWN_FOR_CYCLE.length}
            active={filter.state.knownFor !== defaults.knownFor}
            onPress={filter.cycleKnownFor}
            half={false}
          />
        );
      case "decade":
        return (
          <DecadeScroller
            decades={decades}
            value={filter.state.decade}
            onChange={filter.setDecade}
            runWidth={SCREEN_W - PAD_H * 2}
          />
        );
      case "rating":
        return (
          <RatingField
            value={filter.state.minRating}
            onChange={filter.setMinRating}
            runWidth={SCREEN_W - PAD_H * 2}
          />
        );
      case "genre":
        return (
          <GenreMap
            available={genresPresent}
            chosen={filter.state.genres}
            onToggle={filter.toggleGenre}
            runWidth={SCREEN_W - PAD_H * 2}
            visibleRows={genreRows}
          />
        );
      // STATUS as its own full-width chip row (05), CATALOGUE (08) and SIZE (09).
      // Null here is what drops the band entirely — see the note on `bands`.
      default:
        return null;
    }
  }

  const dragClose = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetX([-16, 16])
    .onUpdate((e) => {
      "worklet";
      p.value = Math.max(0, 1 - Math.max(0, e.translationY) / SCREEN_H);
    })
    .onEnd((e) => {
      "worklet";
      const commit =
        e.translationY > SCREEN_H * DRAG_CLOSE_FRACTION || e.velocityY > DRAG_CLOSE_VELOCITY;
      if (commit) runOnJS(closeNow)();
      else runOnJS(startMotion)(1, SNAP_MS);
    });

  // ── The morph. THE CENTRE LEADS, then the size follows. ───────────────────
  //
  // Centre travels over [0 … 0.55] and the box only starts swelling at 0.12, so
  // the first thing you see is the pill LIFTING off the bar — the reference's
  // 2.17 frame — and the swell arrives under it. Both edges then move: the box
  // is always centred on its own travelling centre, never anchored to an edge.
  const windowStyle = useAnimatedStyle(() => {
    const v = p.value;
    const cy = interpolate(v, [0, 0.55], [R.y + R.height / 2, SCREEN_H / 2], "clamp");
    const w = interpolate(v, [PILL_SIZE_HOLD, 0.8], [R.width, SCREEN_W], "clamp");
    const h = interpolate(v, [PILL_SIZE_HOLD, 1], [R.height, SCREEN_H], "clamp");
    return {
      // The pill is already dead-centre horizontally, so one expression covers
      // both ends and the bubble can never drift sideways.
      left: (SCREEN_W - w) / 2,
      top: cy - h / 2,
      width: w,
      height: h,
      // A true capsule while it is short enough to be one, a BUBBLE for most of
      // the flight, square only as it meets the screen's edges. `min` with the
      // half-dimensions is what keeps it a capsule at the start without any
      // second curve to tune. At v = 0 this resolves to BAR_H / 2 — which IS
      // the nav pill's radius, so the two shapes are the same shape.
      borderRadius: Math.min(
        h / 2,
        w / 2,
        interpolate(v, [0.72, 1], [BUBBLE_R, 0], "clamp")
      ),
    };
  });

  // The rim, on the window's own shape, leaving on the tint's ramp. See the
  // note above it: this is the pill's hairline, borrowed for the handover and
  // handed straight back.
  const rimStyle = useAnimatedStyle(() => {
    const v = p.value;
    const w = interpolate(v, [PILL_SIZE_HOLD, 0.8], [R.width, SCREEN_W], "clamp");
    const h = interpolate(v, [PILL_SIZE_HOLD, 1], [R.height, SCREEN_H], "clamp");
    return {
      opacity: interpolate(v, [0, PILL_MATCH], [1, 0], "clamp"),
      borderRadius: Math.min(h / 2, w / 2, interpolate(v, [0.72, 1], [BUBBLE_R, 0], "clamp")),
    };
  });

  // ▸ THE OTHER HALF OF THE HANDOVER. The nav pill switches itself off in the
  //   same commit that mounts this sheet, so the swap frame is the only frame
  //   where a mismatch could show — and a capsule that changed colour the
  //   instant you touched it would give the whole trick away. So the sheet is
  //   BORN WEARING THE PILL'S FILL, exactly, and only becomes its own darker
  //   material as it starts to grow. Same on the way back down.
  //   ⚠ Known remaining delta: the pill also carries a live blur and this does
  //   not, because the sheet's blur cannot mount mid-flight (see the header).
  //   Tint, rim, radius and type all match; sharpness does not.
  const tintStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, PILL_MATCH], [NAV_GLASS_TINT, SHEET_TINT]),
  }));
  // ▸ AND THE PILL'S BLUR, which used to be the one thing that could not follow.
  //   Bryan, on the landing: "the blur is not even there, you can see straight
  //   through the button" — then a frame later the real pill arrives wearing it.
  //   The sheet's own blur cannot help: it is screen-sized and must not exist
  //   while the window is being resized (the settled-strip law), so it is gone
  //   for the whole collapse. This is a second, PILL-SIZED effect view at the
  //   window's own origin, carrying the nav's exact intensity — so the frames
  //   either side of the swap are the same glass. It is only affordable because
  //   the sheet is pre-mounted: it is born at its full 200×54 during an idle
  //   moment, never at zero and never resized, which is the whole of what broke
  //   the nav pill's own blur once. It lives exactly as long as the window is
  //   still pill-SIZED and is gone before the box grows a point.
  const pillBlurStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, PILL_SIZE_HOLD], [1, 0], "clamp"),
  }));

  // Everything the sheet wears rides WITH the bubble: window-relative, so it is
  // already in place when the bubble finishes becoming the screen.
  const titleStyle = useAnimatedStyle(() => ({
    // From the capsule's own centre to the header's title line.
    top: interpolate(p.value, [0, 1], [(R.height - 24) / 2, titleRestY], "clamp"),
  }));

  // The page behind washes back as the bubble takes over — the reference dims
  // steadily from the moment of the tap.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.55], [0, SCRIM_MAX], "clamp"),
  }));

  // The glyph leaves first, and its BOX leaves with it — width and margin drop
  // to zero on the same ramp, so the word re-centres as the glyph goes instead
  // of sitting 13pt right of the header slot it has to land in.
  const glyphStyle = useAnimatedStyle(() => {
    const f = interpolate(p.value, [0, 0.28], [1, 0], "clamp");
    return { opacity: f, width: 17 * f, marginRight: PILL_INK_GAP * f };
  });
  // The travelling word is the PILL'S ink — mono, its tracking, its size — so
  // the first frame of the sheet is pixel-identical to the button it came from.
  // It dissolves into the header's display title exactly where that title sits,
  // so the two are never in different places at the same time.
  const travellerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.6, 0.85], [1, 0], "clamp"),
  }));
  // The chrome lands with the shape, not before it — the reference's 2.39 frame
  // is a full-screen page wearing nothing but its title.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.72, 1], [0, 1], "clamp"),
  }));

  return (
    // Mounted for the whole life of an entity page and merely SWITCHED OFF when
    // closed — the built instrument is the point (see ARMED). Opacity rather
    // than an unmount so the rows keep their layout and cost nothing to show.
    <View
      style={[styles.root, !open && styles.dormant]}
      pointerEvents={open ? "box-none" : "none"}
    >
      <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents="none" />
      <GestureDetector gesture={dragClose}>
      <Animated.View style={[styles.window, windowStyle]}>
        {settled && (
          <BlurView
            intensity={SHEET_BLUR}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={styles.blur}
          />
        )}
        <Animated.View style={[styles.tint, tintStyle]} />
        {/* The pill's own glass, at the pill's own size, alive only at the two
            ends of the flight — see pillBlurStyle. Deliberately AFTER the tint:
            the nav island paints its tint as a background and its BlurView as a
            child ON TOP of it, so matching the material means matching the
            order too, not just the two ingredients. */}
        <Animated.View style={[styles.pillBlur, pillBlurStyle]} pointerEvents="none">
          <BlurView
            intensity={NAV_BLUR_INTENSITY}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* The body. Fixed screen-sized box — never laid out mid-morph. */}
        <Animated.View style={[styles.body, { paddingTop: insets.top + PAD_TOP }]}>
          <Animated.View style={[styles.header, chromeStyle]}>
            <Pressable
              onPress={closeNow}
              hitSlop={12}
              style={styles.headerSlot}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
            >
              <Svg width={18} height={18} viewBox="0 0 18 18">
                <Path
                  d="M4 7 L9 12 L14 7"
                  fill="none"
                  stroke={INK}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>FILTER</Text>
              {/* ▸ WHICH PILE THIS SHEET NARROWS (Bryan, 2026-08-08: "I'm losing
                  track of what filter page I'm on"). The kind's own word from the
                  row that chose it, under the title — six sheets stopped being
                  distinguishable the moment their band lists started overlapping. */}
              {subtitle != null && (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
            {/* Right-aligned inside its 64pt slot so a three-digit catalogue
                grows LEFTWARD into the header's empty middle rather than off
                the edge of the screen. */}
            <View style={[styles.headerSlot, styles.countSlot]}>
              {/* ▸ RULING B-i on the results surface: nothing until a filter is
                  on, then the surviving count alone. `filter.untouched` is
                  already the sheet's own "has anything changed" — the idle
                  colour rides it, and here so does existence. The slot keeps its
                  width either way, so the title cannot shift when the number
                  arrives. */}
              {(showTotal || !filter.untouched) && (
                <Text
                  style={[styles.count, filter.untouched ? styles.countIdle : styles.countLive]}
                  numberOfLines={1}
                >
                  {showTotal ? `${pad2(shown)} OF ${pad2(films.length)}` : pad2(shown)}
                </Text>
              )}
            </View>
          </Animated.View>

          {/* The instrument. Sections are plain rows on the sheet — one
              surface, no folders (the board's own caption). Mounted only once
              the bubble has landed, so nothing lays out mid-flight. */}
          {armed && (
            <>
              {bandRows.map(({ band, n }, i) => (
                <RevealRow
                  key={band}
                  index={i}
                  rowCount={rowCount}
                  driver={reveal}
                  style={[
                    styles.section,
                    // THE RHYTHM, unchanged: the first row clears the header, the
                    // SECOND opens the wide seam — everything below it narrows the
                    // list and the one control above it does not — and the rest step
                    // evenly. Keyed off position, so it survives a kind having three
                    // bands or five.
                    { paddingTop: i === 0 ? padFirst : i === 1 ? padBreak : padStep },
                  ]}
                  label={
                    band === "statusKind" ? (
                      <View style={styles.pairRow}>
                        <View style={styles.pairHalf}>
                          <SectionLabel>{bandLabel(band, n)}</SectionLabel>
                        </View>
                        <View style={styles.pairHalf}>
                          <SectionLabel>{`${bandNumber(n + 1)} · ${kindLabel}`}</SectionLabel>
                        </View>
                      </View>
                    ) : (
                      <SectionLabel>{bandLabel(band, n)}</SectionLabel>
                    )
                  }
                >
                  {renderBand(band)}
                </RevealRow>
              ))}

              {/* The verbs are the cascade's LAST row, which is the order you
                  read the page in: the instrument, then what to do about it.
                  No `label` — a button row has nothing to print above itself,
                  so it simply arrives on the body beat. */}
              <RevealRow
                index={bandRows.length}
                rowCount={rowCount}
                driver={reveal}
                style={[styles.commitBar, { bottom: insets.bottom + COMMIT_BOTTOM }]}
              >
                <CommitBar
                  canApply={dirty}
                  canReset={!filter.untouched}
                  onReset={filter.reset}
                  onApply={applyNow}
                />
              </RevealRow>
            </>
          )}
        </Animated.View>

        {/* The travelling word, and the pill's glyph seeing it off. */}
        <Animated.View style={[styles.titleRow, titleStyle, travellerStyle]}>
          <Animated.View style={glyphStyle}>
            <Svg width={17} height={17} viewBox="0 0 17 17">
              <Path
                d="M2 4.25H8.5M12.5 4.25H15M2 8.5H3.5M7.5 8.5H15M2 12.75H7M11 12.75H15"
                stroke={pillInk}
                strokeWidth={1.4}
                strokeLinecap="round"
                fill="none"
              />
              <Path
                d="M10.5 2.25a2 2 0 100 4 2 2 0 000-4ZM5.5 6.5a2 2 0 100 4 2 2 0 000-4ZM9 10.75a2 2 0 100 4 2 2 0 000-4Z"
                stroke={pillInk}
                strokeWidth={1.4}
                fill="none"
              />
            </Svg>
          </Animated.View>
          <Text
            style={[styles.pillWord, { color: pillInk }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            FILTER
          </Text>
        </Animated.View>

        {/* THE RIM, LAST — so it draws over the tint, the blur and the body
            rather than through a gap between them. Gone by the time this is a
            page; see the note by its constants. Its colour is the pill's, for
            the reason given at `filtersOn`. */}
        <Animated.View
          style={[styles.rim, { borderColor: filtersOn ? ACCENT_LINE : NAV_GLASS_RIM }, rimStyle]}
          pointerEvents="none"
        />
      </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 2500, elevation: 2500 },
  // Built, laid out, and waiting. Never `display: none` — that would throw the
  // layout away and hand the next tap the same build cost this exists to avoid.
  dormant: { opacity: 0 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },
  // The one animated frame in the file. Everything inside is fixed-size.
  window: {
    position: "absolute",
    overflow: "hidden",
  },
  // Fixed and screen-sized so the effect view is never born small and never
  // resized — the failure that cost the nav's pill its blur.
  blur: { position: "absolute", left: 0, top: 0, width: SCREEN_W, height: SCREEN_H },
  // Colour lives in `tintStyle` — it starts as the nav pill's fill.
  tint: { ...StyleSheet.absoluteFillObject },
  // Born at the pill's exact size and never resized — the law the nav's own
  // pill had to learn the hard way. Only its opacity is ever touched.
  pillBlur: {
    position: "absolute",
    left: 0,
    top: 0,
    width: NAV_FILTER_RECT.width,
    height: NAV_FILTER_RECT.height,
  },
  // A line and nothing else. Radius is animated; the width never changes, so
  // this never re-lays anything out.
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: NAV_GLASS_RIM,
  },
  // Window-relative and screen-sized: it rides with the bubble and lands home
  // exactly when the bubble becomes the screen. Never re-laid-out.
  body: {
    position: "absolute",
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    paddingHorizontal: PAD_H,
  },
  header: { flexDirection: "row", alignItems: "center", height: HEADER_H },
  /* ── THE RHYTHM, AND IT IS NOT EVEN ON PURPOSE. ─────────────────────────────
     It used to be 40 under the header and then 30, 30, 30, 30 — which is a
     uniform list wearing one larger gap at the top, and a uniform list says
     every seam between these controls is the same size of idea. One of them
     is not.

     ▸ 26 BETWEEN FILTERS. 02 STATUS · 03 FORMAT, 04 DECADE, 05 RATING and
       06 GENRE all ask the same KIND of question — narrow this list by some
       attribute of a film — so they read as one run, tighter than they were.
     ▸ 36 AFTER SORT, the widest seam in the body, because that is where the
       question changes: 01 does not remove a single film, it only reorders
       them. The live count proves it — it is the one control that never moves
       the number in the header. The gap is the sheet saying so.
     ▸ 30 UNDER THE HEADER. Its own margin, and it no longer has to be the
       biggest gap on the page now that the header sits where it should.
     ▸ 12 from a label to the control it names, unchanged — that pair is one
       object and always was.                                                */
  section: { paddingTop: 26, gap: 12 },
  // ⚠ The three paddings live at the CALL SITES now, scaled by `fit` — 30 under
  // the header, 36 after SORT, 26 between filters, all multiplied by one factor
  // so the proportions above survive on a screen that cannot afford them at
  // full size. Nothing static here, or the two would drift.
  pairRow: { flexDirection: "row", gap: 16 },
  pairHalf: { flex: 1 },
  headerSlot: { width: HEADER_SLOT_W, height: HEADER_H, justifyContent: "center" },
  countSlot: { alignItems: "flex-end" },
  count: { fontFamily: "JetBrainsMono_500Medium", fontSize: 11, letterSpacing: 1.32, lineHeight: 14 },
  /** Nothing picked: a fact about the filmography, not a result. */
  countIdle: { color: MUTED },
  /** Something picked: it is now an answer, and it wears the sheet's ON colour
   *  for the same reason a chosen genre does. */
  countLive: { color: ACCENT },
  /** PINNED, not in flow. The board puts the verbs last on the page with
   *  nothing after them, and the body above is a fixed box whose height is
   *  already at the mercy of the screen — leaving the bar in flow would let a
   *  short screen push the one control that ends the task off the bottom.
   *
   *  ⚠ THE GUTTER IS REPEATED HERE ON PURPOSE. `left/right: 0` looked right and
   *  shipped edge-to-edge: this Yoga positions an absolutely-placed child
   *  against the parent's BORDER box, so the body's `paddingHorizontal` — which
   *  every section above inherits — simply does not reach it. The bar was the
   *  only element on the page touching the screen. Naming PAD_H explicitly is
   *  both the fix and the documentation. */
  commitBar: { position: "absolute", left: PAD_H, right: PAD_H },
  headerTitleWrap: { flex: 1, alignItems: "center" },
  // The nav pill's exact label recipe — this text IS that text, continued.
  pillWord: {
    color: INK,
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 12,
    letterSpacing: 1.68,
  },
  // Centred across the whole window on its own row, so its horizontal home is
  // the same in the pill and in the header and only the vertical has to travel.
  // ⚠ NO `gap` HERE. The glyph carries the whole 9pt itself, as an animated
  // marginRight that collapses with it — and a `gap` on top of that made the
  // spacing 18 against the nav pill's 9. That is the jump Bryan caught on the
  // landing: "the spacing and letters are kind of more squeezed together" the
  // frame the real pill takes over. The traveller must BE the pill's ink row,
  // to the point.
  titleRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: INK,
    fontFamily: "BricolageGrotesque_800ExtraBold",
    fontSize: 20,
    letterSpacing: -0.4,
    lineHeight: 24,
  },
  /** The masthead's own sub-line voice — mono 10, muted, wide tracking. */
  subtitle: {
    color: MUTED,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    letterSpacing: 1.4,
    lineHeight: 13,
    marginTop: 2,
  },
});
