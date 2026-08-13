import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  BioReader,
  EntityBackdrop,
  EntityBar,
  EntityIdentity,
  heroOpenHeight,
  nameType,
  type EntitySection,
} from "./EntityHero";
import FilmRow from "./FilmRow";
import { ChevronLeft } from "../search/glyphs";
import Marquee, { accordionMotion, ctaFor } from "../search/Marquee";
import NoArtworkPanel from "../search/NoArtworkPanel";
import SkeletonRows from "../search/SkeletonRows";
import SectionHeader from "../search/SectionHeader";
import { useExpandedFilm } from "@/hooks/useExpandedFilm";
import { NAV_BAR_H, NAV_BOTTOM } from "@/constants/navMetrics";
import { FONT, ROW, SEARCH_LAYOUT, SIGNAL, TRACK } from "@/constants/signal";
import { useBoolPref } from "@/hooks/useBoolPref";
import { FILTER_DEFAULTS, isDefault, type FilterState } from "@/hooks/useFilterState";
import { useVault } from "@/hooks/useVault";
import { PREF_SHOW_DOCS, PREF_SHOW_SHORTS } from "@/services/prefs";
import { isAbort } from "@/services/search";
import { applyFilter, type EntityFilm, type EntityPage } from "@/services/entities";

// A PLAIN ScrollView. It used to be Reanimated's, from back when a worklet scroll
// handler was attached to it; the offset has been read from an ordinary onScroll prop
// for a while now (see `onScroll` below), so nothing on it is animated any more and
// the wrapper was buying nothing.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
/**
 * The scrollable tail after the last row — WHY IT IS DERIVED, NOT PICKED.
 * 
 * The floating buttons occupy a fixed zone at the screen's foot: NAV_BOTTOM off
 * the hardware edge plus the pill's own height. The old value here was 76 —
 * SMALLER than that zone (≈87) — so the last row of a filmography could never be
 * scrolled clear of the buttons on ANY page, and on a two-film page it rested
 * permanently behind them (Bryan, 2026-08-09: mis-tapping FILTER trying to open
 * Kaylee Hottle's second film). The tail is now the pill zone plus modest air:
 * you can scroll "just barely" past the content — enough for the last row to sit
 * fully above the buttons, not an exaggerated void.
 */
const NAV_CLEARANCE = NAV_BOTTOM + NAV_BAR_H + 10;

// The grow and the fold — the FLOATING build's numbers, restored wholesale after
// the correctness campaign (stepper, paint gates, emanation, veneer) traded the
// feel away one round at a time. Wall-clock withTiming, rigid window geometry,
// pre-flight measure chain: the combination Bryan called "when it works, it works
// and it looks amazing". The one lesson kept from the video rounds lives in the
// pre-flight refresh (see onWindowLayout), where it costs nothing.
const GROW_MS = 340;
const FOLD_MS = 260;
const SNAP_MS = 180;

/**
 * The focal anchor both the marquee and the hero crop a portrait from. Shared so the
 * crop correction stays honest if either ever moves.
 */
const FOCUS_Y = 0.16;

// The back-swipe edge. 20 matches both iOS's native edge zone and — not a
// coincidence — the page's own horizontal padding, so the strip never covers a
// single tappable pixel: film rows start exactly where it ends, and the back chevron
// renders after it in the tree, so it stays on top and stays tappable.
//
// ⚠ THE SWIPE-DOWN EXIT WAS BUILT HERE AND REVERTED (Bryan, 2026-08-02). It is
// the right gesture for this app — every other media surface is a bottom sheet —
// but it cannot be gated on scroll position, and that is not a tuning problem:
// the exit stroke and the last flick of a scroll back up are the SAME gesture on
// the SAME state, so no rule about offset, finger-up or dwell separates them.
// Three attempts each fixed the reported case and left another. Whatever brings
// it back has to distinguish the two by something other than list position —
// most likely by owning the over-scroll itself rather than racing the ScrollView
// for the touch. Until then the exit reads HORIZONTAL intent, which a vertical
// list never claims, and the two cannot collide at all.
const EDGE_STRIP_W = 20;
// Commit the fold past 30% of the screen, or on a flick.
const SWIPE_CLOSE_FRACTION = 0.3;
const SWIPE_CLOSE_VELOCITY = 800;
/**
 * The drag pulls the fold only PARTWAY; releasing flies it home.
 *
 * The first version mapped the drag linearly to the FULL screen width — a distance a
 * finger starting at the left edge physically cannot cover, so a maximal
 * drag-and-hold left the window pinned at ~6% progress: card-sized but not
 * card-seated, hovering just off the marquee it was supposedly returning to. With
 * the real card visible right behind it, a near-miss reads as a miss ("it
 * overshoots"). Capping the interactive pull keeps a held drag in a CLEARLY
 * mid-flight pose — nothing to compare against the card — and the landing is always
 * performed by the release animation, which is pixel-exact. Same contract as the
 * iOS pop gesture: the finger proposes, the animation disposes.
 */
const SWIPE_MAX_PULL = 0.55; // deepest fold a held drag can reach (1 − grow)
const SWIPE_PULL_SPAN = 0.6; // fraction of screen width that reaches the full pull

/**
 * The tapped card's rect, off the route.
 *
 * Lives here rather than in each of the three route files so the param names and the
 * component that consumes them cannot drift apart. Returns null when the page was not
 * opened from a card — a text row, or a deep link — in which case there is nothing to
 * grow out of and the page simply appears.
 */
export function useOriginParam() {
  const { ox, oy, ow, oh } = useLocalSearchParams<{
    ox?: string;
    oy?: string;
    ow?: string;
    oh?: string;
  }>();
  return useMemo(() => {
    if (!ox || !oy || !ow || !oh) return null;
    const rect = { x: Number(ox), y: Number(oy), width: Number(ow), height: Number(oh) };
    // A zero-sized rect would divide by zero in the scale maths and a NaN would freeze
    // the page mid-transform, invisible. Fall back to no animation instead.
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    return rect;
  }, [ox, oy, ow, oh]);
}

/** The sheet's first section sits this far under the hero; the rest are spaced 26. */
const FIRST_SECTION_TOP = (kind: EntityPage["kind"]) => (kind === "person" ? 16 : 20);

/**
 * ONE screen for person, collection and studio.
 *
 * They are not three designs. Each keeps its own hero composition — a vertical
 * portrait, a landscape backdrop, a poster wall — but the STATE MECHANIC is
 * identical, and so is everything below the hero. Building three screens would
 * guarantee they drift.
 *
 * ONE HERO PER SCREEN: the page opens with the header fully expanded and every film
 * CLOSED. Scrolling collapses the header. An open header above an open film marquee
 * is two heroes fighting, which is exactly what this model exists to prevent.
 */
