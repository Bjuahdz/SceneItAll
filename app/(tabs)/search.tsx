import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  FadeOut,
  interpolate,
  Keyframe,
  runOnJS,
  runOnUI,
  scrollTo as uiScrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { useRouter } from "expo-router";

import type { MarqueeRect, MarqueeRemeasure } from "@/components/search/Marquee";
import FilterSheet from "@/components/entity/FilterSheet";
import { BANDS_FOR } from "@/constants/filterBands";
import { EntityOverlayHost, useEntityOverlay } from "@/contexts/EntityOverlayContext";
import { useSearchIsland } from "@/contexts/SearchIslandContext";
import { prefetchEntity } from "@/services/entities";
import ArrivalAurora from "@/components/search/ArrivalAurora";
import BackToRecent, { DOOR_BLOCK } from "@/components/search/BackToRecent";
import ComposeState from "@/components/search/ComposeState";
import DefaultState from "@/components/search/DefaultState";
import QuickSearches from "@/components/search/QuickSearches";
import EmptyState from "@/components/search/EmptyState";
import ResultRow from "@/components/search/ResultRow";
import QueryEcho from "@/components/search/QueryEcho";
import RecentsBoard, { ANCHOR_LIFT } from "@/components/search/RecentsBoard";
import type { LandWeight } from "@/components/search/RecentTile";
import SkeletonRows from "@/components/search/SkeletonRows";
import SubmittedState from "@/components/search/SubmittedState";
import KindRow, { KIND_ROW_LABEL, KIND_UNIT, ROW_KINDS } from "@/components/search/KindRow";
import ZeroResults from "@/components/search/ZeroResults";
import { FONT, SEARCH_LAYOUT, SIGNAL, TRACK, groundAlpha } from "@/constants/signal";
import { useRecentSearches } from "@/contexts/RecentSearchesContext";
import { updateSearchCount } from "@/services/appwrite";
import { useBoolPref } from "@/hooks/useBoolPref";
import {
  PREF_ANCHOR_GUIDE,
  PREF_BENTO_RECENTS,
  PREF_DEMO_ARRIVALS,
  PREF_LAND_HAPTICS,
} from "@/services/prefs";
import { useSearch } from "@/hooks/useSearch";
import { useVault } from "@/hooks/useVault";
import {
  fetchDirectorSurname,
  filterResults,
  gateByKind,
  genresIn,
  decadesInRows,
  countriesIn,
  resultFilms,
  toRecentSearch,
  type SearchResult,
} from "@/services/search";
import {
  SEARCH_FILTER_DEFAULTS,
  SEARCH_KIND_CYCLE,
  SEARCH_SORT_CYCLE,
  isDefault,
  withKind,
  type FilterState,
  type KindKey,
} from "@/hooks/useFilterState";
import type { RecentSearch } from "@/services/db";

// The dedicated search page. The input is NOT here — it lives in the nav's search
// satellite, which expands in place while the pill collapses to the tab you came
// from. This screen reads the query through useSearch() and routes between states.
//
// Every state on this screen is either real data or an honest absence. Nothing here
// fabricates artwork, counts, or recommendations it cannot justify.

const NAV_CLEARANCE = 76;

/**
 * ▸ THE SEARCH LIST DISSOLVES INSTEAD OF VANISHING.
 *
 * Tapping the clear-× while looking at results dropped a full list to the blank
 * compose screen in a single frame. Bryan: "it's not literally jittering, but it
 * seems like it is because we're going back to the blank sheet."
 *
 * `FadeOut` keeps the node MOUNTED for its duration, which is the part that matters
 * beyond the fade itself: the ScrollView's content height does not collapse until
 * the animation ends, so there is no instant reflow underneath the thing you are
 * watching leave. It dissolves, and only then does the height go.
 *
 * 160ms because this is a dismissal, not a reveal — long enough to read as a
 * departure, short enough that the field is never waiting on it.
 *
 * ⚠ Every branch that can be cleared away wears the SAME wrapper type. React
 * reconciles by position and type, so typing → skeletons → results → submitted all
 * update one Animated.View in place and never animate; only a swap to a different
 * element type (ComposeState, the board) unmounts it and runs the exit. Making one
 * of these a plain View would silently reintroduce a remount — and a flash — on
 * every keystroke that emptied the results.
 */
const LIST_EXIT = FadeOut.duration(160);

/**
 * ▸ THE BOARD DOES NOT BLINK OUT — recents ⇄ compose, both directions.
 *
 * Tapping the field swapped `<RecentsBoard>` for `<ComposeState>` in one commit, so a
 * screen of artwork vanished between frames and reappeared the same way (Bryan: "very
 * abrupt... really ugly").
 *
 * Both directions carry a little travel as well as opacity — a pure alpha ramp at this
 * speed still reads as a cut. The board leaves UPWARD and arrives from ABOVE, which is
 * the direction everything on this surface already moves.
 *
 * ⚠ THE ENTRANCE'S REAL PROBLEM WAS NEVER ITS DURATION. `keyboardUp` flips on
 * `keyboardDidHide`, which by definition fires AFTER the keyboard's full ~250ms slide
 * — so the board did not begin to exist until the keyboard was already gone, and only
 * then spent its fade. Half a second of nothing (Bryan: "very delayed... super bad").
 * The mount now leads on `keyboardWillHide` (see `kbLeaving`), so the board comes back
 * THROUGH the descending keyboard instead of waiting politely behind it.
 *
 * The exit still has to be over before a fast typist's first keystroke renders results
 * behind a dissolving board; 200ms sits inside the keyboard's own rise.
 */
const BOARD_OUT = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: {
    opacity: 0,
    transform: [{ translateY: -12 }],
    easing: Easing.in(Easing.cubic),
  },
}).duration(200);
const BOARD_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: -18 }] },
  100: {
    opacity: 1,
    transform: [{ translateY: 0 }],
    easing: Easing.out(Easing.cubic),
  },
}).duration(220);

/**
 * How long "idle, keyboard down" has to HOLD before a search session is closed.
 *
 * Sized against the slower of the two keyboard signals, not the faster: iOS reports
 * `keyboardWillShow` the moment focus lands, but Android only has `keyboardDidShow`,
 * which arrives after its ~250ms animation. The dwell has to outlast that or the
 * platform decides where a user's sitting ends.
 */
const SESSION_END_MS = 500;

/** These are SAFETY fades, not the light's performance — the bloom animates its own
 *  ignition and recession internally, and the frame review proved a slow wrapper fade
 *  MUTES both: at 380 in, the ignition played at half opacity and lost the race with
 *  the first card; at 900 out, the fade multiplied with the internal recede and
 *  flattened it into an opacity dim. In only covers the mount pop; out only cleans the
 *  tail after the recede has already finished. */
const AURORA_IN = 160;
const AURORA_OUT = 260;
/** The interrupted exit — you touched the field mid-cascade, so the light leaves
 *  briskly instead of dissolving over a list it has nothing to do with. */
const AURORA_CUT = 220;

/**
 * ▸ THE LANDING HAPTICS (dev toggle, PREF_LAND_HAPTICS) — Bryan's "little oomph".
 *
 * ⚠ NO SCHEDULE HERE, AND THAT IS THE FIX. The first cut fired each tap on a timer
 * at `beat + LAND_MS`, which was badly late ("super delayed") — a damped spring
 * covers its distance early and eases into the slot, so the end of its duration is
 * the end of a quiet tail rather than the arrival the eye sees. The TILE now raises
 * the cue when it actually reaches its slot (see LAND_HAPTIC_AT in RecentTile) and
 * this screen only decides whether the cue is allowed to become a tap.
 *
 * `Soft` deliberately: a cascade of up to ~30 taps has to read as a settling, and
 * Medium/Heavy repeated thirty times is a pneumatic drill, not a premium detail.
 */
/** Floor between landing cues. A no-op at today's 150ms stagger; it exists so
 *  that lowering LAND_STEP later cannot turn the cascade into a buzz.
 *
 *  (The landing once had an audible half — the "thock", a synthesized per-mass
 *  sound riding this same cue. Bryan deleted it entirely 2026-08-10 after two
 *  latency rounds hit Expo Go's audio-stack floor: "doesn't add too much to the
 *  design". If a landing sound ever returns, it needs a dev build, and the
 *  transcript history has the full sound design + latency contract.) */
const CUE_MIN_GAP = 90;

/**
 * ▸ THE MASTHEAD MORPH — every number Bryan tunes lives here.
 *
 * The resting masthead (RECENT 30px left, count right) and the collapsed bar are ONE
 * pair of texts: as the page scrolls, each detaches from its resting spot and
 * TRAVELS — title from the left to the centre, count from the right to the centre
 * beneath it — shrinking as it goes, then stays pinned at the bar pose. The
 * board's in-flow masthead is layout-only (invisible); these are the real glyphs.
 */
/** Collapsed title size. The resting title is 30 — raise this if the bar is hard
 *  to read (it was 14 and Bryan called it too small). */
const BAR_TITLE_SIZE = 18;
/** Collapsed count size. Resting is 11. */
const BAR_COUNT_SIZE = 10;
/** Screen y of the collapsed TITLE's centre. HIGHER NUMBER = LOWER ON SCREEN —
 *  "bring it down a little bit so that it's easier to read". Stay under
 *  SEARCH_LAYOUT.topEdge (138) or the text outruns its own glass. */
const BAR_TITLE_Y = SEARCH_LAYOUT.topEdgeSolid + 32;
/** The count's centre sits this far beneath the title's centre in the bar. */
const BAR_GAP = 16;
/** Scroll distance that completes the morph. LOWER = snappier, HIGHER = more
 *  gradual travel. */
const MORPH_DISTANCE = 96;
/** Where the resting texts' centres sit — derived from the content geometry
 *  (contentTop + half the 32pt title line; the count riding the shared baseline).
 *  Not knobs: these must MATCH the masthead or the morph starts with a jump. */