export default function EntityScreen({
  load,
  seed,
  origin,
  remeasureOrigin,
  onClose,
  onFoldStart,
  onSwipeBegin,
  onSwipeCancel,
  onGrowStart,
  onReadingChange,
  onFilmsChange,
  filter,
  registerBack,
}: {
  load: (signal: AbortSignal) => Promise<EntityPage>;
  /**
   * Artwork and name carried in on the route, so the hero can paint on the FIRST
   * frame instead of after five requests.
   *
   * This exists for the marquee expansion: the search screen grows the tapped card
   * onto exactly this hero's rect and then pushes underneath it, so if the page
   * arrived as a bare skeleton the whole motion would end on a black screen. It is
   * also just better on its own — a page that opens with the portrait already there
   * beats one that opens empty, however you got to it.
   */
  seed?: { kind: EntityPage["kind"]; imagePath: string; name: string } | null;
  /**
   * The marquee's on-screen rect. Present when this page was opened by tapping a card,
   * absent when it was opened from a text row.
   *
   * THE WHOLE PAGE GROWS OUT OF THIS RECT. Not a proxy of its artwork — the real page,
   * laid out at full size and scaled down into the card, so its hero, its name and its
   * whole sheet arrive already inside the thing that is moving. An earlier version
   * expanded a copy of the artwork in the search screen and then swapped routes; that
   * is three stages (expand, mount, load) and it reads as three, however smooth each
   * one is on its own.
   */
  origin?: { x: number; y: number; width: number; height: number } | null;
  /** Re-measures the card fresh — see EntityOverlayRequest. Every transition start
   *  calls this rather than trusting the tap-time snapshot. */
  remeasureOrigin?: (
    cb: (rect: { x: number; y: number; width: number; height: number } | null) => void
  ) => void;
  /**
   * Present when this page is the entity OVERLAY (see EntityOverlayContext): the way
   * out is unmounting the overlay, not popping a route. Absent on the URL routes,
   * which still pop with router.back().
   */
  onClose?: () => void;
  /**
   * Fired the moment a fold COMMITS — not when it lands. The nav's field
   * re-expands off this, so the page folding into its marquee and the search
   * disc opening back into the field are ONE movement rather than two in a
   * row. (Bryan, round 10: "the shared element transition finishes first, and
   * then I see the expansion of the search input field... clunky and delayed.")
   *
   * The overlap was tried and abandoned in device rounds 1–5, when it made the
   * nav jitter every way it was arranged. What changed is the nav, not the
   * timing: its islands are out of flow and anchored to the run's edges now, so
   * the commits this fold throws off can no longer re-solve anything that is in
   * flight. Cancelled swipes never reach here — only a committed fold does.
   */
  onFoldStart?: () => void;
  /**
   * THE INTERACTIVE FOLD'S OWN CUES (sheet-borne pages only — the search
   * screen deliberately does not subscribe). onFoldStart's contract above is
   * "cancelled swipes never reach here", which the nav's choreography needs —
   * but the sheet route's FILTER pill needs the opposite: it must leave the
   * moment the page starts shrinking UNDER THE FINGER, not at release-commit
   * (Bryan, 2026-08-13: the pill was still collapsing over the verbs island
   * after the page had already gone — "the moment that the user is already
   * minimizing it, we want the filter pill to completely go away").
   * onSwipeBegin fires as the back-swipe engages a page that will actually
   * fold (no-origin pages don't move under the drag, so they don't fire);
   * onSwipeCancel fires when the released swipe springs the page back open.
   */
  onSwipeBegin?: () => void;
  onSwipeCancel?: () => void;
  /**
   * The GROW'S FIRST MOTION FRAME — after the pre-flight measure beats, the
   * instant the page visibly starts expanding. No-grow pages fire it at mount.
   * The search screen collapses the island off this, so the nav's handover
   * spring and the grow run TOGETHER and end together — the exact mirror of
   * onFoldStart above, and for the same reason. Bryan tuned this by device
   * verdicts, both directions, 2026-08-11: at open-commit the pill arrived
   * "too early, before the transition" (the pre-flight frames put the sweep
   * ahead of any visible motion); at grow-END it was "too late, as if
   * delayed"; the ruling is "at the same time, instead of waiting on either
   * end" — which is motion-start, both ways.
   */
  onGrowStart?: () => void;
  /**
   * Announces the full-screen reader opening and closing, so the nav bar can
   * get out from in front of it. Same reason the back chevron hides while
   * reading: a control floating over a page of prose is either a mis-tap
   * waiting to happen or a promise the reader does not honour.
   */
  onReadingChange?: (reading: boolean) => void;
  /**
   * Publishes the page's films so the FILTER sheet can adapt to them — its
   * decades and genres are drawn from THIS filmography, never from a fixed
   * list. Fires when the data lands, not while the page is still animating.
   */
  onFilmsChange?: (films: EntityFilm[]) => void;
  /**
   * The COMMITTED filter — what the sheet's APPLY handed over, never the draft
   * it is still editing. Optional because the /person /collection /company
   * routes render this same page with no sheet in front of them; absent means
   * defaults, and defaults keep every film, so the unfiltered page is not a
   * special case anywhere below.
   */
  filter?: FilterState;
  /**
   * Hands the page's animated fold to the overlay context, so the nav's search
   * disc can be the third door out (chevron, edge swipe, disc) and glide exactly
   * like the other two. Absent on the URL routes, which have no disc to serve.
   */
  registerBack?: (fn: () => void) => void;
}) {
  const [entity, setEntity] = useState<EntityPage | null>(null);
  const [failed, setFailed] = useState(false);
  // Owned here rather than in the hero, because it also governs the back chevron
  // and, through onReadingChange, the nav bar.
  const [reading, setReading] = useState(false);
  // One call site for both listeners — the page's own chrome reads the state,
  // the nav bar is told. Batched into one commit either way.
  const noteReading = useCallback(
    (r: boolean) => {
      setReading(r);
      onReadingChange?.(r);
    },
    [onReadingChange]
  );
  const { entryIds } = useVault();
  const router = useRouter();

  // The wire to the FILTER sheet lives further down, beside `pageFilms` — the
  // list it publishes has to be declared before it can be published.

  /**
   * The scroll offset that drives the header collapse.
   *
   * A PLAIN React onScroll prop, deliberately — not useAnimatedScrollHandler and not
   * useScrollOffset. Both of those work by SUBSCRIBING, and a subscription is a thing
   * that can come detached:
   *
   *   · useAnimatedScrollHandler passes `doDependenciesDiffer` to useEvent as a
   *     rebuild flag, and with no dependency array `buildDependencies` falls back to
   *     comparing the handler worklets themselves on every render. The subscription's
   *     fate is therefore decided by an identity check that re-runs each render —
   *     which is why the header froze after a re-render (toggling the biography
   *     reader, or returning from a movie sheet, which re-runs useVault's focus
   *     effect) and never while merely scrolling.
   *   · useScrollOffset subscribes through `animatedRef.observe(...)`, so it needs the
   *     animated ref to attach. This screen returns a skeleton tree while `entity` is
   *     null, so the ScrollView does not exist on first render, and it never bound.
   *
   * An ordinary prop is re-passed on every render and has nothing to detach. The
   * ANIMATION still runs on the UI thread — useAnimatedStyle reads this shared value
   * there — so only the writes are on the JS thread, at scrollEventThrottle's rate.
   */
  const scrollY = useSharedValue(0);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = e.nativeEvent.contentOffset.y;
    },
    [scrollY]
  );

  // ── The grow ────────────────────────────────────────────────────────────────
  //
  // Two nested transforms, because the card and the screen are different shapes and a
  // single scale cannot map one onto the other without stretching. The WINDOW takes the
  // non-uniform scale and clips; the CONTENT inside takes a counter-scale on the axis
  // that differs, so what actually lands on the page is uniform — a page squeezed
  // horizontally would be worse than no animation at all.
  const grow = useSharedValue(origin ? 0 : 1);

  // ── The transition's engine: plain withTiming, ease-in-out both ways ───────
  //
  // The frame-stepped engine that briefly lived here produced no visible motion on
  // device — this repo already documents Expo Go SDK 54's worklet event plumbing as
  // partially broken (TrendingSection/discover: scroll handlers never firing), and
  // Bryan's A/B was decisive. withTiming is the floating build's driver. In-out
  // lingers at the card on the way out — the one place the eye must register "this
  // is the thing I tapped" — and decelerates INTO the card on the way home.
  const startMotion = useCallback(
    (to: number, durationMs: number, done: (to: number) => void) => {
      grow.value = withTiming(
        to,
        { duration: durationMs, easing: Easing.inOut(Easing.cubic) },
        (finished) => {
          "worklet";
          if (finished) runOnJS(done)(to);
        }
      );
    },
    [grow]
  );

  /**
   * THE LIVING ORIGIN. Geometry derives from this state, not from the prop.
   *
   * The prop is the rect measured at TAP time, and that snapshot goes stale: around a
   * tap-after-scroll the list is often still settling — residual scroll, the
   * keyboard-drop reflow, the accordion promotion — and by the time an animation
   * actually runs, the card can sit ~200px from where it was measured. The result was
   * a geometrically perfect transition aimed at a fossil: the grow "popping up from
   * below the marquee", the fold "overshooting far below" it, both by the same
   * distance, intermittently — only when the tap had landed mid-settle. Every
   * screenshot of a bad run shows the same signature: window at near-card scale,
   * displaced straight down.
   *
   * So every transition start — grow, fold, back-swipe — re-measures the card (it
   * stays mounted under the overlay) and refreshes this state before moving. A
   * re-aim during the gesture is scaled by (1 − p), so at the start of a drag even a
   * large correction lands as a sub-pixel shift.
   */
  const [liveOrigin, setLiveOrigin] = useState(origin ?? null);
  const refreshOrigin = useCallback(
    (then: () => void) => {
      if (!remeasureOrigin) {
        then();
        return;
      }
      remeasureOrigin((fresh) => {
        // A null refresh KEEPS the tap-time rect and flies anyway — deliberately.
        // That rect is touch-derived and exact at the tap (see Marquee's remeasure
        // block), so a fossil is off by at most the list's post-tap drift — a
        // near-miss the scrim swallows — while refusing to animate is the "just
        // pops up" this pipeline exists to kill.
        if (fresh) setLiveOrigin(fresh);
        then();
      });
    },
    [remeasureOrigin]
  );

  /**
   * Runs a motion thunk AFTER the commit that carries the freshest geometry.
   *
   * The first living-origin version did `setLiveOrigin(fresh)` then
   * `requestAnimationFrame(start)` — and rAF is NOT a React guarantee: it can fire
   * before the render with the fresh rect commits, so the animation STARTED against
   * the stale tap-time geometry and the correction landed mid-flight as a snap.
   * That race was invisible with no scroll (stale == fresh) and guaranteed after one
   * (stale != fresh) — precisely Bryan's "works perfectly until I scroll" pattern.
   *
   * setLiveOrigin and the tick below batch into ONE commit (both called in the same
   * callback), and this layout effect runs after that commit — by which point the
   * animated styles have been rebuilt with the fresh values. React's ordering, not a
   * frame-callback's luck.
   */
  const pendingMotion = useRef<(() => void) | null>(null);
  const [motionTick, setMotionTick] = useState(0);
  const startAfterCommit = useCallback((thunk: () => void) => {
    pendingMotion.current = thunk;
    setMotionTick((t) => t + 1);
  }, []);
  useLayoutEffect(() => {
    if (motionTick === 0) return;
    const thunk = pendingMotion.current;
    pendingMotion.current = null;
    thunk?.();
  }, [motionTick]);
  // The hero's native compositing layers (BlurView, MaskedView) stay unbuilt until the
  // motion is over — see `settled` on EntityHero. ONE state flip, at the end, so no
  // React render happens during the transition.
  const [settled, setSettled] = useState(!origin);
  // Mirror + parking spot for a fetch that resolves MID-GROW. Applying it immediately
  // would re-render the whole page inside the transition — the one thing the motion
  // law forbids, and a real source of the mid-flight stutter. It waits the few
  // remaining frames and lands with the settle.
  const settledRef = useRef(!origin);
  const pendingEntity = useRef<EntityPage | null>(null);
  const finishGrow = useCallback(() => {
    settledRef.current = true;
    if (pendingEntity.current) {
      setEntity(pendingEntity.current);
      pendingEntity.current = null;
    }
    setSettled(true);
  }, []);
  // A page with no origin never grows, so its "motion start" is its mount — the
  // nav's handover must not wait for a motion that will never run. Mount-only:
  // `origin` cannot change afterwards (the host remounts by token instead).
  useEffect(() => {
    if (!origin) onGrowStart?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THE FLOATING BUILD'S GROW START, restored: the window's onLayout fires, the
  // origin is refreshed (the retries live INSIDE remeasure now — free here, since
  // the window sits invisible at p = 0 through the whole chain), the fresh geometry
  // commits, and only then does the motion start. The measure-commit chain doubles
  // as the paint-catch-up beat that every attempt to remove it re-broke: the frames
  // it spends are exactly the frames the cold mount needs to get pixels on glass.
  const growStarted = useRef(false);
  const onWindowLayout = useCallback(() => {
    if (growStarted.current || !origin) return;
    growStarted.current = true;
    refreshOrigin(() =>
      startAfterCommit(() => {
        startMotion(1, GROW_MS, finishGrow);
        // First frame of the entrance — the nav's handover rides along from
        // HERE, so its spring and this grow end together. See onGrowStart.
        onGrowStart?.();
      })
    );
  }, [origin, refreshOrigin, startAfterCommit, startMotion, finishGrow, onGrowStart]);

  // As an overlay, leaving means unmounting; as a URL route, it means popping.
  //
  // THE NAV'S HANDOVER RUNS DURING THE FOLD AGAIN — see onFoldStart. Rounds 1–5
  // tried that and had to give it up: every variant jittered, because the fold's
  // machinery keeps committing around whatever is in flight, and the nav's
  // islands were laid out IN FLOW, where one raced commit moved the whole run.
  // Rounds 6–9 serialised the two motions to buy a silent corridor, then removed
  // the need for one entirely by taking every island out of flow. With the run
  // immune, the corridor was only costing a beat — so this now just closes the
  // page, and the island left with the fold.
  const goBack = useCallback(() => {
    if (onClose) onClose();
    else router.back();
  }, [onClose, router]);
  const onBack = useCallback(() => {
    if (!origin) {
      goBack();
      return;
    }
    // STRIP THE NATIVE LAYERS BEFORE FOLDING. The fold scales a tree that by now
    // contains two BlurViews and two MaskedViews — the exact
    // visual-effect-view-inside-a-transformed-parent hazard the grow avoids by
    // deferring them. Dropping `settled` unmounts them; startAfterCommit below makes
    // sure that unmount has committed before the motion starts, so the fold
    // transforms a plain tree and no render happens mid-animation.
    settledRef.current = false;
    setSettled(false);
    // Hand the nav its cue HERE, in the same task as the settled-strip, so the
    // island's pose flip batches into that one commit and its springs launch
    // from it — a beat or two ahead of the fold's own motion, which is the
    // right side to err on: the field must never look like it is waiting for
    // the page to finish. Deliberately NOT inside startAfterCommit's callback,
    // which would drop a fresh commit onto the fold's own first frame.
    onFoldStart?.();
    // Fresh coordinates before the fold — the card may not be where it was when this
    // page opened (the rect was captured at tap, and it is used seconds later). The
    // settled-strip, the fresh rect and the motion tick all batch into one commit,
    // and the fold starts only after it — see startAfterCommit.
    refreshOrigin(() =>
      startAfterCommit(() => {
        // Fold back into the card the page came from, FROM WHEREVER IT IS —
        // frame-stepped, decelerating INTO the card, so the landing on the marquee
        // is guaranteed to be seen (the wall-clock fold burned invisibly whenever
        // the settled-strip render stalled the thread: Bryan's "it just disappears
        // instantly").
        startMotion(0, FOLD_MS, goBack);
      })
    );
  }, [origin, goBack, onFoldStart, refreshOrigin, startAfterCommit, startMotion]);

  // ── The back swipe ─────────────────────────────────────────────────────────
  //
  // A route gave edge-swipe-back for free; the overlay has to say it — and can say it
  // BETTER: instead of sliding the page away like a screen, the drag drives the fold
  // itself. Pull right and the page shrinks toward the marquee under your finger;
  // past 30% (or a flick) it commits, otherwise it springs back. The gesture writes
  // the same `grow` value everything already animates from, so the interactive fold
  // and the button fold are one geometry.
  //
  // Disabled while the biography reader is open — it has its own exits, and the back
  // chevron is hidden there for the same reason.
  const hasOrigin = Boolean(origin);
  const beginSwipe = useCallback(() => {
    if (!origin) return;
    // The page is about to shrink under the finger — anything that must leave
    // WITH it (the sheet route's FILTER pill) leaves from this frame, not from
    // the release-commit. See onSwipeBegin's contract note above.
    onSwipeBegin?.();
    // Strip the native compositing layers before the interactive fold, exactly as
    // the button fold does — a BlurView inside a transformed parent is the hazard.
    settledRef.current = false;
    setSettled(false);
    // Fresh coordinates for the drag's target. Landing mid-drag is safe: a re-aim is
    // scaled by (1 − p), so at the shallow start of a pull even a 200px correction
    // moves the window by a few pixels.
    refreshOrigin(() => {});
  }, [origin, onSwipeBegin, refreshOrigin]);
  // JS landing pads for the gesture's worklet — release hands the motion to the
  // frame stepper, same engine as the button paths.
  // The swipe's commit point is the same cue as the chevron's: past the
  // threshold the page IS going home, so the nav starts coming with it.
  const commitFold = useCallback(() => {
    onFoldStart?.();
    startMotion(0, FOLD_MS, goBack);
  }, [onFoldStart, startMotion, goBack]);
  const cancelSwipe = useCallback(() => {
    // The page is coming back — whatever left on onSwipeBegin comes back with
    // it (the sheet pill blooms back in as the page re-seats).
    onSwipeCancel?.();
    startMotion(1, SNAP_MS, finishGrow);
  }, [onSwipeCancel, startMotion, finishGrow]);

  const backSwipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!reading)
        // Rightward intent only, and vertical movement fails it fast so it can never
        // eat the start of a scroll. THIS AXIS IS THE SAFETY — a vertical list never
        // claims a sideways drag, so the exit and the scroll cannot compete for the
        // same touch. See EDGE_STRIP_W for what happened when the exit moved onto the
        // scroll's own axis.
        .activeOffsetX(12)
        .failOffsetY([-16, 16])
        .onStart(() => {
          runOnJS(beginSwipe)();
        })
        .onUpdate((e) => {
          if (!hasOrigin) return;
          // Capped pull — see SWIPE_MAX_PULL. The finger drags the page into a
          // mid-flight pose; it never gets to hold it hovering beside the card.
          const ratio = Math.min(1, Math.max(0, e.translationX) / (SCREEN_W * SWIPE_PULL_SPAN));
          grow.value = 1 - SWIPE_MAX_PULL * ratio;
        })
        .onEnd((e) => {
          const commit =
            e.translationX > SCREEN_W * SWIPE_CLOSE_FRACTION ||
            e.velocityX > SWIPE_CLOSE_VELOCITY;
          if (!hasOrigin) {
            // Nothing to fold (no card to fold into) — the threshold just decides.
            if (commit) runOnJS(goBack)();
            else runOnJS(finishGrow)();
            return;
          }
          // Release hands off to the frame stepper on the JS side — the same
          // stall-immune engine as the button paths.
          if (commit) runOnJS(commitFold)();
          else runOnJS(cancelSwipe)();
        }),
    [reading, hasOrigin, grow, beginSwipe, goBack, finishGrow, commitFold, cancelSwipe]
  );

  // Hardware back must fold like the chevron does, not pop a route that is not there.
  // A route gave this behaviour for free; an overlay has to say it (ArtworkViewer does
  // the same). Ref-read so the subscription never has to rebind.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!onClose) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  // The nav's search disc folds the page through this — same ref-read as the
  // hardware back, so it always runs the CURRENT fold with fresh geometry.
  useEffect(() => {
    registerBack?.(() => onBackRef.current());
  }, [registerBack]);

  // From the LIVING origin — never the tap-time prop. See `liveOrigin`.
  const ow = liveOrigin?.width ?? SCREEN_W;
  const oh = liveOrigin?.height ?? SCREEN_H;
  // ── THE FLOATING BUILD'S GEOMETRY, restored ────────────────────────────────
  //
  // The rigid container transform: the WINDOW takes the card↔screen mapping with a
  // per-axis scale and clips; the CONTENT counter-scales on the differing axis so
  // what lands on the page is uniform. The soft "emanation" variant (uniform scale +
  // heavy cross-fade, copied off the reference app's frames) replaced this for one
  // round and Bryan sent it back — this is the shape he described as floating in and
  // out of the marquee.
  const sx0 = ow / SCREEN_W;
  const sy0 = oh / SCREEN_H;
  const dx = liveOrigin ? liveOrigin.x + ow / 2 - SCREEN_W / 2 : 0;
  const dy = liveOrigin ? liveOrigin.y + oh / 2 - SCREEN_H / 2 : 0;
  const startRadius = 16 / Math.max(0.05, (sx0 + sy0) / 2);

  /**
   * The crop correction, in the page's own unscaled pixels. The card and the hero
   * both anchor a portrait at `top: 16%`, but they are different shapes, so 16%
   * lands on a different part of the face in each — left alone the picture jumps
   * the instant the grow begins:  δ = focus · (heroHeight · scale − cardHeight).
   * The artwork's aspect ratio cancels out, so this needs to know nothing about
   * the image. Zero for a landscape backdrop, which neither box crops vertically.
   */
  const cropDelta =
    seed?.kind === "person" ? FOCUS_Y * (heroOpenHeight("person") * sx0 - oh) : 0;

  // VISIBLE AT THE CARD, on both ends: the fade exists only to soften the one-frame
  // content swap against the marquee underneath, so it is over almost before the
  // window has moved — full opacity by p = 0.08. (A wider fade was the old
  // position-dependent "pops up from the middle": the page materialized en route.)
  const windowStyle = useAnimatedStyle(() => {
    const p = grow.value;
    return {
      opacity: Math.min(1, p / 0.08),
      borderRadius: startRadius * (1 - p),
      transform: [
        { translateX: dx * (1 - p) },
        { translateY: dy * (1 - p) },
        { scaleX: sx0 + (1 - sx0) * p },
        { scaleY: sy0 + (1 - sy0) * p },
      ],
    };
  });

  // Only scaleY: the page is a width-driven layout, so the uniform scale it should
  // appear at IS the window's horizontal scale — the horizontal counter-scale
  // cancels. The translate top-aligns the page inside the card (transforms scale
  // about the centre) and carries the crop correction.
  const contentStyle = useAnimatedStyle(() => {
    const p = grow.value;
    const sy = sy0 + (1 - sy0) * p;
    const ky = (sx0 + (1 - sx0) * p) / sy;
    return {
      transform: [
        { translateY: (SCREEN_H / 2) * (ky - 1) + cropDelta * (1 - p) },
        { scaleY: ky },
      ],
    };
  });

  // The list you came from stays visible behind, washed back. That is most of what
  // makes this read as the card opening rather than a new screen arriving.
  const scrimStyle = useAnimatedStyle(() => ({ opacity: grow.value }));


  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      // Parked if the grow is still running — see `pendingEntity`. Applying data is a
      // full-page render, and it must not land inside the transition.
      .then((d) => {
        if (settledRef.current) setEntity(d);
        else pendingEntity.current = d;
      })
      .catch((e) => {
        if (!isAbort(e)) setFailed(true);
      });
    return () => controller.abort();
  }, [load]);

  // openFilm lives BELOW the `page` memo (it stamps the page's identity onto the
  // sheet it pushes, and a deps-array read above the declaration is a TDZ error).

  /**
   * ▸ THE FILMOGRAPHY IS THE SEARCH ACCORDION (Bryan, 2026-08-11: "these are not
   * marquee drop lists, it's just a list — make it consistent with the rest of
   * the search flow"). A released row unrolls into the same Marquee card the
   * results use; DETAILS pushes the movie sheet; tapping the card folds it back.
   *
   * ONE film open across the whole page, keyed by ID rather than index — a
   * filter or sort re-seating the list must never hand the open card to
   * whichever film now occupies the old slot. UPCOMING unrolls too (Bryan,
   * 2026-08-12: instant navigation there was the one inconsistent tap in the
   * app — "that should be fixed so that it's more consistent"); an unreleased
   * film without artwork lands on NoArtworkPanel like any other credit, and
   * its lane reads the release month instead of a year.
   *
   * The director lane rides the same budget rule as the search flow: fetched
   * for the OPEN film only, cached per id for the life of the page — see
   * useExpandedFilm.
   */
  const [openFilmId, setOpenFilmId] = useState<number | null>(null);
  const toggleFilm = useCallback(
    (id: number) => setOpenFilmId((cur) => (cur === id ? null : id)),
    []
  );
  const director = useExpandedFilm(openFilmId);

  // RELEASED / UPCOMING cover FEATURES only. Shorts and documentaries get their own
  // sections rather than being mixed in — they are still the person's work, but a
  // student short sitting between Oppenheimer and Interstellar reads as noise.
  //
  // Both sections can be switched off in the dev panel, PERSON PAGES ONLY — a
  // collection's parts and a studio's catalogue are not split this way, so the toggles
  // must not reach them. Hidden here rather than at fetch time: the credits are one
  // response either way, and filtering on render means flipping the switch repaints
  // instantly instead of re-requesting a person you are already looking at.
  const showShorts = useBoolPref(PREF_SHOW_SHORTS, true);
  const showDocs = useBoolPref(PREF_SHOW_DOCS, true);

  /**
   * ▸ WHAT THIS PAGE IS WILLING TO SHOW — the gating, and nothing else.
   *
   * Pulled out of the partition so there is exactly ONE list that means "the
   * films in play here", and both consumers take it from the same place: the
   * filter runs on it below, and the sheet is handed it to count against. That
   * is what makes "08 OF 48" true rather than approximately true — with the
   * gating buried in the partition, the sheet was counting a catalogue that
   * included shorts the page had been told to hide, and its denominator could
   * disagree with the hero by however many the dev panel was suppressing.
   */
  const pageFilms = useMemo(() => {
    const all = entity?.films ?? [];
    // PERSON PAGES ONLY. A collection's parts and a studio's catalogue are not
    // split this way, so the toggles must not reach them.
    if (entity?.kind !== "person") return all;
    return all.filter((f) =>
      f.category === "short" ? showShorts : f.category === "documentary" ? showDocs : true
    );
  }, [entity, showShorts, showDocs]);

  // The filter sheet is adaptive to THIS filmography, and it lives in another
  // tree — this is the wire. It publishes `pageFilms`, NOT the raw catalogue:
  // the sheet's decades, genres and denominator must describe the list this
  // page is actually willing to show, or it offers filters for films it would
  // never display and counts against a total the hero disagrees with. Memoized
  // upstream, so this fires when that list changes and not on every render.
  useEffect(() => {
    onFilmsChange?.(pageFilms);
  }, [pageFilms, onFilmsChange]);

  /**
   * What the screen RENDERS — the real page once it lands, the seed until then.
   *
   * The seed carries only what the search row already knew: artwork and a name. Role,
   * vitals, biography and the filmography fill in when the fetch resolves, which at
   * scroll 0 costs nothing visible — the collapse geometry that depends on their
   * height is only consulted once you start scrolling.
   */
  const page = useMemo<EntityPage | null>(() => {
    if (entity) return entity;
    if (!seed) return null;
    return {
      kind: seed.kind,
      id: 0,
      role: "",
      name: seed.name,
      imagePath: seed.imagePath,
      overview: null,
      vitals: [],
      films: [],
      totalFilms: 0,
      truncated: false,
    };
  }, [entity, seed]);

  /**
   * DETAILS → the movie sheet, STAMPED with this page's identity (enhance/cast):
   * the sheet's cast tab consults the stamp before opening a person page, and a
   * tap on the very person the sheet is sitting on folds the sheet back down
   * instead of stacking a duplicate page (Bryan's loop guard — "just bring down
   * the bottom sheet"). A seed page carries id 0 until its fetch lands: no
   * stamp rather than a wrong one, and the guard simply never fires.
   */
  const openFilm = useCallback(
    (film: EntityFilm) =>
      router.push(
        page && page.id > 0
          ? {
              pathname: '/movie/[id]' as const,
              params: { id: String(film.id), fromKind: page.kind, fromId: String(page.id) },
            }
          : { pathname: '/movie/[id]' as const, params: { id: String(film.id) } }
      ),
    [router, page]
  );

  /*
   * ▸ THE SETTLE MACHINERY IS GONE — five builds of it (scroll-end snaps, silence
   * timers, header commits, band rebasing, the home jump) deleted in one move on
   * 2026-08-09, when the page was rebuilt as ONE CONTINUOUS SCROLL. The identity
   * is content now (EntityIdentity, first child of the ScrollView), the artwork
   * is a backdrop underneath, and the collapsed bar is a THRESHOLD fade above
   * (EntityBar) — there is no mid-morph pose left to rest in, so there is
   * nothing to settle. See the rebuild note at the top of EntityHero.tsx before
   * ever re-introducing scroll-position choreography here: scroll COMMANDS are
   * dead in Expo Go, and that constraint is what shaped all of this.
   */

  /**
   * ▸ THE FILTER LANDS HERE, AND ONLY HERE.
   *
   * One choke point immediately above the partition, so everything downstream —
   * the hero's counts, the section headers, the rows themselves — is talking
   * about the same set by construction rather than by four places remembering
   * to agree. `applyFilter` is the sheet's own predicate (services/entities),
   * which is what makes "08 OF 48" in the header and the eight rows on the page
   * the same claim.
   *
   * At defaults it returns the whole list, so the unfiltered page below is
   * untouched — `filtering` exists only for the few places that must word
   * themselves differently when a filter is on.
   */
  const activeFilter = filter ?? FILTER_DEFAULTS;
  const filtering = !isDefault(activeFilter);
  /** What the RELEASED header says when it is not reporting a truncation. Four
   *  states now that the sort has a direction, and it has to name all four or
   *  it will confidently mislabel half of them. */
  const orderLabel =
    activeFilter.sort === "rating"
      ? activeFilter.desc
        ? "HIGHEST RATED"
        : "LOWEST RATED"
      : activeFilter.desc
        ? "NEWEST FIRST"
        : "OLDEST FIRST";
  const filteredFilms = useMemo(
    () => applyFilter(pageFilms, activeFilter),
    [pageFilms, activeFilter]
  );

  const { released, upcoming, shorts, docs, entryCount } = useMemo(() => {
    const all = filteredFilms;
    const features = all.filter((f) => f.category === "feature");
    const keptShorts = all.filter((f) => f.category === "short");
    const keptDocs = all.filter((f) => f.category === "documentary");
    return {
      released: features.filter((f) => f.released),
      upcoming: features.filter((f) => !f.released),
      shorts: keptShorts,
      docs: keptDocs,
      // Counted over what is ON THE PAGE, not over the whole catalogue. If a hidden
      // short carried an entry, claiming it here would put a number under the name
      // that no star on the page accounts for.
      entryCount: [...features, ...keptShorts, ...keptDocs].filter((f) => entryIds.has(f.id))
        .length,
    };
  }, [filteredFilms, entryIds]);

  /** What is actually on the page. The hero says this when a filter is on. */
  const shownCount = released.length + upcoming.length + shorts.length + docs.length;

  // ONE list drives both the counts in the hero and the sections in the sheet, so a
  // count can never disagree with the section it points at. Empty partitions are
  // dropped here, which is also what makes the set self-adapting: a composer who has
  // never made a short gets no SHORTS count and no SHORTS section, with no per-role
  // configuration anywhere.
  const sections = useMemo<EntitySection[]>(() => {
    const out: EntitySection[] = [];
    // UPCOMING FIRST, matching the sheet. What someone has coming is the freshest
    // thing about them and it is almost always one or two rows, so it costs the
    // filmography nothing to lead with it — whereas buried under 40 released titles
    // it is a section nobody scrolls to.
    if (upcoming.length > 0) out.push({ key: "upcoming", label: "UPCOMING", count: upcoming.length });
    if (released.length > 0) {
      out.push({
        key: "released",
        label: "FILMS",
        // A truncated catalogue reports its TRUE size. A studio's search row says
        // 75 FILMS and we only hold the first page of 20 — the header beside this
        // already says "20 OF 75", and the count must not contradict either.
        // ⚠ Unless a FILTER is on, and then it must not claim that at all: we
        // can only test the films we hold, so 75 is a number nothing on this
        // page supports. Filtered, the count is what survived.
        count: entity?.truncated && !filtering ? entity.totalFilms : released.length,
      });
    }
    if (shorts.length > 0) out.push({ key: "shorts", label: "SHORTS", count: shorts.length });
    if (docs.length > 0) out.push({ key: "docs", label: "DOCS", count: docs.length });
    return out;
  }, [entity, filtering, released, upcoming, shorts, docs]);

  if (failed) {
    return (
      <View style={styles.screen}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.message}>Could not load this page.</Text>
      </View>
    );
  }

  // Only when there is no seed either. With one, the page renders its hero straight
  // away and the skeleton rows go UNDER it, in the sheet's own position.
  if (!page) {
    // Skeletons, not a spinner (FR-4) — the filmography sheet's real geometry, so
    // the rows do not jump when the data lands.
    return (
      <View style={styles.screen}>
        <BackButton onPress={() => router.back()} />
        <View style={styles.loading}>
          <SkeletonRows count={6} />
        </View>
      </View>
    );
  }

  const loading = !entity;

  // NO-ARTWORK PATH. Not an edge case — 80% of a film's crew have no photo, and
  // studios never get imagery at all by decision. There is no hero, NO COLLAPSE
  // LATCH (the two-state collapse exists to manage imagery; with none there is
  // nothing to hide), and the list starts immediately. Header is CENTERED, matching
  // the collapsed bars — left-aligned is only ever for text sitting on artwork.
  // Nothing is fabricated to fill the space: no placeholder, no initials avatar,
  // no empty frame.
  const hasArt = Boolean(page.imagePath);

  return (
    // The root is TRANSPARENT and the page's ground lives on the window below it, so
    // the list you came from shows through while the card is still growing. The route
    // is presented as a transparent modal for the same reason.
    <View style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.stageScrim, scrimStyle]}
        pointerEvents="none"
      />
      <Animated.View style={[styles.window, windowStyle]} onLayout={onWindowLayout}>
        <Animated.View style={[styles.page, contentStyle]}>
      {/* THE BACKDROP — under the ScrollView by tree order. The identity that
          used to float above it is CONTENT now (EntityIdentity, below), which is
          the whole rebuild: one continuous page, no seam to manage. The old
          paddingTop reservation and the minHeight runway died with the overlay —
          the identity slot IS the reservation, and a sparse page that never
          reaches the bar threshold simply never shows a bar. */}
      {hasArt && (
        <EntityBackdrop entity={page} scrollY={scrollY} screenWidth={SCREEN_W} />
      )}
      <ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, !hasArt && styles.contentPlain]}
        showsVerticalScrollIndicator={false}
      >
        {hasArt && (
          <EntityIdentity
            entity={page}
            sections={sections}
            entryCount={entryCount}
            scrollY={scrollY}
            bioOpen={reading}
            onBioOpenChange={noteReading}
            loading={loading}
          />
        )}
        {!hasArt && (
          <View style={styles.plainHeader}>
            <Text style={styles.plainRole}>{page.role}</Text>
            <Text style={[styles.plainName, nameType(page.name)]}>
              {page.name.toUpperCase()}
            </Text>
            {/* Same rule as the hero: the entry clause only exists once there is an
                entry. "0 WITH ENTRIES" is a reproach, not information. */}
            {/* Counted over what is ON THE PAGE once a filter is on — the same
                rule the entry count already follows two lines down. A page
                showing eight rows must not head itself "44 FILMS". */}
            <Text style={styles.plainCounts}>
              {filtering ? shownCount : page.totalFilms}{" "}
              {(filtering ? shownCount : page.totalFilms) === 1 ? "FILM" : "FILMS"}
              {entryCount > 0
                ? ` · ${entryCount} WITH ${entryCount === 1 ? "ENTRY" : "ENTRIES"}`
                : ""}
            </Text>
          </View>
        )}

        {/* UPCOMING LEADS THE SHEET.
            It is the freshest thing about a person and it is almost always one or
            two rows, so putting it first costs the filmography nothing — while at the
            bottom, past forty released titles, it is a section nobody ever reaches.

            Omitted entirely when there is nothing unreleased — never an UPCOMING
            header with nothing under it. Design contract 8. */}
        {upcoming.length > 0 && (
          <Animated.View
            entering={FadeIn.duration(240)}
            style={{ paddingTop: FIRST_SECTION_TOP(page.kind) }}
          >
            <View style={styles.upcomingHeader}>
              <View style={styles.upcomingLeft}>
                {/* Hollow ring: the slot is there but nothing is in it yet —
                    you cannot have a take on a film that has not come out. */}
                <View style={styles.ring} />
                <Text style={styles.upcomingLabel}>UPCOMING</Text>
              </View>
              {/* PROJECTS, not FILMS. Nothing here has come out, so calling it a
                  film asserts something we do not know — a runtime, a final cut,
                  sometimes even a medium. An announced credit is a project until
                  it is released. */}
              <Text style={styles.upcomingCount}>
                {String(upcoming.length).padStart(2, "0")}{" "}
                {upcoming.length === 1 ? "PROJECT" : "PROJECTS"}
              </Text>
            </View>
            {/* Same accordion as every other section — a project unrolls into its
                marquee (or the dark panel when nothing is shot yet), DETAILS pushes
                the sheet. Instant navigation here was the app's one inconsistent
                tap; Bryan retired it 2026-08-12. */}
            <FilmSlots
              films={upcoming}
              entryIds={entryIds}
              openId={openFilmId}
              onToggle={toggleFilm}
              onDetails={openFilm}
              director={director}
            />
          </Animated.View>
        )}

        {released.length > 0 && (
          <Animated.View entering={FadeIn.duration(240)}>
            <SectionHeader
              label="RELEASED"
              // No silent caps: when only a first page was fetched, the header
              // says how many of how many are actually on screen.
              // Truncation still wins when it is the honest thing to say, but a
              // filter makes "OF 75" unsupportable (see the section count), and
              // the slot then does its other job: naming the order. Shipping
              // AVG RATING without changing this would leave the header saying
              // NEWEST FIRST over a list sorted by score.
              right={
                page.truncated && !filtering
                  ? `${released.length} OF ${page.totalFilms}`
                  : orderLabel
              }
              // Only the FIRST section hugs the hero. Once UPCOMING is above it this
              // becomes an ordinary section break, at the same 26 the others use.
              paddingTop={upcoming.length > 0 ? 26 : FIRST_SECTION_TOP(page.kind)}
            />
            <FilmSlots
              films={released}
              entryIds={entryIds}
              openId={openFilmId}
              onToggle={toggleFilm}
              onDetails={openFilm}
              director={director}
            />
          </Animated.View>
        )}

        {/* Both omitted entirely when empty, which is the common case — most
            people have neither. Design contract 8. */}
        <MinorSection
          label="SHORTS"
          films={shorts}
          entryIds={entryIds}
          openId={openFilmId}
          onToggle={toggleFilm}
          onDetails={openFilm}
          director={director}
        />
        <MinorSection
          label="DOCUMENTARIES"
          films={docs}
          entryIds={entryIds}
          openId={openFilmId}
          onToggle={toggleFilm}
          onDetails={openFilm}
          director={director}
        />

        {/* While the seed is holding the page up, the sheet is the skeleton — the real
            rows land in the same geometry, so nothing jumps. "No films on record" is a
            statement about the RESPONSE, so it waits for one. */}
        {loading && (
          <View style={{ paddingTop: FIRST_SECTION_TOP(page.kind) }}>
            <SkeletonRows count={6} />
          </View>
        )}
        {entity && entity.films.length === 0 && (
          <Text style={styles.message}>No films on record.</Text>
        )}

        <View style={{ height: NAV_CLEARANCE }} />
      </ScrollView>

      {/* OVER the ScrollView by tree order: the threshold bar, then the reader.
          Both are pure overlays — nothing here measures or moves the content. */}
      {hasArt && (
        <EntityBar
          entity={page}
          sections={sections}
          entryCount={entryCount}
          scrollY={scrollY}
          screenWidth={SCREEN_W}
          pageInset={SEARCH_LAYOUT.padH}
          settled={settled}
        />
      )}
      {hasArt && (
        <BioReader
          entity={page}
          pageInset={SEARCH_LAYOUT.padH}
          bioOpen={reading}
          onBioOpenChange={noteReading}
          settled={settled}
        />
      )}

      {/* Entity pages are REAL PAGES, not sheets — so they need a real way out that
          returns you exactly where you were. Movie details remain bottom sheets and
          present ON TOP of this page; stacking sheet on sheet is what this avoids.

          HIDDEN WHILE READING. It renders above the reading overlay, where a back
          arrow reads as "close the biography" — but it would pop the entire page off
          the stack instead. The reader has its own two exits (tap, or scroll past
          the end); a third control that means something else entirely is a trap.

          Folds the page back into the card it grew out of before popping — see
          `onBack`. */}
      <BackButton onPress={onBack} hidden={reading} />
        </Animated.View>
      </Animated.View>

      {/* The back-swipe edge. OUTSIDE the window on purpose: the window scales during
          the interactive fold, and the gesture surface must not shrink out from under
          the finger that is driving it. 20px wide, it covers no tappable content —
          the page's own padding is 20, so rows start exactly where it ends. It does
          shave the outermost 4px off the back chevron's box (chevron sits at x16);
          the chevron's real target stays 32px wide plus its right-side hitSlop. */}
      <GestureDetector gesture={backSwipe}>
        <View style={styles.edgeStrip} />
      </GestureDetector>
    </View>
  );
}