const REST_TITLE_CY = SEARCH_LAYOUT.contentTop + 16;
const REST_COUNT_CY = SEARCH_LAYOUT.contentTop + 21;

/**
 * ▸ SWIPE LEFT-TO-RIGHT = THE DOOR (Bryan, V3 ruling D: "both gestures already
 * exist — swipe left-to-right returns to RECENT, the header arrow is its visible
 * hint"). Thresholds and axis guards are the ENTITY PAGE'S, not new numbers —
 * that back-swipe is shipped, tuned and living in a vertical list with exactly
 * this hazard, so the two doors out of a reading surface answer to one feel.
 */
const SWIPE_BACK_FRACTION = 0.3;
const SWIPE_BACK_VELOCITY = 800;


export default function SearchScreen() {
  const {
    query,
    phase,
    results,
    resultsQuery,
    total,
    submitted,
    error,
    suggestions,
    keyboardUp,
    clear,
  } = useSearch();
  // The results carry their own query stamp. Using it — rather than trusting that
  // `results` must belong to the live query — is the whole reason it exists: rows
  // are deliberately held across a re-fetch so the list doesn't blank on every
  // keystroke, which means they CAN be one query behind.
  const resultsMatchQuery = resultsQuery === query;
  const { recents, recordSearch, seedDemoArrival, purgeDemoArrivals, demoEpoch } =
    useRecentSearches();
  const { entryIds } = useVault();
  const router = useRouter();
  /**
   * Which recents row is expanded — owned HERE rather than inside DefaultState.
   *
   * DefaultState used to stay mounted while the keyboard was up and merely derive
   * everything closed, precisely so that dismissing the keyboard returned you to the
   * row you had open instead of snapping back to 01. COMPOSE unmounts it instead, so
   * that state has to live somewhere that survives.
   *
   * ⚠ TEMPORARY. This dies with DefaultState at R4 — the recents board has no
   * accordion at all, because every tile is already the artwork the marquee existed
   * to reveal.
   */
  const [recentsOpenIndex, setRecentsOpenIndex] = useState<number | null>(0);
  const bentoRecents = useBoolPref(PREF_BENTO_RECENTS, false);
  /**
   * ▸ DEV: DEMO ARRIVALS — a fake sitting on every return to the tab.
   *
   * Iterating the arrival by hand meant searching eight things to see one cascade
   * (Bryan: "I'm getting tired of having to search multiple people or movies all the
   * time"). With the pref on, REGAINING FOCUS seeds a session of 8–11 real entities
   * from the archive and the board plays it exactly as if they had been searched.
   *
   * One seed per focus, latched by a ref: `useIsFocused` flips once per visit, and
   * the latch means typing or clearing while on the tab can never re-trigger it —
   * the demo is a doorbell, not a metronome.
   */
  const demoArrivals = useBoolPref(PREF_DEMO_ARRIVALS, false);
  /** The anchor guide (dev instrument): the fixed LIFT line plus a live readout of
   *  requested vs actual offset — the pair that turns "it didn't anchor" into two
   *  numbers naming which half failed. */
  const anchorGuide = useBoolPref(PREF_ANCHOR_GUIDE, false);
  const { width: winW, height: winH } = useWindowDimensions();
  /** The morphing texts' measured widths — centring needs them, and "RECENT" is the
   *  same width everywhere but the count changes with the number it carries. */
  const [morphTitleW, setMorphTitleW] = useState(0);
  const [morphCountW, setMorphCountW] = useState(0);
  const [guideTarget, setGuideTarget] = useState<number | null>(null);
  const [guideMax, setGuideMax] = useState<number | null>(null);
  const [guideAt, setGuideAt] = useState(0);
  /**
   * ▸ THE PROP-DRIVEN OFFSET — the last scroll mechanism Expo Go leaves us.
   *
   * The guide proved both COMMAND pathways dead: `scroll 70/259/439 · at 0` across
   * reloads — six dispatches each through the JS ref command AND Reanimated's
   * UI-thread command, page never moved a point; the only successes were spacer
   * cases that needed no scroll. `contentOffset` is not a command — it is a PROP,
   * applied through the same pipeline that renders everything else on this screen.
   * It only re-asserts when its VALUE changes (so it never fights the user's own
   * scrolling afterwards), which is also why equal consecutive targets get nudged
   * by half a point — an unchanged prop applies nothing.
   */
  const [anchorOffset, setAnchorOffset] = useState(0);
  const isFocused = useIsFocused();
  const seededFocus = useRef(false);
  useEffect(() => {
    if (!isFocused) {
      seededFocus.current = false;
      return;
    }
    // Gated on the BOARD being the resting surface — the arrival only exists there,
    // and seeding fake rows into the plain ledger would be pollution with no payoff.
    if (!demoArrivals || !bentoRecents || seededFocus.current) return;
    seededFocus.current = true;
    seedDemoArrival();
  }, [isFocused, demoArrivals, bentoRecents, seedDemoArrival]);
  // Flipping the toggle OFF is "back to my real board" — the fake rows leave with it.
  // Also runs at mount, where it is a no-op on a clean ledger.
  useEffect(() => {
    if (!demoArrivals) purgeDemoArrivals();
  }, [demoArrivals, purgeDemoArrivals]);

  /**
   * ▸ THE SEARCH SESSION — one sitting at the field, start to finish.
   *
   * The recents board's span gate needs this: a landscape tile earns the full-width
   * span only when it is the LAST query of a session and the skyline is level. That
   * rule is unbuildable without knowing where sessions begin and end, and
   * `search_history` has never stored it. Deriving sessions from gaps between
   * timestamps would be inventing data.
   *
   * COMPOSE is where the boundary comes from, which is why it lands in this
   * increment rather than a later one:
   *   · STARTS when the field takes focus and there is no session running.
   *   · ENDS when the recents board is the thing on screen (idle phase, keyboard
   *     down) — exactly Bryan's model, where a session runs for as long as you like
   *     without returning to the board. Opening an entity page and coming back to
   *     your results does NOT end it: the query survives that trip, so the phase is
   *     never idle, so the session is never closed.
   */
  const sessionIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (keyboardUp && sessionIdRef.current === null) sessionIdRef.current = Date.now();
  }, [keyboardUp]);
  /**
   * ▸ AND IT ONLY ENDS IF YOU STAY THERE.
   *
   * ⚠ THE SESSION WAS BEING CUT AFTER EVERY SINGLE SEARCH, and the whole board's
   * monotony followed from it. `clear()` calls `setQuery("")` and `focusInput()` in
   * one tick: the empty query reaches React state immediately, while the keyboard's
   * own event is a native round-trip behind it. So emptying the field to type the
   * next thing passes through two or three frames of EXACTLY this condition — idle
   * phase, keyboard not yet up — and the session died there, every time. Bryan's
   * five-search sitting was stored as five sittings of one.
   *
   * That is not a cosmetic error. **A one-search session means every film closes its
   * own session, and a landscape tile that closes a session SPANS.** So each film
   * became a two- or three-column banner, each banner ate the free columns beside it,
   * and the portraits either side had nowhere to go but the leftover single column —
   * which is the board in the screenshot, and precisely the "film-only history spans
   * forever" trap the span gate's last-query clause exists to prevent.
   *
   * A couple of frames is not a return to the board. Waiting for the state to SETTLE
   * distinguishes "I cleared the field to search again" from "I am done" without
   * asking either one to announce itself — the keyboard coming back cancels the timer
   * mid-flight. Nothing reads the session until the next commit, which is at least a
   * tap away, so the delay is invisible.
   */
  useEffect(() => {
    if (!(phase === "idle" && !keyboardUp)) return;
    const t = setTimeout(() => {
      sessionIdRef.current = null;
    }, SESSION_END_MS);
    return () => clearTimeout(t);
  }, [phase, keyboardUp]);

  // Looking something up IS what earns a place in the ledger, so the commit happens
  // on the tap that opens it.
  //
  // The session id is PASSED IN rather than read from the ref here, because this runs
  // 600ms after the tap (see onPickResult) and the session can legitimately have ended
  // in that window. The row belongs to the session that was live when you chose it.
  const commit = useCallback(
    (r: SearchResult, sessionId: number | null) => {
      recordSearch({ ...toRecentSearch(r), session_id: sessionId });
      // The ledger's open row reads YEAR · DIRECTOR, and a director is in no search
      // response. Buy it once, here, in the background — the dedupe on
      // (entity_type, entity_id) means the follow-up write UPDATES the row in place
      // rather than adding a second one. Navigation never waits on this.
      //
      // ⚠ Carries the SAME session id. The upsert assigns `session_id = excluded.
      // session_id`, so omitting it here would null out the session this row was just
      // stamped with a second later.
      if (r.entityType === "movie") {
        fetchDirectorSurname(r.id)
          .then((surname) => {
            if (surname) {
              recordSearch({ ...toRecentSearch(r), subtitle: surname, session_id: sessionId });
            }
          })
          .catch(() => {});
      }
    },
    [recordSearch]
  );

  // ── Opening an entity page out of the card you tapped ──────────────────────
  //
  // Through the OVERLAY, not the router. Three route-based versions of this motion
  // were intermittently wrong in the same way — the OS owns a screen presentation and
  // sometimes animates it regardless — so the page now mounts as an owned layer above
  // the Stack and grows itself out of the card's rect. See EntityOverlayContext.
  //
  // Entity pages only. Films open the movie sheet, which is already its own motion
  // and, as a real UIKit modal, still presents above the overlay.
  const {
    open: openOverlay,
    isOpen: overlayOpen,
    close: closeOverlay,
    filterOpen,
    closeFilter,
  } = useEntityOverlay();
  // The island's pose follows what is on screen: entity page open ⇒ FILTER pose
  // (seat disc · FILTER pill · search disc), search list ⇒ the expanded field.
  // `collapse`, not `close` — the page is a detour inside the same search session,
  // and coming back must land on the query and results exactly as they were.
  const {
    open: openIsland,
    collapse: collapseIsland,
    setQuery,
    submitQuery,
    resultsFilter,
    setResultsFilter,
    noteResultsScroll,
  } = useSearchIsland();
  // The fold back into the marquee re-expands the field, IN THE SAME COMMIT as
  // the overlay's close. This used to be a falling-edge effect on `overlayOpen`,
  // which by construction ran one commit late — and in that gap the nav bar saw
  // "no entity, no field" and flashed four seats inside a disc-width bar while
  // its two pose springs started a frame apart (the pump the review caught).
  // One callback, one task, one commit: the bar only ever sees a handover.
  //
  // The island now usually re-expands EARLIER, at the fold's commit
  // (`onFoldStart` below), so that the page going home and the field coming
  // back are one movement. `openIsland()` stays here because two doors out
  // never fold at all — a page opened with no origin rect has nothing to fold
  // into and closes on the spot — and on those the fold-start cue never fires.
  // Re-asserting it is free: setting `expanded` true when it already is does
  // not re-render.
  const foldClosed = useCallback(() => {
    openIsland();
    closeOverlay();
  }, [openIsland, closeOverlay]);

  // The list's offset, tracked so it can be FROZEN the instant an entity opens.
  // A tap can land while the list is still settling — late deceleration, the
  // keyboard-drop reflow — and then the tapped card keeps sliding after every
  // measurement of it, for the entire grow. scrollTo(current offset) kills the
  // residual momentum dead, so the card the page grows out of is stationary. The
  // list is behind a scrim during the transition; a frozen background is a feature.
  // An ANIMATED ref, so the anchor can drive the scroll from the UI thread through
  // Reanimated's own command path (see applyAnchor). Ordinary `.current?.scrollTo`
  // calls work unchanged — the ref resolves to the same ScrollView instance.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollOffset = useRef(0);
  /**
   * The same offset again, as a shared value, so the UI thread can read it.
   *
   * ⚠ A PLAIN onScroll PROP WRITING A SHARED VALUE — deliberately not
   * `useAnimatedScrollHandler`, which does not fire at all in Expo Go SDK 54 (this
   * repo already documents that for the discover rails and the entity hero). The
   * WRITE costs a JS-thread assignment at scrollEventThrottle's rate; every reader
   * is a worklet, so the tiles and the top edge animate without a single re-render.
   */
  const scrollY = useSharedValue(0);
  const onListScroll = useCallback(
    (e: {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollOffset.current = y;
      scrollY.value = y;
      // The applied-filter bar's sink rides this same handler — no second listener,
      // and the intent/hysteresis rules live with the shared value in the context.
      //
      // ⚠ THE SINK READS A CLAMPED Y (Bryan's sink ruling, 2026-08-10: sink on
      // scroll down, out on ANY scroll up, "consistent and fluid"). Past either
      // edge the offset is OVERSCROLL — and the bottom bounce's settle is an
      // upward reading the intent accumulators would count as the user asking
      // the bar back out, so it popped out at the end of every deep flick.
      // Clamped, a bounce contributes zero motion in either direction. The tiles
      // keep the RAW offset above — their edge fades ride the bounce on purpose.
      const maxScrollY = Math.max(
        0,
        e.nativeEvent.contentSize.height - e.nativeEvent.layoutMeasurement.height
      );
      noteResultsScroll(Math.min(Math.max(y, 0), maxScrollY));
      // The anchor's confirmation: the page actually reports (about) the target.
      if (pendingAnchor.current !== null && Math.abs(y - pendingAnchor.current) < 2) {
        pendingAnchor.current = null;
      }
      // Quantised so the debug readout costs a render every 4pt, not every frame —
      // and zero renders with the guide off.
      if (anchorGuide) {
        const q = Math.round(y / 4) * 4;
        setGuideAt((prev) => (prev === q ? prev : q));
      }
    },
    [scrollY, anchorGuide, noteResultsScroll]
  );

  /**
   * ▸ THE TOP EDGE ONLY EXISTS ONCE YOU HAVE SCROLLED.
   *
   * A permanent top gradient would sit over the board's own masthead and dim it at
   * rest, which is a fade solving a problem that is not there yet. Content only needs
   * dissolving once there is content passing under the edge. 24pt of travel is enough
   * to be fully on before anything has really moved.
   */
  const topEdgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 24], [0, 1], Extrapolation.CLAMP),
  }));

  /**
   * ▸ THE COLLAPSED HEADER'S GATE. 1 when the RECENT bar may show (the scroll still
   * decides whether it does), 0 for the whole cascade — Bryan's priority rule: "the
   * animation always takes priority... only after do we show the masthead." The gate
   * matters most with the anchor on, where the page is DEEP-scrolled during the rain
   * and the scroll condition alone would put the header over the falling cards.
   * Declared here, above the style that reads it — the worklet checker's rule.
   */
  const headGate = useSharedValue(1);
  /**
   * ▸ COMPOSE OWNS THE MASTHEAD TOO.
   *
   * ⚠ MY REGRESSION, from the morph increment. The masthead used to live INSIDE
   * RecentsBoard, so tapping the field unmounted it along with the tiles. Moving the
   * real glyphs to this screen-level overlay left them announcing "RECENT · 36
   * SEARCHES" over a blank compose screen you had already left (Bryan: "we still
   * showcase, for some reason, the Recent Masthead").
   *
   * Compose renames it rather than hiding it — a blank screen with a keyboard needs
   * one line of orientation, and the right-hand slot is worth more as the SCOPE of
   * what can be searched than as a count of a board you are no longer looking at.
   */
  /**
   * ▸ THE KEYBOARD IS LEAVING — a signal `keyboardUp` deliberately does not carry.
   *
   * `useSearch` hides on `keyboardDidHide` ON PURPOSE: dismissing with a query
   * promotes the list to the accordion, and firing on `will` would expand a 380pt
   * marquee out from under a finger still mid-drag. That reasoning is sound and is
   * left alone.
   *
   * It just does not apply to COMPOSE, where the screen is blank, there is no marquee
   * and no drag — only an empty page waiting to become the board. So this listener is
   * scoped to that one swap: the instant the keyboard starts down, the board is
   * allowed to mount and fade in alongside it. `keyboardWillHide` never fires on
   * Android, so there the behaviour is exactly what it is today.
   */
  const [kbLeaving, setKbLeaving] = useState(false);
  useEffect(() => {
    const leaving = Keyboard.addListener("keyboardWillHide", () => setKbLeaving(true));
    const gone = Keyboard.addListener("keyboardDidHide", () => setKbLeaving(false));
    const coming = Keyboard.addListener("keyboardWillShow", () => setKbLeaving(false));
    return () => {
      leaving.remove();
      gone.remove();
      coming.remove();
    };
  }, []);

  const composing = phase === "idle" && query.trim().length === 0 && keyboardUp && !kbLeaving;
  /** 0 while composing — the bar pose belongs to a scrolled board, and compose has no
   *  board to scroll. Keeps a mid-morph masthead from freezing over the keyboard. */
  const morphGate = useSharedValue(1);
  useEffect(() => {
    morphGate.value = withTiming(composing ? 0 : 1, {
      duration: 180,
      easing: Easing.out(Easing.sin),
    });
  }, [composing, morphGate]);
  /**
   * ▸ THE MASTHEAD MORPH — the entity pages' travel, literal.
   *
   * These texts live in a SCREEN-FIXED overlay, not in the scrolling content, and
   * that one fact decides the whole formula:
   *
   *   translateY = t · (bar − rest)  −  (1 − t) · scroll
   *
   * The first term is the travel. The second is what makes the start honest: at
   * t = 0 the text must ride the content it visually belongs to, so it moves UP by
   * exactly the scroll (`−s`), and that obligation fades out as the morph takes
   * over. At t = 1 the scroll term is gone entirely — pinned, permanently.
   *
   * ⚠ THE BUG THIS REPLACES: I wrote `t · (bar − rest + s)`, the pin trick for an
   * element INSIDE the scroll content, where `+s` cancels the scroll the parent is
   * applying. This overlay has no such parent, so nothing was cancelled and the
   * term was pure additive drift — the bar sank one point per point of scroll,
   * forever, straight past the nav pill (Bryan, device: "it just continues going
   * down... I can see it now rising from the bottom"). Same trick, wrong frame of
   * reference.
   *
   * Targets are CENTRE positions so scale-about-centre never bends the path.
   * Smoothstep inline rather than an Easing call — this runs as a worklet.
   * `headGate` gates everything: the cascade owns the top of the screen, and the
   * masthead's post-cascade fade-in (with its 10pt lift) now lives here too.
   */
  const morphTitleStyle = useAnimatedStyle(() => {
    const s = scrollY.value * morphGate.value;
    const p = interpolate(s, [0, MORPH_DISTANCE], [0, 1], Extrapolation.CLAMP);
    const t = p * p * (3 - 2 * p);
    return {
      opacity: headGate.value,
      transform: [
        {
          translateY:
            t * (BAR_TITLE_Y - REST_TITLE_CY) - (1 - t) * s + (1 - headGate.value) * 10,
        },
        { translateX: t * (winW / 2 - (SEARCH_LAYOUT.padH + morphTitleW / 2)) },
        { scale: 1 - t * (1 - BAR_TITLE_SIZE / 30) },
      ],
    };
  });
  const morphCountStyle = useAnimatedStyle(() => {
    const s = scrollY.value * morphGate.value;
    const p = interpolate(s, [0, MORPH_DISTANCE], [0, 1], Extrapolation.CLAMP);
    const t = p * p * (3 - 2 * p);
    return {
      opacity: headGate.value,
      transform: [
        {
          translateY:
            t * (BAR_TITLE_Y + BAR_GAP - REST_COUNT_CY) -
            (1 - t) * s +
            (1 - headGate.value) * 10,
        },
        { translateX: t * (winW / 2 - (winW - SEARCH_LAYOUT.padH - morphCountW / 2)) },
        { scale: 1 - t * (1 - BAR_COUNT_SIZE / 11) },
      ],
    };
  });

  /**
   * ▸ THE ARRIVAL AURORA — lit here rather than in the board, because it must not
   * scroll with the tiles it is lighting.
   *
   * `auroraOn` is the mount gate and `aurora` is the opacity; both are needed. Mounting
   * it only while a session is landing keeps a second BlurView off the screen for the
   * 99% of the time nothing is arriving — and it is safe to mount on demand precisely
   * because the band has a FIXED height, so it is never born at zero size (the one way
   * a BlurView fails to establish a backdrop at all). Its first frames are at opacity 0
   * regardless, which covers the moment the backdrop is still resolving.
   */
  const aurora = useSharedValue(0);
  const [auroraOn, setAuroraOn] = useState<number[] | null>(null);
  const auroraTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (auroraTimer.current && clearTimeout(auroraTimer.current)), []);
  /**
   * ▸ THE STATUS BAR STANDS ASIDE WITH THE MASTHEAD. Clock, battery and signal are
   * the one set of pixels the arrival cannot art-direct — hiding them makes the top
   * edge genuinely disappear while the light owns it, and they return on the same
   * beat the masthead does. Rendered as `hidden && isFocused`, so tabbing away
   * mid-cascade restores the bar instantly and returning mid-cascade re-hides it —
   * the declarative composition does what the haptics needed a fire-time check for.
   */
  const [statusHidden, setStatusHidden] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (statusTimer.current && clearTimeout(statusTimer.current)), []);

  /**
   * ▸ THE LANDING HAPTICS — one tap per tile, and the focus rule that matters.
   *
   * ⚠ FOCUS IS CHECKED WHEN THE TAP FIRES, NOT WHEN IT IS SCHEDULED. This screen
   * STAYS MOUNTED across tab switches (the reason the demo board needs an epoch
   * key), so "the board is still alive" is not "the user is looking at it". The
   * aurora gets away with this because an invisible light bothers nobody; a haptic
   * from another tab is a phone buzzing for no reason. Reading focus at fire time
   * also means leaving and returning mid-cascade resumes the taps in step with the
   * tiles still falling, which is the honest behaviour rather than a dead animation.
   *
   * ⚠ PREF AND FOCUS BOTH THROUGH REFS. `onArrival` is a prop the board holds in an
   * effect's dependency list — if its identity changed when the pref flipped, that
   * effect would tear down and restart a cascade already in flight.
   */
  const landHaptics = useBoolPref(PREF_LAND_HAPTICS, false);
  const hapticsRef = useRef(landHaptics);
  hapticsRef.current = landHaptics;
  const focusRef = useRef(isFocused);
  focusRef.current = isFocused;
  const lastTapAt = useRef(0);
  /** ⚠ IDENTITY-STABLE (empty deps, everything through refs). It is handed to every
   *  tile as a prop and captured in a worklet; a changing identity would churn sixty
   *  reactions mid-cascade.
   *
   *  The cue arrives carrying the tile's MASS (see LandWeight in RecentTile) and the
   *  style ladder is the whole fix for the continuous-burst feel: Light for bricks,
   *  Medium for portraits, Heavy for spans — different objects, not a metronome.
   *  Soft was the mistake: muffled and identical, thirty of them are one texture. */
  const onTileLand = useCallback((weight: LandWeight) => {
    if (!focusRef.current || !hapticsRef.current) return;
    const now = Date.now();
    // Spans always land — they are the cascade's punctuation, and dropping one
    // because a brick beat it by 60ms would invert the physics.
    if (weight !== "heavy" && now - lastTapAt.current < CUE_MIN_GAP) return;
    lastTapAt.current = now;
    const style =
      weight === "heavy"
        ? Haptics.ImpactFeedbackStyle.Heavy
        : weight === "medium"
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light;
    Haptics.impactAsync(style).catch(() => {});
  }, []);

  const onArrival = useCallback(
    (durationMs: number | null, beats?: number[]) => {
      if (auroraTimer.current) clearTimeout(auroraTimer.current);
      // `null` is the board leaving mid-cascade. Snuff it quickly rather than letting
      // the schedule run out over whatever replaced the board.
      if (durationMs === null) {
        aurora.value = withTiming(0, { duration: AURORA_CUT, easing: Easing.in(Easing.sin) });
        auroraTimer.current = setTimeout(() => setAuroraOn(null), AURORA_CUT + 60);
        // The board is gone; a stale anchor target must not yank whatever content
        // arrives next, and the header follows the ordinary rules again.
        pendingAnchor.current = null;
        headGate.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.sin) });
        if (statusTimer.current) clearTimeout(statusTimer.current);
        setStatusHidden(false);
        return;
      }
      // The system chrome leaves with the masthead and returns on the masthead's beat.
      if (statusTimer.current) clearTimeout(statusTimer.current);
      setStatusHidden(true);
      statusTimer.current = setTimeout(() => setStatusHidden(false), durationMs + 160);
      // Shut for the cascade, reopening only after the last tile has fully resolved —
      // the same beat the board's own in-flow masthead returns on.
      headGate.value = withSequence(
        withTiming(0, { duration: 120, easing: Easing.in(Easing.sin) }),
        withDelay(
          durationMs + 160,
          withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) })
        )
      );
      setAuroraOn(beats ?? []);
      // Up fast enough that the first tile is already falling THROUGH light, held for
      // the cascade, then a long dissolve — the band should leave more slowly than it
      // came, so the page settles rather than switching off.
      const hold = Math.max(0, durationMs - AURORA_IN - AURORA_OUT);
      aurora.value = withSequence(
        withTiming(1, { duration: AURORA_IN, easing: Easing.out(Easing.cubic) }),
        withDelay(hold, withTiming(0, { duration: AURORA_OUT, easing: Easing.inOut(Easing.sin) }))
      );
      auroraTimer.current = setTimeout(() => setAuroraOn(null), durationMs + 120);
    },
    [aurora, headGate]
  );
  const openEntity = useCallback(
    (
      entityType: SearchResult["entityType"],
      id: number,
      art?: {
        imagePath: string | null;
        title: string;
        rect?: MarqueeRect;
        remeasure?: MarqueeRemeasure;
      }
    ) => {
      // Opening ANY result is "I have chosen" — the keyboard leaves with the list.
      // Without this, tapping a row straight out of the typing state left the
      // keyboard floating over the destination page (Bryan's Ana de Armas
      // screenshot: entity page open, keyboard still up over the filmography).
      // A no-op when the keyboard is already down, which is every marquee path.
      Keyboard.dismiss();
      if (entityType === "movie" || entityType === "tv") {
        // Movie details stay a bottom sheet — it presents OVER whatever you were
        // on, including an entity page.
        router.push(`/movie/${id}`);
        return;
      }
      const kind = entityType;
      // Freeze the list FIRST — see onListScroll. Same offset, so nothing moves
      // visually; only the momentum dies.
      scrollRef.current?.scrollTo({ y: scrollOffset.current, animated: false });
      // START THE REQUESTS NOW, on the tap — the page reuses this exact promise, so
      // the fetch runs alongside the grow instead of after it.
      prefetchEntity(kind, id);
      // Entity pages get the nav back (Bryan, 2026-08-01): the field folds to a
      // disc and the tab pill unfolds, so every destination is one tap from a
      // reading surface. Same commit as the overlay request — one render carries
      // both, and the nav's spring runs on the UI thread alongside the grow.
      collapseIsland();
      openOverlay({
        kind,
        id,
        // Artwork and name let the hero paint on the FIRST frame.
        seed: art?.imagePath ? { imagePath: art.imagePath, name: art.title } : null,
        // The card's rect — what the page grows out of. Null for a text row or a
        // no-artwork panel: there is no card, so the page just appears.
        origin: art?.rect && art.imagePath ? art.rect : null,
        // And the way to re-ask for that rect FRESH. The tap-time snapshot goes stale
        // whenever the list is still settling around the tap; every animation start
        // re-measures through this instead of trusting the snapshot.
        remeasureOrigin: art?.rect && art.imagePath ? art.remeasure : undefined,
      });
    },
    [router, openOverlay, collapseIsland]
  );

  /** ▸ THE LEDGER'S TAP GUARD — one write per THING per search session (Bryan's
   *  rule, 2026-08-10: "within one search, every distinct thing you open counts
   *  once; nothing counts twice until it's a new search"). Keys are
   *  `${resultsQuery}|${kind}:${id}`; cleared with the door, so re-running the
   *  same search later counts fresh. */
  const countedTapsRef = useRef(new Set<string>());
  const onPickResult = useCallback(
    (r: SearchResult, rect?: MarqueeRect, remeasure?: MarqueeRemeasure) => {
      // NAVIGATE FIRST, RECORD LATER. `commit` writes SQLite and re-renders the whole
      // recents context — JS-thread work that used to land at the exact moment the
      // entity page was mounting and its grow was trying to start, which is variable
      // stall, which is inconsistent motion. 600ms clears the 340ms grow with margin;
      // when the ledger actually updates is invisible to the user.
      // Captured NOW, not read inside the timeout — see `commit`.
      const sessionId = sessionIdRef.current;
      // ▸ THE MOST-SEARCHED LEDGER WRITES HERE — on the CLICK, never on the guess
      // (Bryan, 2026-08-10). The old submit-time write recorded the ranker's #1:
      // he searched JURASSIC wanting the collection, and the ledger logged
      // Jurassic World Rebirth. A tap is the user announcing intent themselves,
      // so the tap is the write. Every route into content from a search — typing
      // rows, the hero's DETAILS, did-you-mean suggestions — lands here, and
      // nothing else does: recents tiles and ONE PICK are history, not search.
      // Guard checked NOW (synchronous, catches double-taps); the network
      // dispatch rides the same deferral as `commit`.
      const ledgerKey = `${resultsQuery}|${r.entityType}:${r.id}`;
      const countThis = !countedTapsRef.current.has(ledgerKey);
      if (countThis) countedTapsRef.current.add(ledgerKey);
      openEntity(r.entityType, r.id, { imagePath: r.imagePath, title: r.title, rect, remeasure });
      setTimeout(() => {
        commit(r, sessionId);
        if (countThis)
          void updateSearchCount(resultsQuery, {
            entityType: r.entityType,
            id: r.id,
            title: r.title,
            year: r.year,
            imagePath: r.imagePath,
          });
      }, 600);
    },
    [commit, openEntity, resultsQuery]
  );

  /**
   * ▸ THE ANCHOR'S SCROLL — trackers follow only the REAL scroll (onScroll is the
   * single source of truth; optimistic tracker writes were the dim-tiles bug), and
   * the target stays pending until confirmed, re-applied at every opportunity.
   *
   * ⚠ THIRD FIX, WITH EVIDENCE. The guide's readout came back `want 769.75 · at 0`
   * for every big session: the board computes the right target, this screen requests
   * it six times over 400ms — and the page never moves a single point. The ordinary
   * JS `scrollTo` command is being swallowed wholesale, which rhymes with this
   * repo's documented Expo Go SDK 54 scroll quirk (`useAnimatedScrollHandler` never
   * fires at all). So the anchor no longer trusts that pathway alone: every apply
   * dispatches BOTH ways — the ref command AND Reanimated's `scrollTo`, a UI-thread
   * command through a different native pipeline entirely.
   */
  const pendingAnchor = useRef<number | null>(null);
  const applyAnchor = useCallback(() => {
    const y = pendingAnchor.current;
    if (y === null) return;
    scrollRef.current?.scrollTo({ y, animated: false });
    runOnUI(() => {
      "worklet";
      uiScrollTo(scrollRef, 0, y, false);
    })();
  }, [scrollRef]);
  const onAnchorScroll = useCallback(
    (y: number) => {
      if (anchorGuide) setGuideTarget(Math.round(y));
      // The session rests naturally above the line — nothing to scroll.
      if (y <= 0) {
        pendingAnchor.current = null;
        return;
      }
      pendingAnchor.current = y;
      // PRIMARY: the prop (see anchorOffset). The command ladder stays as backup —
      // it costs nothing and covers a platform where commands work but props lag.
      setAnchorOffset((prev) => (prev === y ? y + 0.5 : y));
      applyAnchor();
      requestAnimationFrame(applyAnchor);
      [80, 200, 400].forEach((ms) => setTimeout(applyAnchor, ms));
    },
    [anchorGuide, applyAnchor]
  );
  const onContentSize = useCallback(
    (_w: number, h: number) => {
      // The readout's `max`: how deep the page can actually go. A target above it is
      // unreachable no matter which mechanism fires — old content too short for the
      // LIFT — and without this number that case is indistinguishable from a dead
      // scroll pipeline.
      if (anchorGuide) setGuideMax(Math.max(0, Math.round(h - winH)));
      if (pendingAnchor.current !== null) applyAnchor();
    },
    [applyAnchor, anchorGuide, winH]
  );
  /** The user grabbing the page outranks the anchor — never fight a finger. */
  const onDragStart = useCallback(() => {
    pendingAnchor.current = null;
  }, []);

  const onOpenRecent = useCallback(
    (r: RecentSearch, rect?: MarqueeRect, remeasure?: MarqueeRemeasure) =>
      openEntity(r.entity_type, r.entity_id, {
        imagePath: r.image_path,
        title: r.title,
        rect,
        remeasure,
      }),
    [openEntity]
  );

  /**
   * ▸ THE DOOR IS SHOWN WHENEVER A QUERY IS LIVE — every state, not just results.
   *
   * `query` arrives trimmed from useSearch, so this is the same test the body
   * routing uses to decide it is past compose. Deliberately NOT gated on
   * `submitted`: Bryan's 2026-08-02 ruling is that the header is the same object
   * either side of pressing Search, and a door that appeared only on submit would
   * shove the query down 26pt at the exact moment he asked nothing to change.
   * It also means the zero-results board and the error line get the way out —
   * the two states where being stuck costs the most.
   */
  const doorShown = query.length > 0;
  // One rescue check per result set — see THE EMPTY-TAB RESCUE below.
  const rescuedForRef = useRef("");

  /* ── THE RESULTS FILTER (increment 3) ──────────────────────────────────────
     `filterOn` is measured against the SEARCH defaults, which rest on RELEVANCE
     — so choosing RELEASE DATE counts as filtering here even though the same
     state is an entity page's resting order.

     ⚠ THE UNTOUCHED PATH IS `results` ITSELF, byte for byte. Bryan's ruling is
     that people, collections and studios drop "while the filter is on"; with no
     filter on, nothing is mapped, nothing is re-sorted, and the ranking that
     puts the film you meant at 01 is never even round-tripped. */
  /** Are any of the SHEET'S questions on — kind aside? Decides whether an empty
   *  list is the filters' fault (CLEAR FILTERS helps) or simply a pile with
   *  nothing in it for this query (the kind row is the way out). The old
   *  `filterOn` — a plain isDefault — died with ALL: the list is always gated
   *  now, and kind alone must never read as "filtered". */
  const filtersAsked = !isDefault(
    { ...resultsFilter, kind: SEARCH_FILTER_DEFAULTS.kind },
    SEARCH_FILTER_DEFAULTS
  );
  /** The film and show rows as filterable films — also what the sheet counts,
   *  and what its decade row and genre tiles are derived from. */
  const resultFilmRows = useMemo(() => resultFilms(results), [results]);
  /**
   * ▸ THE FILTER'S OPTIONS COME FROM THE ROWS ITS KIND WILL ACTUALLY FILTER.
   *
   * Not from `resultFilmRows`, which is the film-and-show slice: on PEOPLE that would
   * offer the genres of whatever unrelated films happened to be in the same result
   * set, and on a query returning no films it would offer nothing at all. Gated by
   * the APPLIED kind rather than the draft, so opening the sheet cannot change the
   * options out from under the picks already on it.
   */
  const kindRows = useMemo(
    () => gateByKind(results, resultsFilter.kind),
    [results, resultsFilter.kind]
  );
  const genreOptions = useMemo(() => genresIn(kindRows), [kindRows]);
  const decadeOptions = useMemo(() => decadesInRows(kindRows), [kindRows]);
  const countryOptions = useMemo(() => countriesIn(kindRows), [kindRows]);

  /**
   * ▸ CHANGING KIND IS NAVIGATION, so it writes the APPLIED filter directly — there
   * is no draft to commit and no APPLY to press. `withKind` carries the guard: a sort
   * the new kind cannot answer snaps back to RELEVANCE rather than ordering the list
   * by a field none of its rows has.
   */
  // The context exposes a plain setter, not a React updater, so the current filter
  // is read from scope rather than from `prev`.
  const setKind = useCallback(
    (k: KindKey) => setResultsFilter(withKind(resultsFilter, k)),
    [setResultsFilter, resultsFilter]
  );
  /**
   * How many rows of each kind we HAVE — not how many exist. `/search/multi` returns
   * one combined total for films, shows and people, so a true per-kind total would
   * cost two extra requests per query (3 → 5) and has never been approved. Counting
   * the rows in hand is honest about being a count of what is on screen.
   */
  const kindCounts = useMemo(() => {
    const c: Partial<Record<KindKey, number>> = { any: results.length };
    for (const k of ["film", "shows", "person", "studio", "collection"] as const) {
      c[k] = gateByKind(results, k).length;
    }
    return c;
  }, [results]);
  const shownResults = useMemo(
    // ⚠ ALWAYS GATED NOW — the untouched-path ruling ("with no filter on, results
    // byte for byte") belonged to the ALL era, when the resting kind WAS the whole
    // mixed list. The resting kind is FILMS, so the gate must run from the first
    // keystroke or the row would say FILMS over a list still full of people.
    // Kind-only gating is pass ① alone: a filter() by entityType, no mapping and
    // no re-sort, so the ranking inside the pile still arrives untouched.
    () => filterResults(results, resultsFilter),
    [resultsFilter, results]
  );
  /**
   * What the sheet's header counts — the SAME function that builds the list, so
   * the number and the rows can never be two different claims. It takes the
   * sheet's DRAFT, which is why the sheet asks for it rather than being handed a
   * number: the page is still showing the applied filter while you are still
   * deciding on another.
   */
  const countResults = useCallback(
    (draft: FilterState) => filterResults(results, draft).length,
    [results]
  );

  /**
   * A filter belongs to the search it was set on, so ending the search ends it.
   * Watching the query go empty catches every route out at once — the door, the
   * ✕ in the field, the swipe, the zero-results CTA — rather than making each
   * one remember. (Leaving for another tab is the one route this cannot see,
   * because the screen goes with it; `close()` handles that.)
   */
  useEffect(() => {
    // BOTH directions: the sink's directional memory belongs to one surface's
    // session. The recents board rides this same ScrollView, and a body swap
    // moves the offset WITHOUT a scroll event — a stale last-y reads the next
    // gesture backwards (a down-scroll counted as up until y catches up with
    // the other surface's offset: the "sometimes it doesn't sink" half of
    // Bryan's consistency gripe, 2026-08-10). Feeding 0 lands in the top zone:
    // accumulators cleared, bar out, memory rebased.
    noteResultsScroll(0);
    if (!doorShown) {
      setResultsFilter(SEARCH_FILTER_DEFAULTS);
      rescuedForRef.current = "";
      // A fresh search session counts fresh — see THE LEDGER'S TAP GUARD.
      countedTapsRef.current.clear();
    }
  }, [doorShown, setResultsFilter, noteResultsScroll]);

  /**
   * ▸ THE EMPTY-TAB RESCUE (Bryan, 2026-08-09) — FILMS is the resting kind, and
   * the row only ever moves itself to ESCAPE EMPTINESS, never to guess intent.
   *
   * The top-result landing is DEAD, both cuts (submit-time, then live): "adding
   * more unseeded noise." The ranking does not drive navigation. What stands is
   * his ruling, near verbatim:
   *   · FILMS is the default.
   *   · If the tab has no match for this query, switch to the first tab in row
   *     order that does.
   *   · If NO tab has a match, that is the ZERO RESULTS board (phase "empty" in
   *     the routing below) — the kind row steps aside and DID YOU MEAN offers a
   *     way out, whichever tab you came from.
   *
   * ONE CHECK PER RESULT SET (`rescuedForRef`, keyed by resultsQuery — the
   * stamp on the rows in hand, never the keystroke ahead of them): the rescue
   * answers to new rows arriving under the current tab, not to navigation.
   * Deliberately tapping a dim tab must show that tab's empty state — "the
   * brighter tabs have the rest" — not bounce you straight back out. The ref
   * clears with the door (above).
   *
   * `gateByKind` is the SAME gate the list renders through, so "has a match"
   * here and rows on screen can never be two different claims.
   *
   * ⚠ THE REFUGE POOL IS `ROW_KINDS` — the tabs the row actually offers — NOT
   * `SEARCH_KIND_CYCLE`, whose first entry is "any". "any" gates nothing, so it
   * is never empty while results exist, and the first cut of this rescue always
   * fled there: the deleted ALL back from the dead — mixed piles under a row
   * with no chosen tab, masthead counting the whole set (Bryan's CHRIS P /
   * TOM HO screenshots, 2026-08-09). Sharing KindRow's own list makes "a tab
   * that exists" and "a tab the rescue can pick" one claim.
   */
  useEffect(() => {
    if (!doorShown || phase !== "results") return;
    if (rescuedForRef.current === resultsQuery) return;
    rescuedForRef.current = resultsQuery;
    if (gateByKind(results, resultsFilter.kind).length > 0) return;
    const refuge = ROW_KINDS.find((k) => gateByKind(results, k).length > 0);
    if (refuge) setResultsFilter(withKind(resultsFilter, refuge));
    // `results`/`resultsFilter` read from scope, ref-guarded — the effect answers
    // to the result set changing, not to every rows refresh or kind tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorShown, phase, resultsQuery]);

  /**
   * ▸ RULING A: THE DOOR CLEARS. Query gone, results gone, the board as if you had
   * never searched.
   *
   * Two lines, and the ORDER matters. `Keyboard.dismiss()` first so the nav's fold
   * and the board's return ride one keyboard descent; emptying the query first
   * would drop `hasQuery` while the keyboard was still up, and the bar would
   * unfold a field nobody asked for on the way past.
   *
   * ⚠ NOT `useSearch`'s `clear()`, which exists for the zero-results CTA and
   * deliberately RAISES the keyboard again ("clear and try again" is one act).
   * This is the opposite intent — you are leaving to look at the board — so it
   * shares the wipe and nothing else.
   */
  const goRecent = useCallback(() => {
    Keyboard.dismiss();
    setQuery("");
  }, [setQuery]);

  /**
   * ▸ THE SECOND DOOR (ruling D). No drag preview: unlike the entity page there is
   * no card to fold into and nothing to pull, so the gesture is a decision, not a
   * manipulation — past the threshold or fast enough, the search ends.
   *
   * ⚠ THE AXIS GUARDS ARE THE SAFETY, and they are copied deliberately: a
   * rightward intent of 12pt to activate, 16pt of vertical travel to fail it
   * outright. That is what stops a vertical list and a sideways exit competing
   * for the same touch — the lesson EntityScreen's EDGE_STRIP_W comment records.
   * Disabled while an entity page is up so its OWN back-swipe (a descendant
   * handler with identical thresholds) never has to race this one.
   */
  const backSwipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(doorShown && !overlayOpen)
        .activeOffsetX(12)
        .failOffsetY([-16, 16])
        .onEnd((e) => {
          if (
            e.translationX > winW * SWIPE_BACK_FRACTION ||
            e.velocityX > SWIPE_BACK_VELOCITY
          ) {
            runOnJS(goRecent)();
          }
        }),
    [doorShown, overlayOpen, winW, goRecent]
  );

  // ── State routing ──────────────────────────────────────────────────────────
  const body = (() => {
    if (phase === "error") {
      return <Text style={styles.message}>{error ?? "Search failed."}</Text>;
    }

    if (phase === "empty") {
      return (
        <Animated.View exiting={LIST_EXIT}>
          <ZeroResults
            query={query}
            suggestions={suggestions}
            entryIds={entryIds}
            onClear={clear}
            onPickSuggestion={onPickResult}
          />
        </Animated.View>
      );
    }

    /**
     * ⚠ `phase` LAGS THE QUERY BY ONE FRAME, so it cannot gate this alone.
     *
     * `useSearch` moves idle → debouncing from an EFFECT, which runs after the render
     * that carried the new query. So the first keystroke renders with the new `query`
     * and the stale `"idle"` phase — one frame of blank compose with text already in
     * the field, which reads as a black flash (Bryan, device, 2026-08-02).
     *
     * Reading the query directly closes that gap: the moment there is text, this
     * whole branch is skipped and the render falls through to the typing ladder's
     * skeletons. It also covers the query that is only whitespace, which trims to
     * empty and would otherwise sit in compose with a visibly non-empty field.
     */
    const typing = query.trim().length > 0;

    if (phase === "idle" && !typing) {
      // COMPOSE — the field has focus, nothing typed. Renders nothing at all, so the
      // recents surface is not sitting behind the keyboard. See ComposeState; this is
      // a branch in the existing phase, not a route.
      //
      // `composing` rather than `keyboardUp`: it drops the moment the keyboard STARTS
      // leaving, so the board mounts and fades in over the descent instead of after
      // it. See the note on `kbLeaving`.
      if (composing) return <ComposeState />;
      // A fresh account has no recents AND no takes, so there is no honest ONE PICK
      // and no ledger — it gets the board that teaches the loop instead.
      if (recents.length === 0) return <EmptyState />;
      // A/B against the ledger while the board is being built — see PREF_BENTO_RECENTS.
      if (bentoRecents) {
        return (
          // The wrapper carries the dissolve, NOT the board — the board's own mount is
          // what starts an arrival, and it must keep remounting on `demoEpoch` exactly
          // as before. A plain animated view at the same position leaves `boardTop`
          // and every tile's screen maths untouched.
          <Animated.View entering={BOARD_IN} exiting={BOARD_OUT}>
            <RecentsBoard
              // The demo epoch forces a REMOUNT per seeded session: the tab screen
              // stays alive across tab switches, and the arrival machinery is
              // mount-time by design. 0 forever in normal use.
              key={demoEpoch}
              recents={recents}
              scrollY={scrollY}
              onArrival={onArrival}
              onAnchor={onAnchorScroll}
              onOpenEntity={onOpenRecent}
              onTileLand={onTileLand}
            />
          </Animated.View>
        );
      }
      return (
        <DefaultState
          recents={recents}
          entryIds={entryIds}
          openIndex={recentsOpenIndex}
          onOpenIndexChange={setRecentsOpenIndex}
          onOpenEntity={onOpenRecent}
          onOpenPick={(id) => router.push(`/movie/${id}`)}
        />
      );
    }

    /* ── THE MASTHEAD COUNT SPEAKS THE KIND'S OWN LANGUAGE (the board's `847
       FILMS`). With ALL gone there is always a pile: the count is that pile from
       the rows in hand, and with a filter on it is what SURVIVED — the same rule
       ruling B-i applies inside the sheet. */
    const mastheadCount = filtersAsked
      ? shownResults.length
      : kindCounts[resultsFilter.kind] ?? null;
    const mastheadUnit = KIND_UNIT[resultsFilter.kind];

    /* ── FILTERED TO NOTHING IS A STATE, NOT A DEAD END (Bryan, 2026-08-08). ────
       The old branch condition (`shownResults.length > 0`) unmounted the ENTIRE
       submitted state when a filter emptied the list — masthead, kind row and all —
       which is why it felt like being stuck: the controls that could free you left
       the screen with the rows. The chrome stays now; only the list is empty, the
       message says exactly whose fault that is, and the one button undoes it. */
    if (submitted && resultsMatchQuery && results.length > 0 && shownResults.length === 0) {
      // Two different truths share this geometry, and conflating them offered a
      // CLEAR FILTERS button that did nothing: with no sheet questions on, the
      // pile is simply empty for this query, and the kind row is the way out.
      return (
        <Animated.View exiting={LIST_EXIT}>
          <QueryEcho query={query} count={0} unit={mastheadUnit} />
          <KindRow value={resultsFilter.kind} onChange={setKind} counts={kindCounts} />
          <View style={styles.filteredEmpty}>
            <Text style={styles.filteredEmptyTitle}>
              {filtersAsked
                ? "NOTHING SURVIVES THESE FILTERS"
                : `NO ${KIND_ROW_LABEL[resultsFilter.kind]} FOR THIS SEARCH`}
            </Text>
            <Text style={styles.filteredEmptyBody}>
              {filtersAsked
                ? "The results are still here — the filters are hiding all of them. Loosen one, or clear the lot."
                : "The brighter tabs above are the piles that do have something."}
            </Text>
            {filtersAsked && (
              <Pressable
                onPress={() =>
                  setResultsFilter({ ...SEARCH_FILTER_DEFAULTS, kind: resultsFilter.kind })
                }
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
                style={styles.filteredEmptyClear}
              >
                <Text style={styles.filteredEmptyClearText}>CLEAR FILTERS</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      );
    }

    if (submitted && shownResults.length > 0 && resultsMatchQuery) {
      return (
        <Animated.View exiting={LIST_EXIT}>
          <SubmittedState
            query={query}
            total={mastheadCount ?? 0}
            unit={mastheadUnit}
            results={shownResults}
            entryIds={entryIds}
            keyboardUp={keyboardUp}
            onOpen={onPickResult}
            kind={resultsFilter.kind}
            onKind={setKind}
            kindCounts={kindCounts}
          />
        </Animated.View>
      );
    }

    // Typing: text-only rows, by design. Every non-empty query searches now (the
    // 4-character floor is gone — see services/search.ts), so an empty list here
    // only ever means a request is pending: skeletons at the real row geometry,
    // never a spinner, so nothing moves when the results land.
    /**
     * THE MASTHEAD IS THE SAME OBJECT EITHER SIDE OF SUBMITTING (Bryan, 2026-08-02).
     *
     * Typing used to head itself `MATCHING RECORDS · 10,406 FOUND` and submitting
     * swapped that for `MARK · 10,406 MATCHES` — a different masthead for the same
     * data, so pressing Search appeared to change more than it did. Now the query is
     * on screen from the first keystroke and submitting only changes the list.
     *
     * The count is withheld unless it belongs to the LIVE query: rows are deliberately
     * held across a re-fetch so the list does not blank on every keystroke, which means
     * `total` can be one query behind. See `resultsMatchQuery`.
     */
    // The pile's own number, never TMDB's combined total — with ALL gone the
    // masthead always describes the kind on screen. Still withheld while the rows
    // are a keystroke behind; a count that belongs to the previous query is worse
    // than none.
    const echoCount = resultsMatchQuery ? shownResults.length : null;

    // Nothing has come back yet — a FETCH state, not a filter one, so it is
    // asked before the filter gets a say. Skeletons at the real row geometry.
    if (results.length === 0) {
      // Header first, skeletons under it — so it is already in place when the rows
      // land and nothing shifts as they replace the placeholders.
      return (
        <Animated.View exiting={LIST_EXIT}>
          <QueryEcho query={query} count={echoCount} />
          <SkeletonRows />
        </Animated.View>
      );
    }
    /* The search found things and the FILTER removed all of them — reachable
       only with a filter on, since otherwise `shownResults` IS `results` and we
       have already established it is non-empty. Deliberately NOT the ZERO
       RESULTS board: that one apologises for the search and offers "did you
       mean", and neither is true here. The search worked; the filter is simply
       narrower than the shelf. Saying so and leaving the filter where it is
       keeps the fix one tap away in the pill the user just used. */
    if (shownResults.length === 0) {
      return (
        <Animated.View exiting={LIST_EXIT}>
          <QueryEcho query={query} count={echoCount} unit={mastheadUnit} />
          {/* The row stays through the empty state — hopping to a kind that HAS
              rows is the fastest way out, and the dim tabs already say which
              those are. */}
          <KindRow value={resultsFilter.kind} onChange={setKind} counts={kindCounts} />
          {/* Same split as the submitted empty state: blame the filters only when
              filters are actually on. */}
          <Text style={styles.message}>
            {filtersAsked
              ? "Nothing matches this filter."
              : `No ${KIND_ROW_LABEL[resultsFilter.kind].toLowerCase()} here — the brighter tabs have the rest.`}
          </Text>
        </Animated.View>
      );
    }

    return (
      <Animated.View exiting={LIST_EXIT}>
        <QueryEcho query={query} count={echoCount} unit={mastheadUnit} />
        {/* ▸ THE KIND ROW IS ON THE TYPING LADDER TOO (Bryan, 2026-08-08: "in this
            state we should allow the user to see the top tabs and choose"). The
            list under it has ALWAYS narrowed by kind — it renders `shownResults` —
            so this is the control catching up with the behaviour: pick PEOPLE
            mid-word and the ladder narrows on the next keystroke, no submit
            needed. Taps land with the keyboard up via keyboardShouldPersistTaps. */}
        <KindRow value={resultsFilter.kind} onChange={setKind} counts={kindCounts} />
        {shownResults.map((r, i) => (
          <ResultRow
            key={`${r.entityType}-${r.id}`}
            result={r}
            index={i + 1}
            query={query}
            hasEntry={r.entityType === "movie" && entryIds.has(r.id)}
            isLast={i === shownResults.length - 1}
            onPress={onPickResult}
          />
        ))}
      </Animated.View>
    );
  })();

  return (
    <View style={styles.screen}>
      {/* Only `hidden` is asserted here — the app's status bar STYLE stays whatever
          the root set; React Native stacks StatusBar props per-prop. */}
      <StatusBar
        hidden={statusHidden && isFocused}
        animated
        hideTransitionAnimation="fade"
      />
      {/* ▸ THE SWIPE IS SCOPED TO THE LIST, not to the screen. Everything outside
          it is `pointerEvents="none"` chrome (the glass, the masthead) or the
          entity host, so the list IS the swipeable surface — and keeping the
          detector off the root means the entity page mounted beside it never
          sits inside this gesture's tree at all. */}
      <GestureDetector gesture={backSwipe}>
      <Animated.ScrollView
        ref={scrollRef}
        contentOffset={{ x: 0, y: anchorOffset }}
        onScroll={onListScroll}
        onScrollBeginDrag={onDragStart}
        onContentSizeChange={onContentSize}
        scrollEventThrottle={16}
        // The door is absolutely placed in the screen layer, so the content has to
        // OWE it the room — one padding rule, applied by the same constant that
        // positions the door, so every query-bearing state reserves it without
        // knowing the door exists.
        contentContainerStyle={[styles.content, doorShown && styles.contentWithDoor]}
        // Dragging the list puts the keyboard away. Reaching for a chevron in the
        // corner every time you want to read your own results is friction nobody
        // asked for — scrolling already means "I am done typing, let me look".
        //
        // Deliberately does NOT promote to the submitted state: that auto-expands a
        // 380px marquee at the top of the list, and doing it while a finger is
        // mid-drag would yank the content out from under it. Dropping the keyboard
        // is "let me look", not "I have chosen" — those stay different acts.
        keyboardDismissMode="on-drag"
        // Anchors what you are LOOKING AT while the list reflows above you.
        // Promoting to the accordion grows the top row from 62px to ~380px, which
        // shoves everything below it down by ~330px — so scrolling to row 07 and
        // having the keyboard finish hiding would make row 07 leap down the screen.
        // With this, the offset compensates and the rows under your eyes stay put.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        // Keeps row taps working while the keyboard is still up, so you can pick a
        // result without a dismiss-then-tap two-step.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {body}
        {/* The floating nav overlays the page, so the last row needs real space
            beneath it rather than trusting the nav to be transparent. */}
        <View style={{ height: NAV_CLEARANCE }} />
      </Animated.ScrollView>
      </GestureDetector>

      {/* ▸ THE TOP EDGE — a real blur behind an alpha matte, the same construction as
          the entity hero's collapsed bar (see FadeMask in EntityHero).

          A MaskedView whose mask is solid across the status-bar band and then ramps to
          transparent, wrapping a fixed-intensity BlurView and a ground tint. Both the
          blur and the tint dissolve together, so there is no visible edge where the
          treatment stops — which is the whole reason the mask exists rather than just
          stacking a gradient over a blur.

          ⚠ FIXED SIZE, MOUNTED ONCE. A BlurView born at zero size never establishes a
          backdrop, and resizing one re-samples every frame. This band's height is a
          constant and only its OPACITY animates. It is also never inside a transformed
          parent — that is the iOS bright-frosted-panel hazard the hero gates on
          `settled` to avoid.

          ⚠ Fixed intensity, opacity-animated. Interpolating a blur RADIUS is
          expensive and janky; the hero carries the same note. */}
      <Animated.View style={[styles.edge, styles.topEdge, topEdgeStyle]} pointerEvents="none">
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <View style={StyleSheet.absoluteFill}>
              <View style={styles.maskSolid} />
              <LinearGradient colors={["#000", "transparent"]} style={styles.maskFade} />
            </View>
          }
        >
          <BlurView
            intensity={22}
            tint="systemUltraThinMaterialDark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          {/* The blur alone leaves bright artwork bright. The tint is what makes the
              band read as the page's own ground closing over the content. */}
          <LinearGradient
            colors={[groundAlpha(0.22), groundAlpha(0.4), groundAlpha(0)]}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      </Animated.View>
      {/* The morphing masthead — the REAL glyphs (the board's in-flow copy is
          layout-only). Over the glass so the text is never blurred by its own bar,
          under the light. Mounted only while the board is the body — it must never
          hover over search results. */}
      {bentoRecents && phase === "idle" && query.trim().length === 0 && (
        <View style={styles.morphHead} pointerEvents="none">
          <Animated.Text
            onLayout={(e) => setMorphTitleW(e.nativeEvent.layout.width)}
            style={[styles.morphTitle, morphTitleStyle]}
          >
            {composing ? "SEARCH" : "RECENT"}
          </Animated.Text>
          <Animated.Text
            onLayout={(e) => setMorphCountW(e.nativeEvent.layout.width)}
            style={[styles.morphCount, morphCountStyle]}
          >
            {/* ▸ EMPTY WHILE COMPOSING — the FILMS · PEOPLE · STUDIOS caption died
                with QUICK SEARCHES (Bryan, 2026-08-08: the compose air belongs to
                the cards now). The NODE stays: the morph measures this text, and
                while composing morphGate is 0 so the zero width is never read. */}
            {composing
              ? ""
              : `${recents.length} ${recents.length === 1 ? "SEARCH" : "SEARCHES"}`}
          </Animated.Text>
        </View>
      )}
      {/* ▸ QUICK SEARCHES — trending cards in compose's dead air (the Q3 board,
          CHOSEN 2026-08-08). Screen layer, not ScrollView: they anchor above the
          island, which lives in screen space riding the keyboard. Drawn BEFORE the
          entity host and the nav, so an open page or the island always covers
          them. A tap is the Search key's exact gesture with the title pre-typed —
          same setQuery the input writes, same dismiss, same submitQuery. */}
      {composing && (
        <QuickSearches
          onPick={(title) => {
            setQuery(title);
            Keyboard.dismiss();
            submitQuery();
          }}
        />
      )}
      {/* ▸ THE DOOR BACK TO RECENT. In the SCREEN layer for one reason: a header
          that scrolls away takes the way out with it, and ruling ⑤ says the door
          stays. Drawn after the glass so it is never blurred by its own band, and
          before the entity host so an open page covers it like everything else.
          Unlike the masthead beside it, this one is NOT `pointerEvents="none"` —
          it is the only live control on this layer. */}
      {doorShown && <BackToRecent onPress={goRecent} />}
      {/* The anchor guide's LIFT line — fixed in SCREEN space (the board's PREV
          SKYLINE line scrolls with content; anchored correctly, the two meet).
          Dash Views, not a dashed border — see the note in RecentsBoard. */}
      {anchorGuide && (
        <View
          pointerEvents="none"
          style={[styles.guideLine, { top: winH - ANCHOR_LIFT }]}
        >
          <View style={styles.guideDashRow}>
            {Array.from({ length: 22 }, (_, i) => (
              <View key={i} style={styles.guideDash} />
            ))}
          </View>
          {/* `scroll 0` on a small session is SUCCESS: the lift line is a limit the
              old row may not sink past, and a session resting above it needs nothing. */}
          <Text style={styles.guideLabel}>
            LIFT {ANCHOR_LIFT} · scroll {guideTarget ?? "—"} · max {guideMax ?? "—"} · at{" "}
            {guideAt}
          </Text>
        </View>
      )}
      {/* ▸ THE ARRIVAL AURORA, above the resting top edge and below the nav.
          Mounted only while a session is landing — at rest the ordinary top edge is
          the only treatment up there, and during an arrival `scrollY` is 0 so that one
          is at zero opacity anyway. The two never fight over the same band. */}
      {auroraOn !== null && <ArrivalAurora on={aurora} beats={auroraOn} />}

      {/* The bottom is always on: the nav pill floats there, and content sliding
          under it should dissolve rather than slide behind a hard edge. It is also
          where the board pushes tiles DOWN as new searches land — churn that is
          better felt than watched. */}
      <View style={[styles.edge, styles.bottomEdge]} pointerEvents="none">
        <LinearGradient
          colors={[groundAlpha(0), groundAlpha(0.8), groundAlpha(1)]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* The entity pages, ABOVE the list and BELOW the nav pill — the pill is
          rendered by the tab navigator after all screen content, so it outranks
          this by construction. Living inside the screen is also what keeps an open
          page alive across tab switches. See EntityOverlayContext. */}
      <EntityOverlayHost onClose={foldClosed} onFoldStart={openIsland} />

      {/* The FILTER sheet, mounted beside the page it filters and ABOVE it —
          it grows out of the nav's pill, which is why the bar stands aside for
          it (see the nav's navHidden).

          ▸ MOUNTED FOR THE WHOLE LIFE OF THE PAGE, not just while it is open.
          It used to mount on the tap, which meant the tap paid for building the
          entire instrument — and that build sat right in the gap between the
          bubble landing and the first row appearing, which is the delay Bryan
          could feel and could not place. Mounted with the page, it builds itself
          once during an idle moment (see ARMED in the sheet) and a tap costs a
          timing and nothing else. It renders nothing and takes no touches while
          closed. `filterOpen` is now purely "is it showing". */}
      {/* ▸ ONE SHEET AT A TIME, AND THE SURFACE PICKS WHICH. The nav's pill only
          raises `filterOpen`; what that flag mounts is decided here, and the two
          conditions are mutually exclusive so the sheet's rect is never claimed
          twice. Each stays MOUNTED for the life of its surface, because a sheet
          that unmounts before its collapse ends has no collapse. */}
      {overlayOpen && <FilterSheet open={filterOpen} onClose={closeFilter} />}
      {/* ⚠ MOUNTED ONLY ONCE THE SEARCH HAS SETTLED — i.e. exactly when the pill
          that opens it exists. The sheet builds its whole instrument shortly
          after mounting (see ARMED), and mounting it on the first keystroke
          would pay for six sections and a genre grid during typing, for a
          control that is a zero-width pill until the keyboard goes down and
          cannot be tapped anyway. `!keyboardUp` is the screen's own reading of
          the same event the nav folds on. */}
      {!overlayOpen && doorShown && !keyboardUp && (
        <FilterSheet
          open={filterOpen}
          onClose={closeFilter}
          rows={resultFilmRows}
          applied={resultsFilter}
          onApply={setResultsFilter}
          // This surface rests on RELEVANCE and can cycle back to it; an entity
          // page has no ranking, so it never sees the option.
          defaults={SEARCH_FILTER_DEFAULTS}
          sortCycle={SEARCH_SORT_CYCLE}
          // Six stops, not three: a result set is mixed, so the question worth
          // asking of it is what KIND of thing, not what format of film.
          kindCycle={SEARCH_KIND_CYCLE}
          kindLabel="KIND"
          // Composed per kind (constants/filterBands.ts). Omitting this would give
          // the results sheet the ENTITY page's composition, which pairs STATUS with
          // a KIND cycle this surface no longer owns — kind is navigation here.
          bands={BANDS_FOR[resultsFilter.kind]}
          // The kind row's own word, so the sheet and the row that opened it can
          // never disagree about what pile is being narrowed.
          subtitle={KIND_ROW_LABEL[resultsFilter.kind]}
          genreOptions={genreOptions}
          decadeOptions={decadeOptions}
          countryOptions={countryOptions}
          countFor={countResults}
          // Ruling B-i: no total in the top right — the slot is empty until a
          // filter is on, then prints only what survived.
          showTotal={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /* ── The filtered-to-nothing state. Quiet, not alarmed: the results are fine,
     the filters are strict, and the one verb on screen is the way out. */
  filteredEmpty: { paddingTop: 48, alignItems: "center", gap: 12 },
  filteredEmptyTitle: {
    color: SIGNAL.ink,
    fontFamily: FONT.monoMedium,
    fontSize: 12,
    letterSpacing: 1.44,
  },
  filteredEmptyBody: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 17,
    letterSpacing: 0.4,
    textAlign: "center",
    maxWidth: 300,
  },
  filteredEmptyClear: {
    marginTop: 10,
    height: 46,
    paddingHorizontal: 28,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#9CCADF80",
    alignItems: "center",
    justifyContent: "center",
  },
  filteredEmptyClearText: {
    color: SIGNAL.accent,
    fontFamily: FONT.monoMedium,
    fontSize: 11,
    letterSpacing: 1.32,
  },
  screen: { flex: 1, backgroundColor: SIGNAL.ground },
  content: {
    paddingHorizontal: SEARCH_LAYOUT.padH,
    paddingTop: SEARCH_LAYOUT.contentTop,
  },
  /** The room the door occupies, owed back to the content beneath it. Board C's
   *  header is door row (14) + gap (12) above the query — see DOOR_BLOCK. */
  contentWithDoor: { paddingTop: SEARCH_LAYOUT.contentTop + DOOR_BLOCK },
  // Edge treatment. OUTSIDE the ScrollView, so they never scroll with the content
  // they are dissolving. Same ground colour at every stop — this is a luminance
  // ramp, not a tint.
  edge: { position: "absolute", left: 0, right: 0 },
  topEdge: { top: 0, height: SEARCH_LAYOUT.topEdge },
  /** The morphing masthead. The texts are styled EXACTLY like the board's in-flow
   *  masthead (30px display title, 11px mono count) and placed at its exact resting
   *  spots — the collapse is transform-only, so the type never re-rasterises
   *  mid-travel. Sizes at the bar come from BAR_TITLE_SIZE / BAR_COUNT_SIZE as
   *  scale factors. */
  morphHead: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: SEARCH_LAYOUT.contentTop + 72,
  },
  morphTitle: {
    position: "absolute",
    left: SEARCH_LAYOUT.padH,
    top: SEARCH_LAYOUT.contentTop,
    color: SIGNAL.ink,
    fontFamily: FONT.display,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: -0.9, // -0.03em at 30px — the masthead's own tracking
  },
  morphCount: {
    position: "absolute",
    right: SEARCH_LAYOUT.padH,
    top: SEARCH_LAYOUT.contentTop + 14,
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
  // ── The anchor guide (dev instrument, PREF_ANCHOR_GUIDE) ─────────────────────
  guideLine: { position: "absolute", left: 0, right: 0 },
  guideDashRow: { flexDirection: "row", gap: 6 },
  guideDash: { width: 8, height: 1.5, backgroundColor: "#FF5A3C" },
  guideLabel: {
    color: "#FF5A3C",
    fontFamily: FONT.mono,
    fontSize: 8,
    letterSpacing: 1,
    marginTop: 3,
    marginLeft: 12,
  },
  // Solid across the status bar, then a ramp. A FIXED band rather than a percentage,
  // so the softness is identical whatever the height becomes — same rule as BAR_FADE.
  // Both numbers live in SEARCH_LAYOUT because the recents board fades its tiles out
  // against this band and has to be reading the same geometry.
  maskSolid: { height: SEARCH_LAYOUT.topEdgeSolid, backgroundColor: "#000" },
  maskFade: { flex: 1 },
  /**
   * The bottom stays a plain ramp, deliberately.
   *
   * The nav pill floating there is ALREADY a BlurView, and it sits above this in the
   * z-order — a second blur underneath means the pill's glass samples frosted glass,
   * which reads muddy and pays for the same effect twice. The ramp does the job the
   * bottom edge actually has: making the churn illegible while the board pushes tiles
   * down out of view.
   */
  bottomEdge: { bottom: 0, height: 122 },
  message: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 18,
    letterSpacing: TRACK.micro11,
    textAlign: "center",
    marginTop: 40,
    paddingHorizontal: 24,
  },
});