/**
 * One accordion slot per film — the search results' exact recipe (SubmittedState):
 * every slot is a persistent, clipped, layout-animated wrapper so a row and the
 * card it unrolls into trade places inside one animated box, and the rows below
 * glide rather than jump. The open film's lane reads `1968 · POLANSKI` once the
 * director lands, the collapsed rows stay bare — the same one-request budget
 * story as the results list.
 */
function FilmSlots({
  films,
  entryIds,
  openId,
  onToggle,
  onDetails,
  director,
}: {
  films: EntityFilm[];
  entryIds: Set<number>;
  openId: number | null;
  onToggle: (id: number) => void;
  onDetails: (f: EntityFilm) => void;
  director: string | null;
}) {
  return (
    <>
      {films.map((f, i) => {
        if (f.id === openId) {
          // Released cards date themselves by year; an unreleased one carries its
          // release month — "when" is the useful fact for what hasn't come out.
          const when = f.released ? f.year : f.releaseLabel ?? f.year;
          const facts = when && director ? `${when} · ${director}` : when ?? "";
          return (
            <Animated.View key={f.id} layout={accordionMotion()} style={{ overflow: "hidden" }}>
              {f.imagePath ? (
                <Marquee
                  imageUrl={`https://image.tmdb.org/t/p/w780${f.imagePath}`}
                  index={i + 1}
                  typeTag={f.isShow ? "SHOW" : "FILM"}
                  title={f.title}
                  facts={facts}
                  hasEntry={entryIds.has(f.id)}
                  ctaLabel={ctaFor("movie")}
                  tone="submitted"
                  onPressCollapse={() => onToggle(f.id)}
                  onPressCta={() => onDetails(f)}
                />
              ) : (
                // A credit with no backdrop unrolls into the same dark panel the
                // results use — never a broken image, never a dead tap.
                <NoArtworkPanel
                  index={i + 1}
                  typeTag={f.isShow ? "SHOW" : "FILM"}
                  title={f.title}
                  facts={facts}
                  hasEntry={entryIds.has(f.id)}
                  ctaLabel={ctaFor("movie")}
                  onPressCollapse={() => onToggle(f.id)}
                  onPressCta={() => onDetails(f)}
                />
              )}
            </Animated.View>
          );
        }
        return (
          <Animated.View key={f.id} layout={accordionMotion()} style={{ overflow: "hidden" }}>
            <FilmRow
              film={f}
              index={i + 1}
              hasEntry={entryIds.has(f.id)}
              onPress={() => onToggle(f.id)}
              isLast={i === films.length - 1}
            />
          </Animated.View>
        );
      })}
    </>
  );
}

/** A secondary filmography group — shorts, documentaries. Same accordion, own heading. */
function MinorSection({
  label,
  films,
  entryIds,
  openId,
  onToggle,
  onDetails,
  director,
}: {
  label: string;
  films: EntityFilm[];
  entryIds: Set<number>;
  openId: number | null;
  onToggle: (id: number) => void;
  onDetails: (f: EntityFilm) => void;
  director: string | null;
}) {
  if (films.length === 0) return null;
  return (
    <Animated.View entering={FadeIn.duration(240)} style={{ paddingTop: 26 }}>
      <SectionHeader
        label={label}
        right={`${String(films.length).padStart(2, "0")} ${films.length === 1 ? "FILM" : "FILMS"}`}
        paddingTop={0}
      />
      <FilmSlots
        films={films}
        entryIds={entryIds}
        openId={openId}
        onToggle={onToggle}
        onDetails={onDetails}
        director={director}
      />
    </Animated.View>
  );
}

function BackButton({ onPress, hidden = false }: { onPress: () => void; hidden?: boolean }) {
  // Fades on the same 260ms clock the reading blur uses, so the chevron leaves WITH
  // the portrait rather than vanishing a beat before it.
  const shown = useSharedValue(1);
  useEffect(() => {
    shown.value = withTiming(hidden ? 0 : 1, { duration: 260 });
  }, [hidden, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <Animated.View style={[styles.back, style]} pointerEvents={hidden ? "none" : "auto"}>
      <Pressable
        onPress={onPress}
        hitSlop={12}
        style={styles.backHit}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        // Removed from the accessibility tree while hidden, not just visually gone —
        // a screen reader must not offer a control the screen no longer honours.
        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      >
        <ChevronLeft />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SIGNAL.ground },
  // The clip. Laid out ONCE at full screen and never resized — every state change is a
  // transform. The page's ground colour lives here rather than on the root, so that
  // outside this box the route really is transparent.
  window: {
    position: "absolute",
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    overflow: "hidden",
    backgroundColor: SIGNAL.ground,
  },
  page: { flex: 1 },
  stageScrim: { backgroundColor: "rgba(10,9,8,0.55)" },
  content: { paddingHorizontal: SEARCH_LAYOUT.padH },
  contentPlain: { paddingTop: 78 },
  loading: { paddingHorizontal: SEARCH_LAYOUT.padH, paddingTop: 120 },
  plainHeader: { alignItems: "center", gap: 9, paddingBottom: 6 },
  plainRole: {
    color: SIGNAL.accent,
    fontFamily: FONT.monoMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.8,
  },
  // Size comes from nameType() — one rule for every name on every entity surface.
  plainName: { color: SIGNAL.ink, fontFamily: FONT.display, textAlign: "center" },
  plainCounts: {
    color: SIGNAL.ink,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.4,
  },
  upcomingHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
  },
  upcomingLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  ring: {
    width: 7,
    height: 7,
    borderWidth: 1.4,
    borderColor: ROW.index,
    borderRadius: 4,
    flexShrink: 0,
  },
  upcomingLabel: {
    color: SIGNAL.muted,
    fontFamily: FONT.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
  upcomingCount: {
    color: ROW.indexDim,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
  edgeStrip: { position: "absolute", left: 0, top: 0, bottom: 0, width: EDGE_STRIP_W },
  back: { position: "absolute", top: 58, left: 16, width: 36, height: 36 },
  backHit: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  message: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 18,
    letterSpacing: TRACK.micro11,
    textAlign: "center",
    marginTop: 40,
  },
});
