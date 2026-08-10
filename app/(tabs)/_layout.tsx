import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  Keyboard,
  Dimensions,
  Platform,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import Svg, { Path } from "react-native-svg";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { NavMorphProvider, useNavMorph, NAV_SPRING } from "@/contexts/NavMorphContext";
import {
  NAV_BAR_H,
  NAV_BAR_PAD,
  KB_GAP,
  NAV_BAR_R,
  NAV_BLUR_INTENSITY,
  NAV_BOTTOM,
  NAV_BUBBLE_H,
  NAV_GLASS_RIM,
  NAV_GLASS_TINT,
  NAV_ICON,
  NAV_FILTER_W,
  NAV_ISLAND_GAP,
  NAV_LABEL_GAP,
  NAV_LABEL_W,
  NAV_SCALE,
  NAV_SIDE_INSET,
  NAV_SLOT_W,
} from "@/constants/navMetrics";
import FillGlyph from "@/components/glyphs/FillGlyph";
import {
  SearchIslandProvider,
  useSearchIsland,
  type TabName,
} from "@/contexts/SearchIslandContext";
import { useEntityOverlay } from "@/contexts/EntityOverlayContext";
import { SIGNAL, accentAlpha } from "@/constants/signal";
import {
  FILTER_DEFAULTS,
  SEARCH_FILTER_DEFAULTS,
  isDefault,
  type FilterState,
} from "@/hooks/useFilterState";
import AppliedBar, { APPLIED_BAR_GAP, APPLIED_BAR_H } from "@/components/search/AppliedBar";
import { appliedTerms, type AppliedTerm } from "@/constants/filterBands";

/** The bar's own word for each sort field. Shorter than the sheet's labels, because
 *  a term has to earn its width beside three others — RELEASE DATE would eat a slot
 *  and a half saying what `RELEASE` already says. */
const SORT_TERM_LABELS = {
  relevance: "RELEVANCE",
  alpha: "A–Z",
  release: "RELEASE",
  rating: "RATING",
  size: "SIZE",
} as const;

// ⚠ WORKLET SAFETY — read before editing any useAnimatedStyle in this file.
// Animated styles run on the UI thread. They may ONLY use: shared values, plain
// arithmetic, Math.*, and Reanimated helpers (interpolate, withSpring). Calling
// any ordinary function from inside one — px(), seatShift(), a formatter — throws
// at runtime and crashes the app on launch. tsc CANNOT catch it. Precompute the
// value into a constant outside the hook and close over that instead.
// Verify after editing:  npm run check:worklets

const ACCENT = "#9ccadf";
const INACTIVE = "rgba(255, 255, 255, 0.85)";
// Signal's ink, the colour the search boards give the dismiss chevron.
const INK = "#F2EDE4";
/**
 * The app's one verb colour, and the FILTER pill's "this page is filtered"
 * state. Taken from the design system rather than re-typed — the sheet's own
 * ACCENT is the same value, and these two objects are the same object.
 * The rim is the board's `#9CCADF80`, matching the sheet's touched controls.
 */
const NAV_ACCENT = SIGNAL.accent;
const NAV_ACCENT_LINE = "rgba(156, 202, 223, 0.5)";

// TWO OBJECTS, NOT ONE. The pill carries where you can go; the satellite carries
// search. They never merge — the gap between them is the whole point.
//
// Motion laws this bar obeys (from the nav board):
//   · Nothing fades. Labels reach zero WIDTH, dots reach zero SIZE, discs reach
//     zero RADIUS. There is no opacity ramp anywhere in this file.
//   · The bar never hides, never collapses, never moves. At this size there is
//     nothing to reclaim by shrinking it, so it stays fully expanded at every
//     scroll position — always readable, always one tap.
//   · One spring for everything (NAV_SPRING): snappy settle, no visible bounce.
// Geometry is the SHIPPED pill's, not the board's. The board's 56/r28/slot-52 read
// as cramped on device next to what this app already had — these are the numbers
// that felt right before the split, so the only thing that changed is the layout.
// ▸▸ SCALE / NAV_BOTTOM / the glass now live in @/constants/navMetrics, because the
//    capture pill on the movie screen has to land on exactly the same footprint. Edit
//    them THERE and both pills move together.
const SCALE = NAV_SCALE; //    overall size. 1 = current, 1.1 = 10% bigger.
const ISLAND_GAP = NAV_ISLAND_GAP; // how far the two islands sit apart at rest.
// 40 leaves a hole once the field opens, so the gap closes right down there.
const ISLAND_GAP_OPEN = 12;

const px = (n: number) => Math.round(n * SCALE);
const BAR_H = NAV_BAR_H;
const BAR_PAD = NAV_BAR_PAD;
const BAR_RADIUS = NAV_BAR_R;
const SLOT_W = NAV_SLOT_W;
const BUBBLE_H = NAV_BUBBLE_H;
const SATELLITE = BAR_H;
// Scrolling no longer minimizes the bar — it eases it down to this and stops.
// Anything smaller starts clipping the labels.
const SCROLL_SHRINK = 0.95;
// One label width for every tab: the growing and shrinking slots then cancel
// exactly during a switch, so the pill's total width never oscillates. Wide
// enough for the longest word we have, so no label is ever truncated at rest.
// ONE label width for every tab. Uniform on purpose: the growing and shrinking
// slots then cancel exactly during a switch, so the bar's total width never
// oscillates. Slates sits last, so its shorter word leaves its slack at the end
// of the bar rather than mid-row — that is what per-word widths were solving.
const LABEL_W = NAV_LABEL_W;
const LABEL_W_MAX = LABEL_W;
const LABEL_GAP = NAV_LABEL_GAP;
const ICON = NAV_ICON;
const GLYPH_SM = px(18);
// The islands share one fixed run of screen, so the satellite can be given a real
// animated WIDTH instead of a flex value — flex can't be sprung.
const TOTAL_W = Dimensions.get("window").width - NAV_SIDE_INSET * 2;
// Every island is the same height and the closed ones are all the same circle —
// nothing in this bar is allowed to look bigger than anything else.
const CLOSE_W = BAR_H;
// The in-field clear mark: a 22px hit box inset 18px from the field's right edge,
// both straight off the TYPING board. Scaled with px() like every other nav metric.
const CLEAR_BOX = px(22);
const CLEAR_INSET = px(18);
// Collapsed the pill is three seats and one label; expanded it is a single
// circle, so its width is a real number at both ends and can be sprung.
//
// There is NO third width — the bar's endpoints are PILL_W_FULL and BAR_H,
// nothing else. (An entity page used to show the full labelled pill; Bryan's
// filter ruling superseded that on 2026-08-01: on an entity page the seats fold
// to the SAME disc they fold to when search opens, because something else —
// the FILTER pill — needs the room. Same spring, same endpoints; the compact
// label-less pill that was rejected remains rejected.)
const PILL_W_FULL = BAR_PAD * 2 + SLOT_W * 4 + LABEL_W_MAX + LABEL_GAP;
// The FILTER pill (entity pages) — simply the room left between the two discs
// once the entity pose spans the full TOTAL_W run: disc + gap + pill + gap +
// disc. It is now a RECT, not a share of a row: the pill is out of flow, so
// this number places it and nothing downstream depends on it being right.
// (It used to be load-bearing in a much scarier way — the pill's width was the
// field's position, and the run only held together because the two were exact
// mirrors on every frame. Rounds 1–9 of the exit jitter were the frames where
// they weren't.)
// Imported, not recomputed: the FILTER SHEET grows out of this pill's rect, and
// navMetrics is the one place that knows where the rect is. Same arithmetic it
// always was (TOTAL_W − 2·BAR_H − 2·ISLAND_GAP) — now with only one copy of it.
const FILTER_W = NAV_FILTER_W;
// How far below the bar the pill starts its rise. A bubble surfacing, not a
// slide-in from offscreen. The same number sinks it back on the way out.
const FILTER_RISE = px(18);
// Search open, keyboard down: the field runs from the pill all the way to the right
// margin. Nothing is reserved for the ✕ — an empty slot sitting there before there
// is any keyboard to dismiss just reads as a hole in the bar.
const SAT_W_OPEN = TOTAL_W - BAR_H - ISLAND_GAP_OPEN;
// The run at REST is not TOTAL_W and never was: the 14pt gap between the two
// islands is the law (navMetrics: "the gap is the point — they never merge"),
// so the closed run is exactly as wide as its contents and the side insets come
// out wherever they come out — narrower than TOTAL_W on a big phone, a couple
// of points wider on a small one. Naming it is what lets the run be anchored at
// both ends WITHOUT the rest pose being stretched to the margins.
const REST_W = PILL_W_FULL + ISLAND_GAP + SATELLITE;
// The keyboard then slides the field left by exactly the seat disc's footprint,
// and the ✕ opens into the space that leaves on the right. A TRANSFORM, so it
// moves the field and nothing else — the run's geometry is untouched by it.
const FIELD_SHIFT = BAR_H + ISLAND_GAP_OPEN;
// Air between the bottom of the field and the top of the keyboard — now shared
// from navMetrics, because the compose screen's QUICK SEARCHES stack anchors
// itself above the island and must agree with the lift about where that is.
// UIKit's keyboard curve. iOS animates the keyboard with a private easing that is
// not one of the public ones; this bezier is the standard approximation of it, and
// matching it is what makes the island look attached rather than merely nearby.
const KB_EASE = Easing.bezier(0.17, 0.59, 0.4, 1);
// Only used if an event ever arrives without one. iOS always sends its own.
const KB_FALLBACK_MS = 250;
// ▸ ONE CLOCK. Every moving part of the search island is a pure function of the
// keyboard's live height, so nothing can drift out of sync with the keyboard or
// with anything else — opening OR closing. Springs here were the bug: they ran on
// their own curve, so the ✕ and the field were still settling long after the
// keyboard had gone. The island is fully open by the time the keyboard has risen
// this far, which lets the expansion lead the keyboard slightly instead of trailing
// it. This is the only number to touch if the open feels fast or slow.
// Slides the surviving seat's glyph into the centre of that circle as the pill
// shrinks past it: slot i sits at BAR_PAD + i*SLOT_W, glyph inset (SLOT_W-ICON)/2,
// and the circle wants it at (BAR_H-ICON)/2.
const seatShift = (i: number) =>
  (BAR_H - ICON) / 2 - (BAR_PAD + i * SLOT_W + (SLOT_W - ICON) / 2);

/* ── Universe: a star that unfolds into a scatter ───────────────────────────
   Idle it is one mark. Tapped, the star shrinks to nothing while nine points
   travel outward from the centre into a loose constellation — the same sky the
   Home screen is built on. Scale only; nothing fades. */

const STAR_PATH =
  "M12 1 C13.5 7.6 16.4 10.5 23 12 C16.4 13.5 13.5 16.4 12 23 C10.5 16.4 7.6 13.5 1 12 C7.6 10.5 10.5 7.6 12 1 Z";

// Where each point lands once the star has unwound. Hand-placed rather than a
// ring: an even ring reads as a loading spinner, a scatter reads as a sky.
const SCATTER_BASE: { x: number; y: number; r: number }[] = [
  { x: 0, y: -9, r: 1.9 },
  { x: 8, y: -5, r: 1.4 },
  { x: 9.5, y: 3, r: 1.9 },
  { x: 4, y: 9, r: 1.4 },
  { x: -4.5, y: 8.5, r: 1.7 },
  { x: -9.5, y: 1.5, r: 1.4 },
  { x: -7, y: -6.5, r: 1.9 },
  { x: 3, y: -1.5, r: 1.2 },
  { x: -2.5, y: 2.5, r: 1.2 },
];
const SCATTER = SCATTER_BASE.map((p) => ({ x: p.x * 0.95, y: p.y * 0.95, r: p.r * 0.95 }));

function UniverseGlyph({ focus, color }: { focus: SharedValue<number>; color: string }) {
  const starStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - focus.value }],
  }));
  return (
    <View style={styles.glyphBox}>
      <Animated.View style={[styles.glyphLayer, starStyle]}>
        <Svg width={ICON} height={ICON} viewBox="0 0 24 24">
          <Path d={STAR_PATH} fill={color} />
        </Svg>
      </Animated.View>
      {SCATTER.map((p, i) => (
        <ScatterDot key={i} focus={focus} point={p} color={color} />
      ))}
    </View>
  );
}

function ScatterDot({
  focus,
  point,
  color,
}: {
  focus: SharedValue<number>;
  point: { x: number; y: number; r: number };
  color: string;
}) {
  // Radius → 0 rather than opacity → 0: the dot is genuinely absent when seated,
  // not a transparent one sitting on top of the star.
  const style = useAnimatedStyle(() => {
    const d = point.r * 2 * focus.value;
    return {
      width: d,
      height: d,
      borderRadius: point.r,
      transform: [
        { translateX: point.x * focus.value },
        { translateY: point.y * focus.value },
      ],
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/* ── Discover: a scored box whose quarters pull apart ───────────────────────
   Closed, it is one box scored into four. Tapping opens it: the seams widen and
   the quarters round off and travel out to the corners. Universe converges,
   Discover separates — mirrors of each other, which is why they read as a pair. */

// Squares, and they stay squares. The open pose is a crack, not a burst: the
// seam widens by a point and a half and the corners barely soften. Rounding them
// any harder turned four quarters into four dots.
const Q = 9.5; // quarter side
const SEAM = { closed: 1.9, open: 3.3 };
const Q_RADIUS = { closed: 1.9, open: 2.5 };

function Quarter({
  focus,
  sx,
  sy,
  color,
}: {
  focus: SharedValue<number>;
  sx: number;
  sy: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const seam = interpolate(focus.value, [0, 1], [SEAM.closed, SEAM.open]);
    const off = (Q + seam) / 2;
    return {
      borderRadius: interpolate(focus.value, [0, 1], [Q_RADIUS.closed, Q_RADIUS.open]),
      transform: [{ translateX: sx * off }, { translateY: sy * off }],
    };
  });
  return (
    <Animated.View
      style={[styles.quarter, { width: Q, height: Q, backgroundColor: color }, style]}
    />
  );
}

function DiscoverGlyph({ focus, color }: { focus: SharedValue<number>; color: string }) {
  return (
    <View style={styles.glyphBox}>
      <Quarter focus={focus} sx={-1} sy={-1} color={color} />
      <Quarter focus={focus} sx={1} sy={-1} color={color} />
      <Quarter focus={focus} sx={-1} sy={1} color={color} />
      <Quarter focus={focus} sx={1} sy={1} color={color} />
    </View>
  );
}

function SettingsGlyph({ focus, color }: { focus: SharedValue<number>; color: string }) {
  // The gear turns an eighth as it seats — the smallest possible acknowledgement,
  // and the only rotation in the bar.
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${focus.value * 45}deg` }],
  }));
  return (
    <View style={styles.glyphBox}>
      <Animated.View style={style}>
        <Ionicons name="settings-outline" size={ICON} color={color} />
      </Animated.View>
    </View>
  );
}

// Slates' bookmark is a FillGlyph — the movie floor's slate and trailer seats fill exactly
// the same way, so there is one definition of the mechanic rather than three lookalikes.

type GlyphKind = "universe" | "discover" | "slate" | "settings";

const TAB_CONFIG: Record<string, { label: string; glyph: GlyphKind }> = {
  index: { label: "Universe", glyph: "universe" },
  discover: { label: "Discover", glyph: "discover" },
  slate: { label: "Slates", glyph: "slate" },
  settings: { label: "Settings", glyph: "settings" },
};
// `search` is intentionally absent — it has the satellite instead of a seat.

function TabSlot({
  focused,
  config,
  onPress,
  hideLabel,
}: {
  focused: boolean;
  config: (typeof TAB_CONFIG)[string];
  onPress: () => void;
  hideLabel?: boolean;
}) {
  // Fires only on real focus flips (an effect, not a derived value): a derived
  // value re-ran on every parent render and restarted the spring mid-flight.
  const focus = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    focus.value = withSpring(focused ? 1 : 0, NAV_SPRING);
  }, [focused, focus]);
  // Separate from focus: the seat stays lit while the keyboard is up, it just
  // gives its word back so the field can have the room.
  const label = useSharedValue(focused && !hideLabel ? 1 : 0);
  useEffect(() => {
    label.value = withSpring(focused && !hideLabel ? 1 : 0, NAV_SPRING);
  }, [focused, hideLabel, label]);

  const slotStyle = useAnimatedStyle(() => ({
    width: SLOT_W + label.value * (LABEL_W + LABEL_GAP),
  }));
  // The seat is a real width, not a tinted overlay — so it can never sit on top
  // of a neighbour mid-glide.
  // Tied to the label, not to focus: when the pill becomes a circle the seat
  // loses its chrome as well as its word, exactly like the reference.
  const bubbleStyle = useAnimatedStyle(() => ({
    borderRadius: BUBBLE_H / 2,
    backgroundColor: `rgba(156, 202, 223, ${0.14 * label.value})`,
    borderColor: `rgba(156, 202, 223, ${0.2 * label.value})`,
  }));
  // Width still carries the layout, but the word itself only appears once the
  // slot has already made room for it — revealing a label letter-by-letter as
  // the width grew read as clipping, not as motion. This is the one opacity
  // ramp in the file and it exists for that reason.
  const labelWrapStyle = useAnimatedStyle(() => ({
    width: label.value * LABEL_W,
    marginLeft: label.value * LABEL_GAP,
    opacity: interpolate(label.value, [0.62, 1], [0, 1], "clamp"),
  }));

  const color = focused ? ACCENT : INACTIVE;

  return (
    <Animated.View style={[styles.slot, slotStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={config.label}
        onPress={onPress}
        hitSlop={8}
        style={styles.slotPressable}
      >
        <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none" />
        {config.glyph === "universe" && <UniverseGlyph focus={focus} color={color} />}
        {config.glyph === "discover" && <DiscoverGlyph focus={focus} color={color} />}
        {config.glyph === "slate" && (
          <FillGlyph focus={focus} outline="bookmark-outline" solid="bookmark" color={color} />
        )}
        {config.glyph === "settings" && <SettingsGlyph focus={focus} color={color} />}
        <Animated.View style={[styles.labelWrap, labelWrapStyle]}>
          <Text numberOfLines={1} style={styles.tabLabel}>
            {config.label}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The floating nav: a pill of destinations and, detached beside it, the search
 * satellite. Neither ever hides or shrinks with scroll.
 */
function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    expanded,
    query,
    lastTab,
    setQuery,
    submitQuery,
    registerFocuser,
    noteTab,
    open,
    close,
    resultsFilter,
    setResultsFilter,
    resultsSink,
  } = useSearchIsland();
  // An open entity page puts the nav in the FILTER pose (Bryan, 2026-08-01):
  // the seats fold to the last tab's disc — the same squeeze search opening
  // already performs — and the FILTER pill takes the vacated room, with the
  // search disc holding the right. Three elements, three jobs: the seat is one
  // tap back to the tab you came from (page and query both survive the trip),
  // the pill grows into the filter sheet, the disc folds the page home. The
  // pose is scoped to the search route: the page stays MOUNTED across a tab
  // switch, so on any other tab the bar must read as its normal four-seat self.
  const {
    isOpen: entityOpen,
    reading,
    filterOpen,
    filterCovering,
    appliedFilter,
    setAppliedFilter,
    openFilter,
    requestFold,
  } = useEntityOverlay();

  const { progress } = useNavMorph();
  // No `typing` state. Nothing about this bar needs React to know the keyboard is
  // up — the keyboard drives the motion directly on the UI thread. A state flip
  // here re-rendered the whole tab bar mid-transition for nothing.
  const inputRef = useRef<TextInput>(null);
  // Bumping this remounts the TextInput. See raiseKeyboard — it is the only
  // mechanism that reliably opens the keyboard from a dismissed state.
  const [focusToken, setFocusToken] = useState(0);

  // ▸ THE ONE FACT REACT NEEDS ABOUT THE KEYBOARD — and the only one.
  //
  // The note above still holds for MOTION: not a frame of the field's glide, the
  // ✕, or the lift goes through React, and nothing here changes that. But THE
  // FOLD (Bryan, SEARCH MASTER V3) is not motion, it is a POSE — when a search
  // settles, the satellite stops being a field and the middle room changes
  // owner. Which islands exist, which are live, and which static width each is
  // pinned to are all React's business, so this one boolean has to cross over.
  //
  // It flips TWICE PER SEARCH, not once per frame: up when the keyboard leaves,
  // down when it comes back. That is the distinction the note was written to
  // protect — a re-render at the moment the pose changes is the pose changing;
  // a re-render per keyboard frame was a render for nothing.
  //
  // `settled` reads iOS's `keyboardWillHide`, so the fold begins on the frame the
  // keyboard begins to leave rather than a full ~250ms after it has gone. The
  // field's three concurrent movements (down with the lift, right with slideP,
  // narrow with grow) all converge on the same rect — the right disc — so they
  // read as one thing falling back into its hole. ⚠ IF IT READS AS BUSY ON
  // DEVICE the change is one word: `keyboardWillHide` → `keyboardDidHide` below,
  // which makes the fold strictly sequential (keyboard leaves, then the bar
  // changes pose) at the cost of a beat of dead time.
  const [settled, setSettled] = useState(false);

  // FR-6: NO autofocus when you arrive on the tab. autoFocus is gated on a non-zero
  // token, so resetting it whenever search closes guarantees the next entry into
  // Search mounts a plain, unfocused field.
  useEffect(() => {
    if (!expanded) setFocusToken(0);
  }, [expanded]);

  // The results screen cannot reach this input — it lives in a different tree — so
  // the nav hands the context a way to focus it. The zero-results CTA needs the
  // keyboard back after clearing, and that is the only route to it.
  /**
   * Put the keyboard up, reliably.
   *
   * `focus()` alone is NOT enough. After `Keyboard.dismiss()` (the Search key) or an
   * `on-drag` dismissal (scrolling the results), the native keyboard is gone but the
   * JS side can still believe this input is focused — and focusing an already-focused
   * input is a NO-OP, so nothing presents. That is why "clear" cleared the text and
   * left the user staring at a closed keyboard.
   *
   * Forcing blur → focus makes it a real state transition, which does present.
   * Guarded on `isVisible()` so the keyboard-already-up path is untouched: blurring
   * there would dismiss and re-raise the keyboard, i.e. a visible flicker on the one
   * path that already worked.
   */
  const raiseKeyboard = useCallback(() => {
    // Already up: a plain focus is enough, and remounting here would flicker.
    if (Keyboard.isVisible()) {
      inputRef.current?.focus();
      return;
    }
    // Keyboard down: REMOUNT the input with autoFocus rather than calling focus().
    //
    // Imperative focus does not work from this state, and two attempts to make it
    // work failed on device. After Keyboard.dismiss() or an `on-drag` dismissal the
    // native keyboard is gone but the input's focus state is unreliable — focus() is
    // then a no-op, and blur()+focus() across a frame did not fix it either.
    //
    // A freshly MOUNTED TextInput with autoFocus has no prior state to be stale
    // about, so it always presents. Bumping the key is what forces that remount. The
    // input is empty at this point anyway (we just cleared it), so nothing is lost.
    setFocusToken((t) => t + 1);
  }, []);

  useEffect(() => {
    // The path the zero-results "CLEAR AND TRY AGAIN" CTA uses, whose entire promise
    // is that it clears AND gives you the keyboard back.
    registerFocuser(raiseKeyboard);
  }, [registerFocuser, raiseKeyboard]);

  const current = state.routes[state.index]?.name;
  // Search is a destination like any other: when you are on it, it wears the
  // accent — the island is the only thing telling you where you are.
  const onSearch = current === "search" || expanded;
  // The ENTITY-PAGE route into the FILTER pose — results are the other one, see
  // `folded` below. It exists only where the page is VISIBLE: elsewhere the page
  // is mounted but covered, and the bar owes that tab its ordinary pill.
  // `!expanded` is LOAD-BEARING, not defensive. A committed fold flips
  // `expanded` true while the page is still mounted and still folding (see
  // EntityScreen's onFoldStart — that overlap is what makes the page going home
  // and the field coming back one movement), so for ~260ms the two genuinely
  // disagree. This clause is the rule for that window: the field wins the
  // middle room the instant it is asked for, and the page's later close finds
  // the bar already holding the pose it was going to hand it.
  const onEntity = entityOpen && current === "search" && !expanded;

  /**
   * ▸ THE FOLD — the RESULTS pose (Bryan, SEARCH MASTER V3, 2026-08-04).
   *
   * Ruling ①: results wear `[nav disc][FILTER][search disc]`, IDENTICAL to an
   * entity page. Ruling ②: the FILTER entrance moves to the moment the search
   * SETTLES — the field contracts rightward into the right disc while FILTER
   * unfolds into the room it leaves. That is not a new animation; it is the
   * entity page's existing entrance played earlier, off a different trigger.
   *
   * ▸ ONE TRIGGER, THREE DOORS. Bryan named two (the keyboard's Search key, the
   * dismiss chevron) and the results list quietly owns a third (drag-dismiss).
   * All three are the same fact — THE KEYBOARD LEFT WHILE A QUERY WAS LIVE — so
   * this is one condition rather than three call sites that must be kept in
   * agreement.
   *
   * ▸ RULING ⑥ IS THE `hasQuery` CLAUSE: the field collapses only when a query is
   * LIVE. An open, EMPTY field with the keyboard down is how you arrive on this
   * tab (FR-6 mounts the field unfocused), and folding it away the instant it
   * opened would leave the disc looking like it had refused the tap.
   *
   * ▸ WHY THIS COSTS NO NEW MOTION. `squeeze` is grow + filterGrow, and across
   * the fold those two springs start on the same frame as exact mirrors — one
   * falls 1→0 while the other rises 0→1 — so the sum holds at 1 and the bar
   * stays folded to its disc without a frame of pumping. This is the ARRIVAL
   * identity the squeeze comment already documents, reached by a new road.
   */
  const hasQuery = query.trim().length > 0;
  const folded = expanded && current === "search" && settled && hasQuery;
  /** The satellite is a FIELD rather than a disc. Everything that used to ask
   *  `expanded` about the satellite's shape must ask this instead — `expanded`
   *  now means "a search is open", which is true in the folded pose too. */
  const fieldOpen = expanded && !folded;
  /**
   * The middle room belongs to the FILTER pill — on an entity page OR on
   * results, which is the whole point of ruling ①.
   *
   * ⚠ THIS IS ALSO WHAT MAKES RULING ③ FREE. Opening an entity page from the
   * folded pose flips `folded` off and `onEntity` on in the same commit, so this
   * boolean never changes and the bar does not move — "only the from-results
   * path becomes a no-op, which frees the card's grow to have the screen to
   * itself". The fold home is the same identity in reverse, including the
   * documented ~260ms where `expanded` and `entityOpen` are both true: `folded`
   * covers that window, so the pill holds its room instead of flickering out of
   * it and back.
   */
  const filterPose = onEntity || folded;

  /**
   * ▸ THE PILL SAYS WHETHER THE PAGE IS FILTERED.
   *
   * Bryan: "add some sort of color to let the user know that there are active
   * filters when the page is actually down... not an indicator of HOW MANY,
   * just that it's active." So it is a state, not a badge — one bit, worn.
   *
   * And it is not a new visual idea: the sheet already rules that the accent
   * means "this differs from the default", and this pill is not merely the
   * button that opens the sheet, it is the object the sheet IS — the same rect,
   * the same word, handed back and forth. Giving it any other treatment would
   * mean the same object saying the same thing two ways. Same colour, same
   * meaning, no new decision.
   *
   * ⚠ The sheet's landing frames read this too (see FilterSheet's rim and
   * traveller). The swap between the two is a single frame with no crossfade,
   * so if the pill wore the accent and the capsule it lands out of did not, the
   * handover would flash — which is the exact seam the material match exists to
   * close.
   *
   * ▸ ASKED PER SURFACE, BY RULING ⑦ — "FILTER's active tint resets per surface,
   * or a results filter makes the next entity page look pre-filtered". There are
   * two committed filters and the pill wears whichever one belongs to what is on
   * screen: the entity overlay's on a page, the search island's on results. One
   * shared object would have a filmography you filtered lighting the pill over
   * an unrelated result set, claiming a filter the user could neither see nor
   * find the controls for.
   *
   * ⚠ The results side measures against SEARCH_FILTER_DEFAULTS, not the entity
   * defaults — that surface rests on RELEVANCE, so a result set sorted by
   * RELEASE DATE is a filter somebody turned on and must light the pill.
   */
  /* ── WHAT THE APPLIED BAR PRINTS, AND WHAT TAPPING A WORD DOES. ─────────────
     Both surfaces feed the same bar; only which state it reads and which setter
     it writes differ. The KIND is not a term — it is navigation, chosen in the
     row above the results, and putting it here would offer to "remove" the thing
     you are looking at. */
  const barState = onEntity ? appliedFilter : resultsFilter;
  const barBase = onEntity ? FILTER_DEFAULTS : SEARCH_FILTER_DEFAULTS;
  const writeFilter = useCallback(
    (next: FilterState) => (onEntity ? setAppliedFilter(next) : setResultsFilter(next)),
    [onEntity, setAppliedFilter, setResultsFilter]
  );
  const appliedNow = useMemo(
    () => appliedTerms(barState, barBase, barState.kind, SORT_TERM_LABELS),
    [barState, barBase]
  );

  /**
   * ▸ FILTERED MEANS "THERE IS A WORD TO SHOW", NOT "THE STATE DIFFERS".
   *
   * This used to be `!isDefault(...)` — and picking a KIND makes the state
   * non-default, so standing on STUDIOS with nothing applied lit the pill accent
   * and crossfaded it to `0 FILTERS` on scroll (Bryan's screenshot, 2026-08-08).
   * Kind is navigation; the one honest test is the same list the bar prints:
   * lit exactly when there is at least one term, dark otherwise. The entity side
   * keeps `isDefault` against ITS OWN baseline — its sheet still owns a FORMAT
   * control, so a non-default state there is a real filter.
   */
  const filtersOn = onEntity ? !isDefault(appliedFilter) : folded && appliedNow.length > 0;
  const pillInk = filtersOn ? NAV_ACCENT : INK;
  /** The ledger numeral for the P-D face — zero-padded like the result rows' own
   *  01 02 03. Null when there is nothing to count ("0 FILTERS" is not a message
   *  anyone needs — Bryan, 2026-08-08 — and neither is "│ 00"). */
  const filterCount =
    filtersOn && appliedNow.length > 0
      ? String(Math.min(appliedNow.length, 99)).padStart(2, "0")
      : null;
  const removeTerm = useCallback(
    (t: AppliedTerm) => writeFilter(t.clear(barState)),
    [writeFilter, barState]
  );
  /** CLEAR returns to the SURFACE'S default, not to a blank object — the results
   *  surface rests on RELEVANCE, and resetting it to the entity default would sort
   *  a result set by release date while claiming nothing was on. */
  const clearFilter = useCallback(
    () => writeFilter({ ...barBase, kind: barState.kind }),
    [writeFilter, barBase, barState.kind]
  );

  /* ── THE SINK. ───────────────────────────────────────────────────────────────
     The bar minimises INTO the pill as you read down the results and comes back
     out when you scroll up. Bryan, choosing this design: "when the user scrolls
     down to review more results, the bar goes into the filter pill at the bottom
     right below it... very smooth and fluid."

     ▸ EVERY NUMBER BELOW IS DERIVED FROM THE SHIPPED GEOMETRY, not tuned.
       The bar rests APPLIED_BAR_GAP above the run, so its centre sits
       `GAP + H/2` = 14 + 19 = 33 above the pill's top edge, and it must travel
       that plus half the nav to land on the pill's centre: 33 + 31 = 64.

     ▸ AND THE SCALE CURVE IS THE NON-CROSSING CONDITION ITSELF.
       Three earlier attempts were rejected: morphing the bar's rect (a layout
       animation every frame — the jitter Bryan feared), a mid-air fade ("a fade
       dissolves the bar in mid-air, so it never visibly enters anything"), and a
       static clip. What he asked for is a real object minimising behind the pill,
       with the rims never seen to cross:
           bar bottom = centre + halfH·scale ≤ pill top
           ⇒ 33·(1) − 64t + 19·scale ≤ 33  ⇒  scale ≤ (33 − 64t) / 19
       So rather than easing the scale and hoping, the scale IS that bound,
       clamped. At t = 0.35 it gives 0.558 — the value the board arrived at by
       measuring. The rims cannot cross, because crossing is the thing the
       function solves for.

     ▸ TRANSFORMS AND OPACITY ONLY, off ONE shared value, on the UI thread. No
       layout, no React, nothing re-rendering mid-gesture. */
  const SINK_TRAVEL = APPLIED_BAR_GAP + APPLIED_BAR_H / 2 + NAV_BAR_H / 2;
  const appliedBarStyle = useAnimatedStyle(() => {
    const t = resultsSink.value;
    const headroom = APPLIED_BAR_GAP + APPLIED_BAR_H / 2 - SINK_TRAVEL * t;
    const scale = Math.max(0.3, Math.min(1, headroom / (APPLIED_BAR_H / 2)));
    return {
      transform: [{ translateY: SINK_TRAVEL * t }, { scale }],
      // The letters go before the shape does — by the time the bar is under the
      // pill it is a blurred sliver, so its words can never compete with FILTER's.
      // Bryan: "it needs to stay as a blur so that it doesn't overlap the whole
      // thing... it should go behind it, not over it."
      opacity: 1 - Math.min(1, t / 0.55),
    };
  });
  /** The two pill labels, handing over on the same clock. The word leaves first and
   *  the count arrives after — they never both read at full strength, so the pill is
   *  never two things at once. */
  const filterWordStyle = useAnimatedStyle(() => ({
    opacity: filtersOn ? 1 - Math.min(1, resultsSink.value / 0.5) : 1,
  }));
  const filterCountStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, (resultsSink.value - 0.5) * 2),
  }));

  // Remember the last real destination, so search knows what to collapse back to.
  useEffect(() => {
    if (current && current in TAB_CONFIG) noteTab(current as TabName);
  }, [current, noteTab]);

  // The field rides the keyboard ITSELF, not a spring aimed at where the keyboard
  // ▸ HOW THIS IS TIED TO THE KEYBOARD — the one thing that has to be right.
  //
  // `keyboardWillShow` / `keyboardWillHide` fire BEFORE iOS moves the keyboard, and
  // they carry the exact duration the system is about to use. Starting our own
  // timing from that event, with that duration and the UIKit keyboard curve, means
  // our animation and the keyboard's begin on the same frame, take the same time and
  // follow the same shape. They are welded because they are the same animation —
  // there is nothing to sample, interpolate, or fall behind.
  //
  // This replaced useAnimatedKeyboard(), which reported the height in jumps here
  // rather than per frame: the island snapped to its destination and snapped back,
  // which is exactly the "appears randomly / pops down" it was doing.
  //
  // Everything runs on the UI thread — the listener only assigns to shared values,
  // so there is no React render anywhere in the transition.
  const kbH = useSharedValue(0); //     live keyboard height, our own animation of it
  const slideP = useSharedValue(0); //  0→1 horizontal placement
  const xP = useSharedValue(0); //      0→1 the ✕
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      const d = e.duration || KB_FALLBACK_MS;
      const ride = { duration: d, easing: KB_EASE };
      kbH.value = withTiming(e.endCoordinates.height, ride);
      slideP.value = withTiming(1, ride);
      xP.value = withTiming(1, { duration: Math.round(d * 0.85), easing: KB_EASE });
      // The pose half. Assigning the same value React already holds is a bail-out,
      // not a render, so keyboards raised on other tabs cost nothing here.
      setSettled(false);
    });
    const hide = Keyboard.addListener(hideEvt, (e) => {
      const d = e?.duration || KB_FALLBACK_MS;
      const ride = { duration: d, easing: KB_EASE };
      // Height and placement ride the keyboard all the way back down; only the ✕
      // is allowed to leave early, because a mark that lingers reads as lag.
      kbH.value = withTiming(0, ride);
      slideP.value = withTiming(0, ride);
      xP.value = withTiming(0, { duration: Math.round(d * 0.45), easing: KB_EASE });
      setSettled(true);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [kbH, slideP, xP]);
  // Pinned KB_GAP above the keyboard's top edge, as a TRANSFORM — never `bottom`.
  const lift = useDerivedValue(() => -Math.max(0, kbH.value + KB_GAP - NAV_BOTTOM));

  // Declared above every useAnimatedStyle that reads it — a worklet captures its
  // closure when the hook runs, so a shared value created below one is captured as
  // `undefined`. See the WORKLET SAFETY note at the top of the file.
  //
  // `grow` is STRUCTURE: search opened, so the pill folds to the seat you came from
  // and the disc becomes a field. The keyboard is the only thing that moves once
  // search is already open, and it moves nothing but transforms.
  //
  // ⚠ THE FOLD IS NOT VISIBLE FROM HERE. A guard of `expanded && entityOpen`
  // looks like "the field is taking the room back from a live page" and is in
  // fact DEAD: foldClosed batches openIsland() and closeOverlay() into one
  // task, so this effect only ever sees the far side — expanded true, page
  // already gone. One shipped round was built on that guard and never ran a
  // frame of what it described. `grow` therefore has exactly one behaviour on
  // every path: spring to the pose. What distinguishes the fold from a plain
  // open is what the PILL does beside it — see filterGrow.
  //
  // ▸ IT ASKS `fieldOpen`, NOT `expanded`. Since the fold, a search can be open
  // while the satellite is a disc — that is the whole results pose. `grow` has
  // only ever meant "the satellite is a field", so it takes the boolean that
  // still means that.
  const grow = useSharedValue(fieldOpen ? 1 : 0);
  useEffect(() => {
    grow.value = withSpring(fieldOpen ? 1 : 0, NAV_SPRING);
  }, [fieldOpen, grow]);

  // `filterGrow` is the FILTER pose's one driver — and since round 9 the island
  // it drives is OUT OF THE FLOW: an absolute box on its own fixed rect, like
  // the ✕ has always been. That is the architecture, not a detail.
  //
  // ▸ WHY THE PILL LEFT THE ROW. In flow, the field's left edge was
  //   `bar + pill + gaps`, so ANY frame where the pill's width was momentarily
  //   wrong moved the FIELD — and near the end of a spring that frame is easy
  //   to come by (a commit lands, Fabric re-solves the pill from its static
  //   pin, Reanimated re-asserts a frame later). Bryan, round 9: "once the
  //   filter button gets out of the way, there's that weird gap that pushes the
  //   search field back to the right... then it snaps back." Rounds 1–8 all
  //   attacked that as a TIMING problem — overlap it, defer it, pin it, snap
  //   it, mirror it. It was a PLUMBING problem. Out of flow, the pill's width
  //   is nobody else's business on any frame, and the discs move on exactly the
  //   geometry they use for the main-nav ↔ search transition — the one Bryan
  //   calls the navigation he is proudest of.
  //
  // ▸ WHAT IT LOOKS LIKE. One line, one behaviour, both directions: spring to
  //   the pose. The pill is shoved aside by whichever disc is claiming the run
  //   (`pushRight`), and the gap between that disc's leading edge and the pill
  //   closes to zero exactly as the pill reaches zero — so the run is never
  //   holed and the two exits read as the same motion, which is what Bryan
  //   asked for. The exits are no longer special cases in this file at all.
  const filterGrow = useSharedValue(filterPose ? 1 : 0);
  // ▸ WHICH WAY THE PILL TRAVELS is not a property of the pill. It is a
  // property of WHICH DISC IS CHANGING SIZE, and the pill keeps its shoulder
  // against that disc in both directions — it grows out of the one that is
  // shrinking, and it retreats ahead of the one that is expanding.
  //
  //   · 0 — THE FIELD IS THE MOVER. The field's left edge is what sweeps, so
  //     the pill plants its LEFT edge on the bar and its right edge travels:
  //     it grows rightward as the field collapses away, and its right edge
  //     retreats leftward as the field expands back.
  //   · 1 — THE BAR IS THE MOVER. The bar's right edge is what sweeps, so the
  //     pill plants its RIGHT edge by the satellite and its left edge travels:
  //     it emerges from under the folding bar and sweeps left, and on the way
  //     out its left edge retreats rightward ahead of the unfolding bar.
  //
  // For an EXIT the mover is named by the pose being entered. For an ARRIVAL it
  // is named by the pose being LEFT — which React has already overwritten by
  // the time this effect runs, hence the ref. Bryan, round 10: arriving back
  // from a main tab, the pill was still growing left-to-right off the bar while
  // the bar itself was folding down into its disc, and the two motions read as
  // fighting each other. Nothing jumps when this flips, because at both ends of
  // a transition `filterGrow` is 0 or 1 and the offset it scales is zero.
  //
  // ▸ THE FOLD ANSWERS THIS RULE WITHOUT AMENDING IT. Settling a search is an
  // arrival whose departing pose had the field open, so the field is the mover
  // and the pill plants its LEFT edge on the bar: its right edge travels right,
  // trailing the field's retreating left edge, and the 14pt island gap between
  // them opens continuously rather than appearing. Tapping the magnifier is the
  // exact mirror. Both fall out of the existing rule once it is asked about the
  // SATELLITE'S SHAPE (`fieldOpen`) rather than about whether a search exists
  // (`expanded`) — which since the fold are two different questions.
  const pushRight = useSharedValue(0);
  const wasFieldOpen = useRef(fieldOpen);
  useEffect(() => {
    const fieldIsMoving = filterPose ? wasFieldOpen.current : fieldOpen;
    wasFieldOpen.current = fieldOpen;
    pushRight.value = fieldIsMoving ? 0 : 1;
    filterGrow.value = withSpring(filterPose ? 1 : 0, NAV_SPRING);
  }, [filterPose, fieldOpen, filterGrow, pushRight]);

  // ▸ THE HANDOVER. There is ONE pill, and while the sheet exists the SHEET is
  // it.
  //
  // The sheet's window is born on this island's exact rect, wearing this
  // island's exact word in this island's exact type — that is the whole premise
  // of the morph. So for as long as the sheet is mounted, this island must not
  // be drawn, or the user is looking at the same object twice. Bryan, on seeing
  // it: "there are two filter buttons appearing, throwing off the entire look."
  // He saw it at BOTH ends, because the bar was crossfading over 260ms while
  // the sheet's own motion ran 340 — so for a quarter of a second the pill was
  // still sitting there underneath the capsule that had just left it.
  //
  // It is a hard 0/1 on `filterOpen`, never a fade: the two rects are identical
  // at the swap frame, so there is nothing to blend and blending is exactly what
  // made two of them visible. React flips this in the SAME COMMIT that mounts
  // and unmounts the sheet, which is what makes the exchange atomic — and the
  // static pin below carries the same value, so even a raced frame that resolves
  // from the static style finds the island already gone.
  const handoff = useSharedValue(0);
  useEffect(() => {
    handoff.value = filterOpen ? 1 : 0;
  }, [filterOpen, handoff]);
  // The bar squeezes for EITHER occupant of the middle room. Sum, not max, and
  // deliberately UNCLAMPED. On the ARRIVAL the two NAV_SPRINGs start the same
  // frame in opposite directions and are exact mirrors — the fall is 1 minus
  // the rise, point for point — so the sum holds at 1 and the bar cannot pump
  // while the field hands the room to the pill. The FOLD HOME is that same
  // mirror in reverse and is frozen for the same reason: the identity holds
  // for any pair that STARTS summing to 1, whatever the springs are doing.
  // The SEAT TAP is the one exit where the bar is meant to move: grow rests at
  // 0 and filterGrow springs 1 → 0, so the sum IS that spring and the bar
  // unfolds to the full labelled pill on the identical curve the search-close
  // uses from any tab. (It was a CUT through round 8, which Bryan overturned in
  // round 9 — "those are the ones that are expanding" — and it is only safe to
  // animate now because the navigation storm it rides can no longer re-solve
  // anything but the bar's own pinned width.) With one
  // driver at rest the sum IS the other spring, overshoot and all, which keeps
  // every single-spring pose byte-identical to what shipped. (A Math.min clamp
  // here was reviewed out: it truncated the field-open spring's own settle, a
  // visible change to a locked pose.)
  const squeeze = useDerivedValue(() => grow.value + filterGrow.value);

  // ONLY Discover shrinks on scroll, and the shrink is reset the moment you
  // leave it — arriving on a tab at its top with a minimized bar was wrong.
  const shrinks = current === "discover" && !expanded;
  useEffect(() => {
    if (!shrinks) progress.value = withSpring(0, NAV_SPRING);
  }, [shrinks, progress]);
  const canShrink = useSharedValue(shrinks ? 1 : 0);
  useEffect(() => {
    canShrink.value = shrinks ? 1 : 0;
  }, [shrinks, canShrink]);
  const shrinkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - SCROLL_SHRINK) * progress.value * canShrink.value }],
  }));

  // ▸ WHERE THE BAR HIDES. The "nav never hides" law holds everywhere else —
  // including over entity pages, which is why the pill draws above the overlay
  // at all — but two full-screen surfaces are not pages you navigate FROM:
  //   · a READER, which Bryan asked to be free of floating targets;
  //   · the FILTER SHEET, which the pill has literally become — the board shows
  //     it with no bar beneath it, and a pill sitting on top of the sheet it
  //     just grew into would be the same object in two places.
  // It fades on the reader's own 260ms clock, the same one the page's back
  // chevron leaves on. Triple-gated (surface open AND a page mounted AND that
  // page on screen) because a bar stuck off-screen is unrecoverable.
  //
  // ▸ The filter gate is `filterCovering`, NOT `filterOpen` — see the context.
  //   The sheet stays MOUNTED through its whole collapse but stops COVERING at
  //   the first frame of it, so the bar is already back underneath while the
  //   bubble is still on its way down to the pill.
  //
  // ▸ GATED ON `filterPose`, NOT ON AN OPEN PAGE. Since increment 3 the sheet can
  // be opened from RESULTS too, where there is no entity at all — and the rule it
  // is enforcing was never about pages, it is "a pill must not sit on top of the
  // sheet it just grew into". That is true wherever the pill lives. `reading`
  // still only ever happens on a page; `filterCovering` now happens on both.
  const navHidden = (reading || filterCovering) && filterPose;
  const hide = useSharedValue(0);
  const wasCovering = useRef(false);
  useEffect(() => {
    // ▸ COMING BACK FROM THE SHEET IS INSTANT, and everything else keeps the
    //   approved 260ms. The sheet is still a full screen at the moment it stops
    //   covering — the bar is completely occluded — so there is nothing to fade
    //   IN front of, and a bar still climbing to full while the bubble lands on
    //   it is precisely the two-state flicker this change exists to kill. By the
    //   time the shrinking bubble uncovers the bar, the bar must already be
    //   whole. A reader is the opposite case: it fades out over the bar, so the
    //   bar must fade in with it, on its clock.
    const uncovered = !navHidden && wasCovering.current;
    wasCovering.current = filterCovering;
    if (uncovered) hide.value = 0;
    else hide.value = withTiming(navHidden ? 1 : 0, { duration: 260 });
  }, [navHidden, filterCovering, hide]);
  const hideStyle = useAnimatedStyle(() => ({ opacity: 1 - hide.value }));

  // VISIBLE BUT INERT while the sheet is still collapsing onto it. The bar has
  // to be there for the bubble to land into; it must not also be a live target
  // mid-flight, because re-opening a sheet that is halfway home is a state
  // nobody designed and the pill would be answering for two things at once.
  const navInert = navHidden || (filterOpen && filterPose);

  // The field slides LEFTWARD into the pill's footprint as the keyboard arrives —
  // a pure transform (see satFloat), so its right edge stays welded to the run's
  // right edge and the ✕ that sits on it does not move a pixel. Anchored to that
  // edge, the field's LEFT edge is the only thing any of this can travel.
  // Width moves ONLY with `grow` — the one-off spring when search opens.
  // Everything the keyboard drives is a transform, so once search is open there is
  // no layout work left at all: no Yoga re-solve, no re-measuring the blur behind
  // the field, nothing on the slow path. That is the difference between this
  // gliding and the marginLeft version stuttering.
  // Deliberately TWO styles rather than one. Reanimated re-runs an animated style
  // only when a shared value it reads has changed, so keeping the layout properties
  // in a style that reads `grow` alone means it stops running the instant search has
  // finished opening. If the width shared a style with the keyboard, it would be
  // re-applied on every frame of every keyboard move — dirtying layout, and
  // re-measuring the blur behind the field, for a value that never changes.
  //
  // Width only. The marginLeft that used to ride alongside it was how a FLOW-laid
  // satellite kept its distance from the pill; anchored to the run's right edge it
  // has no neighbour to measure from, and the gap at every pose now falls out of
  // the run's own width (see runStyle).
  const satLayout = useAnimatedStyle(() => ({
    width: interpolate(grow.value, [0, 1], [SATELLITE, SAT_W_OPEN]),
  }));
  const satFloat = useAnimatedStyle(() => ({
    transform: [{ translateX: -FIELD_SHIFT * slideP.value }, { translateY: lift.value }],
  }));
  const fieldStyle = useAnimatedStyle(() => ({
    width: interpolate(grow.value, [0.2, 1], [0, SAT_W_OPEN - BAR_H], "clamp"),
    opacity: interpolate(grow.value, [0.5, 1], [0, 1], "clamp"),
  }));
  // The surviving seat is the only one rendered while expanded, so it is always
  // index 0 — no lookup, and nothing to re-centre.

  // The run's width IS the pose change. Closed it is REST_W (its contents, the
  // 14pt gap intact); open — field or FILTER — it is the full TOTAL_W between
  // the side insets. One animated number on the container, centred by the
  // wrapper, so the two anchored ends travel to their new places continuously
  // instead of the run snapping between two justifications at a commit.
  const runStyle = useAnimatedStyle(() => ({
    width: interpolate(squeeze.value, [0, 1], [REST_W, TOTAL_W]),
  }));
  // Rides `squeeze`, not `grow`: the bar folds to the disc for the open field
  // AND for the FILTER pose, and stays folded while the middle changes hands.
  const barStyle = useAnimatedStyle(() => ({
    width: interpolate(squeeze.value, [0, 1], [PILL_W_FULL, BAR_H]),
  }));
  // Resolved on the JS thread and captured as a plain number: a worklet cannot
  // call seatShift() (a non-worklet module function) from the UI thread.
  const shift = seatShift(0);
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: squeeze.value * shift }],
  }));
  // The FILTER pill: width opens the room, translateX picks which edge travels,
  // translateY is the rise from below.
  //
  // ⚠ NO SCALE ON THIS ISLAND — NOT EVEN A RESTING 1. This carried a threshold
  // scale as a sliver guard (a bordered zero-width capsule shows a hairline at
  // rest), and it cost the pill its BLUR: Bryan's Chris Evans screenshot has
  // "ENGERS: DOOMSDAY" legible straight through a pill that should have frosted
  // it, while the bar and the satellite either side frosted correctly. Single
  // variable between them — the bar animates no transform and the satellite
  // only translations; this island was the only one carrying a scale, and a
  // UIVisualEffectView under a scaled ancestor stops sampling its backdrop and
  // renders as tint alone. The codebase already knew this in the other
  // direction: EntityScreen STRIPS its BlurViews before folding for exactly
  // this reason, and fix 2 had already downgraded this scale from a ramp to a
  // threshold on the same suspicion. Now it is gone: `opacity` is the sliver
  // guard, same threshold, same constant, and nothing on this island touches
  // the blur's compositing.
  const filterIslandStyle = useAnimatedStyle(() => ({
    width: filterGrow.value * FILTER_W,
    transform: [
      // Anchored at its left edge by default, so shrinking retreats the RIGHT
      // edge; pushRight slides the shrinking box back over so the LEFT edge is
      // what retreats instead. Either way it is the pill's own box moving —
      // out of flow, nothing follows it.
      { translateX: pushRight.value * (1 - filterGrow.value) * FILTER_W },
      { translateY: (1 - filterGrow.value) * FILTER_RISE },
    ],
    // The sliver guard — a hard 0/1 at a sliver-sized width (~7px), where
    // there is nothing to see either way. Not a fade: the ink's own ramp
    // (filterInkStyle) is what makes the pill leave gracefully.
    // Gone outright while the sheet holds this rect — see `handoff`.
    opacity: handoff.value > 0.5 ? 0 : filterGrow.value > 0.03 ? 1 : 0,
  }));
  // The pill's INK — glyph and word — on the SAME ramp the seat labels use, and
  // for the reason stated there: a word that loses letters off both edges while
  // its capsule closes reads as clipping, not as motion. Bryan, round 11: "the
  // text is always there while it's sliding out, which kind of ruins the
  // fluidity." So the ink leaves first and the capsule travels empty; on the way
  // in, the pill opens itself a room before anything is written in it. 0.62 is
  // not a new number — it is the seat label's, so the two labels in this bar
  // vanish at the same point in their own closings.
  const filterInkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(filterGrow.value, [0.62, 1], [0, 1], "clamp"),
  }));
  // The ✕ is OUT OF FLOW — absolutely pinned to the right end of the run. It has no
  // width to animate and no margin to give back, so it cannot push anything or be
  // pushed, and the row's total width is constant by construction rather than by
  // arithmetic that has to be kept balanced. It floats up with the field and scales
  // in and out on its own quick clock.
  const closeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: xP.value }],
  }));
  // The clear mark tracks whether there is a QUERY — not whether the keyboard is up,
  // which is what the dismiss disc's `xP` tracks. Driving a shared value from an
  // effect keeps the animation on the UI thread; assigning to a shared value does not
  // re-render, so the bar is still never re-rendered mid-transition.
  //
  // Scale, not just opacity: this bar's law is that nothing fades on its own —
  // marks reach zero SIZE.
  const clearP = useSharedValue(0);
  useEffect(() => {
    clearP.value = withTiming(query.length > 0 ? 1 : 0, {
      duration: Math.round(KB_FALLBACK_MS * 0.5),
      easing: KB_EASE,
    });
  }, [query.length, clearP]);
  const clearStyle = useAnimatedStyle(() => ({
    opacity: clearP.value,
    transform: [{ scale: clearP.value }],
  }));

  /**
   * THE WAY BACK OUT OF THE FOLDED POSE, and the reason the fold is not a trap.
   * Bryan's magnifier ruling: the right disc always opens the field with the
   * keyboard up, showing whatever query is live — so the query is edited, not
   * retyped, and the ✕ inside the field is reachable again.
   *
   * `settled` is dropped HERE rather than being left to `keyboardWillShow`, and
   * that ordering IS the ruling's "the fold-back finishes before the keyboard
   * rises": the field begins unfolding on the frame of the tap, and the keyboard
   * — which iOS will not even announce for another frame or two — rises under a
   * field already on its way open. Waiting for the keyboard event instead would
   * leave the tap looking unanswered for exactly as long as iOS took to notice
   * it, which is the lag pattern this surface has been burned by before.
   */
  const unfold = () => {
    setSettled(false);
    raiseKeyboard();
  };

  const openSearch = () => {
    // While an entity page is open the disc NEVER opens the field over it.
    // From another tab it returns you to the search tab, where the page is still
    // mounted. ON the search tab it is the page's third door out (Bryan,
    // 2026-08-02): the chevron is a reach on big phones and the edge swipe is a
    // gesture not everyone thinks of, so the disc — already under the thumb —
    // folds the page back into its marquee, the SAME animated exit as both
    // others. The fold's completion re-expands the field via the search screen's
    // falling-edge handler, landing on the query and results exactly as left.
    if (entityOpen) {
      if (current !== "search") router.push("/search");
      else requestFold();
      return;
    }
    open();
    router.push("/search");
  };

  const leaveSearch = (to: string) => {
    Keyboard.dismiss();
    close();
    navigation.navigate(to as never);
  };

  // Squeezed — for the field OR the FILTER pose — the pill carries exactly one
  // seat: the tab you came from.
  const allSeats = state.routes.filter((r) => Boolean(TAB_CONFIG[r.name]));
  // Squeezed, ONLY the seat you came from exists. Keeping the rest mounted so the
  // pill could shrink past them flashed a full row of unlabelled icons for the
  // length of the spring — the reference simply has them gone.
  const squeezed = expanded || onEntity;
  const seats = squeezed ? allSeats.filter((r) => r.name === lastTab) : allSeats;

  return (
    <Animated.View
      style={[styles.wrapper, hideStyle]}
      pointerEvents={navInert ? "none" : "box-none"}
      // Gone from the accessibility tree too, not merely invisible — a screen
      // reader must not offer controls the screen is no longer honouring.
      accessibilityElementsHidden={navInert}
      importantForAccessibility={navInert ? "no-hide-descendants" : "auto"}
    >
      {/* ▸ THE APPLIED-FILTER BAR, above the run it belongs to.
          Its visibility needed NO new condition: `filtersOn` is already exactly
          "this surface is filtered", and the pose that shows the pill is the pose
          that can have filters. Opening the search field flips `folded` off →
          `filterPose` off → the pill leaves, and this leaves with it.
          Rendered inside the wrapper so it is centred on the same column as the
          run, and above it in the flex order so it sits over the nav. */}
      {filtersOn && !filterOpen && (
        <AppliedBar
          terms={appliedNow}
          onRemove={removeTerm}
          onClear={clearFilter}
          width={squeezed ? TOTAL_W : REST_W}
          style={[{ marginBottom: APPLIED_BAR_GAP }, appliedBarStyle]}
        />
      )}
      <Animated.View
        style={[
          styles.islands,
          // Endpoint pin, same law as every island inside it.
          { width: squeezed ? TOTAL_W : REST_W },
          runStyle,
          shrinkStyle,
        ]}
      >
        <Animated.View
          style={[
            styles.bar,
            // Static width PINNED to the pose endpoint, like the FILTER pill's.
            // The bar's only static width used to be AUTO (its seats), so any
            // commit racing the width spring flashed it full-open for a frame.
            // Pinned, a raced frame lands where the spring is headed.
            { width: squeezed ? BAR_H : PILL_W_FULL },
            barStyle,
          ]}
        >
          <BlurView
            intensity={NAV_BLUR_INTENSITY}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[styles.slotRow, rowStyle]}>
            {seats.map((route) => {
              const config = TAB_CONFIG[route.name];
              if (!config) return null;
              const routeIndex = state.routes.findIndex((r) => r.key === route.key);
              // Squeezed (field open or FILTER pose) the surviving seat renders
              // NEUTRAL — Bryan de-blued the filter-nav board himself: the rest
              // pose carries no accent, accent means something is ON. The
              // lastTab clause keeps the label on the full pill for the brief
              // non-entity moments the search route shows it.
              const isFocused =
                !expanded &&
                !onEntity &&
                (state.index === routeIndex ||
                  (current === "search" && route.name === lastTab));
              const onPress = () => {
                // While search is open only the surviving seat is live, and it is
                // the way OUT of search.
                if (expanded) return leaveSearch(route.name);
                // FILTER pose: the seat is the door back to the tab you came
                // from, and it must be a plain navigate — no close() (the query
                // survives) and no fold (the page stays mounted under the other
                // tab, waiting for the search disc to bring you back). Without
                // this branch the focused-seat guard below would swallow the tap
                // and the seat would ship inert.
                if (onEntity) return navigation.navigate(route.name);
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
              };
              return (
                <TabSlot
                  key={route.key}
                  focused={isFocused}
                  config={config}
                  onPress={onPress}
                  hideLabel={squeezed}
                />
              );
            })}
          </Animated.View>
        </Animated.View>

        {/* The FILTER pill — entity pages, and since THE FOLD, search results
            too. OUT OF FLOW on the middle rect, and drawn under both discs —
            it reads as splitting the run open and being shoved back out, but it
            owns no layout, so it can neither push an island nor be pushed by
            one.

            ⚠ ON RESULTS IT IS A POSE, NOT YET A CONTROL. The sheet it opens is
            the ENTITY overlay's, filtering a filmography that is not on screen;
            wiring it to results is increment 3 (the entity FilterSheet reused,
            no count until a filter is on). Until then it is deliberately inert
            there rather than wrong there. */}
        <Animated.View
          style={[
            styles.filterIsland,
            // Static fallback PINNED to the pose's endpoint. If a React commit
            // lands while the width is mid-spring (navigation state, a late
            // context change), Fabric may apply the static style for a frame
            // before Reanimated re-asserts the animated value — with no static
            // width that frame resolves to AUTO (content width) and the island
            // visibly jumps. Pinned, any such frame lands on where the spring
            // is headed anyway. Out of flow, such a frame now costs at most a
            // wrong edge on the pill itself; it used to move the whole run.
            // Pinned to the handover too, for the reason above it: a raced
            // static frame must find the island already handed over, not
            // flash the pill back on top of the sheet that replaced it.
            {
              width: filterPose ? FILTER_W : 0,
              opacity: filterOpen ? 0 : 1,
              borderColor: filtersOn ? NAV_ACCENT_LINE : NAV_GLASS_RIM,
            },
            filterIslandStyle,
          ]}
        >
          {/* ⚠ FIXED SIZE, NOT absoluteFill — this is why the pill had no blur.
              The island's static width is 0 on every screen that is not an
              entity page, so an absoluteFill blur was BORN 0×62 and a
              UIVisualEffectView created at zero size never establishes a
              backdrop; resizing it later does not recover one. It rendered as
              tint alone, which is exactly what Bryan saw reading through it.
              The other two islands never hit this because they mount at real
              widths (the bar at PILL_W_FULL, the satellite at a disc). Born at
              its full rect and never resized, this one samples correctly; the
              island's own `overflow: hidden` does the clipping as the width
              springs, which is what absoluteFill was there for. */}
          <BlurView
            intensity={NAV_BLUR_INTENSITY}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={styles.filterBlur}
          />
          {/* Live since F2. Sized by absoluteFill rather than its own box, so
              the hit area is the capsule itself and shrinks to nothing with it —
              a zero-width pill cannot be tapped by a stray finger at rest.
              Live on BOTH surfaces since increment 3 — `openFilter` only raises
              the sheet's presentation flags, and the search screen decides which
              sheet that flag mounts. */}
          <Pressable
            onPress={openFilter}
            disabled={!filterPose}
            style={styles.filterHit}
            accessibilityRole="button"
            accessibilityLabel={onEntity ? "Filter this filmography" : "Filter these results"}
          >
          <Animated.View style={[styles.filterRow, filterInkStyle]}>
            {/* Three staggered faders — the board's sliders glyph, drawn as
                broken lines so each knob sits IN its track rather than on top
                of it (no fill to fake over the blur). */}
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
            {/* One line, CLIPPED. The ink ramp above now takes the word out
                before the capsule is narrow enough for clipping to show, but
                this stays as the guarantee it always was: the word must never
                wrap into a stacked "FI/LT/ER" (frame-verified in Bryan's
                recording) and never show an ellipsis. */}
            {/* ▸ P-D · THE LEDGER NUMERAL — `FILTER │ 03`, built 2026-08-10.
                Bryan parked this over exactly one fear — "once we start
                developing this... it's gonna be a fucking jitter fest" — and the
                mechanism that retires the fear is the one this slot already had:
                the faces are STATIC LAYERS, absolutely stacked, opacity riding
                the sink's shared value. Nothing is rewritten, re-measured or
                re-laid-out mid-spring; the count face exists whole before the
                sink ever moves. P-C's `3 FILTERS` face is what it replaces.
                Board values verbatim (P · THE SUNK PILL, row P-D): hairline
                1×18 in accent at 0.3, numeral in the result rows' own voice —
                mono REGULAR, zero-padded — 12px tracked 0.1em, 12 gap. The
                word keeps the shipped filterLabel; rest pose unchanged. */}
            <View style={styles.filterWordSlot}>
              {/* ▸ AN INVISIBLE ROW SIZES THE SLOT to the wider of the two faces,
                  and both visible faces sit absolute over it. Mechanism named on
                  attempt three of the clipped count: Yoga shrink-fits an
                  offsetless absolute child to its PARENT'S width, so an absolute
                  face inside a slot sized by the lone word clips to FILTER's
                  width — `3 FILT` on device, twice. The wider face sizes the
                  slot, in flow; opacity 0 does that without ever being seen.
                  Width changes only when the term count appears, leaves, or
                  gains a digit — discrete renders, never mid-sink. */}
              <View style={[styles.filterFace, styles.filterSizer]}>
                <Text style={styles.filterLabel} numberOfLines={1}>
                  FILTER
                </Text>
                {filterCount !== null && <View style={styles.filterDivider} />}
                {filterCount !== null && (
                  <Text style={styles.filterCount} numberOfLines={1}>
                    {filterCount}
                  </Text>
                )}
              </View>
              <Animated.Text
                style={[styles.filterLabel, styles.filterOverlay, { color: pillInk }, filterWordStyle]}
                numberOfLines={1}
              >
                FILTER
              </Animated.Text>
              {filterCount !== null && (
                <Animated.View style={[styles.filterFaceOverlay, filterCountStyle]}>
                  <Text style={[styles.filterLabel, { color: pillInk }]} numberOfLines={1}>
                    FILTER
                  </Text>
                  <View style={styles.filterDivider} />
                  <Text style={styles.filterCount} numberOfLines={1}>
                    {filterCount}
                  </Text>
                </Animated.View>
              )}
            </View>
          </Animated.View>
          </Pressable>
        </Animated.View>

        {/* The satellite. Collapsed it is a disc; expanded it is the search field. */}
        <Animated.View
          style={[
            styles.satellite,
            // Bryan's board rule: on an entity page none of the three islands
            // wears the accent — the rest pose is neutral, accent means ON.
            //
            // And on that page it now wears NOTHING extra at all. It used to
            // keep satelliteOn's deeper, faintly blue glass with the accent rim
            // handed back, which made it the only island in the run mixed to a
            // different recipe — the bar and the FILTER pill read as thinner
            // next to it (Bryan, round 12: "the FILTER doesn't match the same
            // blurred effect... let's keep that consistent"). One glass, one
            // rim, every island, every pose; the ON state below is the single
            // exception, and it means something.
            //
            // ⚠ `!filterPose`, not `!onEntity` — ruling ① says the results pose
            // is IDENTICAL to an entity page, and the neutrality is half of what
            // makes it identical. A run of three islands is where accent stops
            // meaning "you are here" and starts meaning "a filter is on"; the
            // FILTER pill standing beside it is what tells you where you are.
            onSearch && !filterPose && styles.satelliteOn,
            // Endpoint pin, same reason as the bar's: the satellite's static
            // width was AUTO (the magnifier), so a commit racing the width
            // spring collapsed the open field to a disc for a frame — the
            // field's half of the frame-verified fold jitter.
            //
            // ⚠ MUST BE `fieldOpen`. `expanded` stays true through the folded
            // pose, so pinned to it this would advertise a full-width field
            // while the animated style held a disc — a raced commit would flash
            // the field back open over the FILTER pill, which is precisely the
            // class of bug these pins exist to make impossible.
            { width: fieldOpen ? SAT_W_OPEN : SATELLITE },
            satLayout,
            satFloat,
          ]}
        >
          <BlurView
            intensity={NAV_BLUR_INTENSITY}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            style={styles.satRow}
            accessibilityRole="button"
            accessibilityLabel={
              fieldOpen ? "Search" : folded ? "Edit search" : "Open search"
            }
            onPress={fieldOpen ? raiseKeyboard : folded ? unfold : openSearch}
          >
            {/* Small and quiet, sitting inside the field — the magnifier is the
                field's mark, not a button of its own. */}
            <View style={styles.glyphSlot}>
              <Ionicons
                name="search"
                size={GLYPH_SM}
                color={onSearch && !filterPose ? ACCENT : INACTIVE}
              />
            </View>

            <Animated.View style={[styles.fieldWrap, fieldStyle]}>
              {expanded && (
                <TextInput
                  // Changing the key REMOUNTS the field, which is what makes
                  // autoFocus fire again and the keyboard present. Zero on entry, so
                  // arriving on the tab never raises it (FR-6).
                  key={focusToken}
                  autoFocus={focusToken > 0}
                  ref={inputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search films"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  style={[styles.field, styles.fieldWithClear]}
                  autoCorrect={false}
                  returnKeyType="search"
                  // The Search key was a dead affordance until now. Submitting drops
                  // the keyboard (the nav's keyboard-DOWN pose) and raises the event
                  // the results screen listens for; it does not touch the query, so
                  // the field keeps showing what was searched.
                  onSubmitEditing={() => {
                    Keyboard.dismiss();
                    submitQuery();
                  }}
                />
              )}

              {/* CLEAR QUERY (FR-2). Inside the field at its right edge — the
                  universal position; every OS puts clear-text in the field itself.
                  Deliberately not ringed or filled, so it never mimics the dismiss
                  disc sitting a few pixels to its right.

                  GLYPH LAW: × always means ERASE. The dismiss control next to it is
                  a chevron-down, which always means COLLAPSE / PUT AWAY. Two
                  near-identical ×s would have made "wipe my text" and "hide the
                  keyboard" look like the same button.

                  ⚠ DIVERGES FROM THE BOARD, DELIBERATELY (Bryan, 2026-07-30).
                  The boards hide this whenever the keyboard is down, borrowing the
                  dismiss disc's rule. In use that costs two taps to start a new
                  search — focus the field, THEN clear — for a query that is sitting
                  right there. Clearing and dismissing are different intents, so they
                  no longer share a visibility rule: this tracks the QUERY, the disc
                  tracks the KEYBOARD. Pressing it wipes the text and opens the
                  keyboard, so the next search is one tap away. */}
              {expanded && (
                <Animated.View
                  style={[styles.clearWrap, clearStyle]}
                  // Rendered even with no query so it can animate OUT; inert until
                  // there is something to erase.
                  pointerEvents={query.length > 0 ? "auto" : "none"}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={8}
                    style={styles.clearHit}
                    onPress={() => {
                      setQuery("");
                      // Clear AND be ready to type, in one tap. See raiseKeyboard —
                      // a bare focus() does nothing here, because the input still
                      // believes it is focused after the keyboard was dismissed.
                      raiseKeyboard();
                    }}
                  >
                    <Svg width={15} height={15} viewBox="0 0 15 15">
                      <Path
                        d="M3.6 3.6L11.4 11.4M11.4 3.6L3.6 11.4"
                        stroke="#8A8279"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        fill="none"
                      />
                    </Svg>
                  </Pressable>
                </Animated.View>
              )}
            </Animated.View>

          </Pressable>
        </Animated.View>

        {/* The ✕ is its own round island, outside the field. It is present for as
            long as search is open and rides up with the field — it is the anchor
            the field expands away from, so it must never move horizontally. */}
        <Animated.View style={[styles.close, closeStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
            onPress={() => {
              inputRef.current?.blur();
              Keyboard.dismiss();
            }}
            style={styles.closeHit}
          >
            {/* CHEVRON-DOWN, not an ×. The × now lives inside the field and means
                erase; this means put the keyboard away. One directional language for
                "close" across the whole search surface — it also rhymes with the
                chevron-up that collapses an open film marquee. */}
            <Svg width={GLYPH_SM} height={GLYPH_SM} viewBox="0 0 18 18">
              <Path
                d="M4 6.75L9 11.75L14 6.75"
                stroke={INK}
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

export default function TabsLayout() {
  return (
    <NavMorphProvider>
      <SearchIslandProvider>
      <Tabs tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false }}>
        {/* Declaration order IS the order of seats in the pill. Slates sits last
            on purpose: its label is the shortest, so any slack it leaves falls at
            the end of the bar instead of opening a hole mid-row. */}
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
        <Tabs.Screen name="index" options={{ title: "Universe" }} />
        <Tabs.Screen name="discover" options={{ title: "Discover" }} />
        <Tabs.Screen name="slate" options={{ title: "Slates" }} />
        <Tabs.Screen name="search" options={{ title: "Search" }} />
      </Tabs>
      </SearchIslandProvider>
    </NavMorphProvider>
  );
}

const styles = StyleSheet.create({
  /** Holds the two crossfading pill labels on one baseline. The count is absolute so
   *  it cannot widen the row as it arrives — a pill that resized mid-sink would be
   *  the layout animation this whole approach exists to avoid.
   *
   *  ⚠ NO left/right ON THE COUNT. Stretched to the slot, it was clipped to the
   *  width the word FILTER had measured — `2 FILTERS` rendered as `2 FILT` on
   *  device (Bryan, 2026-08-08). With no offsets, Yoga sizes an absolute child to
   *  its own content and places it by the parent's alignment, so the count centres
   *  on the word's centre and overflows the slot harmlessly — the pill is 206 wide
   *  and clips nothing. */
  filterWordSlot: { justifyContent: "center", alignItems: "center" },
  /** In flow, never seen — exists only to give the slot the wider face's width. */
  filterSizer: { opacity: 0 },
  /** The lone word stretches the sized slot and centres in it. */
  filterOverlay: { position: "absolute", left: 0, right: 0, textAlign: "center" },
  /** One P-D face: word │ numeral. Board gap, verbatim. */
  filterFace: { flexDirection: "row", alignItems: "center", gap: 12 },
  /** The face's absolute twin — same row, centred over the slot. */
  filterFaceOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  /** Board: 1×18, accent at 0.3. Only ever rendered beside a live count, so the
   *  accent is unconditional. */
  filterDivider: { width: 1, height: 18, backgroundColor: accentAlpha(0.3) },
  /** The result rows' own numeral voice: mono REGULAR (the word is medium),
   *  12px tracked 0.1em (board), accent — a count only exists when filtered. */
  filterCount: {
    color: NAV_ACCENT,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    letterSpacing: 1.2,
  },
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    // Fixed. The keyboard lift is a transform on the field and the ✕ only, so the
    // pill stays down here at rest and the keyboard simply covers it.
    bottom: NAV_BOTTOM,
    alignItems: "center",
    zIndex: 100,
  },
  // ▸ THE RUN. Every island in it is now OUT OF FLOW and anchored to one of its
  // edges — bar to the left, satellite and ✕ to the right, FILTER pill to a
  // fixed offset. Nothing is laid out relative to anything else, so no island's
  // width is any other island's position, on any frame.
  //
  // What changed: this used to be an AUTO-width row centred by the wrapper,
  // where the sum of the children WAS the horizontal position of all of them.
  // One frame of a wrong width — a raced commit re-solving a mid-spring island
  // from its static pin — slid the whole run sideways and slid it back. Rounds
  // 1–9 of the exit jitter were all that mechanism wearing different clothes.
  //
  // The run's own WIDTH carries the pose change instead (see runStyle), which
  // is the honest place for it: the closed bar wants REST_W, the open field and
  // the FILTER pose want TOTAL_W, and one animated number moves between them
  // while the wrapper keeps the whole thing centred.
  islands: {
    height: BAR_H,
  },
  // Anchored to the run's LEFT edge. It grows and shrinks rightward from there
  // and its width is nobody else's business.
  //
  // ▸ PAINT ORDER (bar 1, satellite 1, ✕ 2, pill 0 by default). The two discs
  // draw OVER the FILTER pill, so on a seat tap the expanding bar SWALLOWS it
  // — its leading edge passes over the pill while the pill slides away and
  // shrinks, instead of two sheets of glass overlapping into a dark patch. The
  // ✕ outranks the field it sits on, as it always has.
  bar: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: BAR_H,
    paddingHorizontal: BAR_PAD,
    borderRadius: BAR_RADIUS,
    overflow: "hidden",
    // Tint over the blur; also the graceful fallback if blur is unavailable.
    backgroundColor: NAV_GLASS_TINT,
    borderWidth: 1,
    borderColor: NAV_GLASS_RIM,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
  },
  slot: {
    height: "100%",
    justifyContent: "center",
  },
  slotPressable: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    // The glyph is anchored, NOT centred. Centring re-solves the layout on every
    // frame while the slot's width springs, and that drift is the icon jitter.
    // The label lane is a fixed width with the word centred inside it, so short
    // words still read balanced without anything moving.
    paddingLeft: (SLOT_W - ICON) / 2,
  },
  bubble: {
    position: "absolute",
    left: 3,
    right: 3,
    top: (BAR_H - BUBBLE_H) / 2 - 1,
    height: BUBBLE_H,
    borderWidth: 1,
  },
  glyphBox: {
    width: ICON,
    height: ICON,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphLayer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
  },
  quarter: {
    position: "absolute",
  },
  labelWrap: {
    overflow: "hidden",
  },
  tabLabel: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  // Anchored to the run's RIGHT edge, under the ✕ that shares it. The field
  // therefore expands and collapses LEFTWARD from a right edge that cannot
  // move — which is the whole fix for "a gap pushed the search field back to
  // the right and it snapped back".
  satellite: {
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
    height: SATELLITE,
    borderRadius: SATELLITE / 2,
    overflow: "hidden",
    justifyContent: "center",
    backgroundColor: NAV_GLASS_TINT,
    borderWidth: 1,
    borderColor: NAV_GLASS_RIM,
  },
  satelliteOn: {
    borderColor: "rgba(156, 202, 223, 0.38)",
    backgroundColor: "rgba(24, 34, 40, 0.55)",
  },
  // OUT OF FLOW, on the exact rect the entity pose gives it: bar disc + gap in
  // from the run's left edge, its own FILTER_W, so the row's two real islands
  // are laid out as if it did not exist. See filterGrow for why.
  filterIsland: {
    position: "absolute",
    left: BAR_H + ISLAND_GAP,
    top: 0,
    height: BAR_H,
    borderRadius: BAR_RADIUS,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: NAV_GLASS_TINT,
    borderWidth: 1,
    borderColor: NAV_GLASS_RIM,
  },
  // Content-sized and centred, and it never resizes — the capsule's width
  // springs around it while the row itself holds still and fades (filterInkStyle).
  // Laying the ink out once means nothing inside the pill is on the layout path
  // during a transition; the clip is only a backstop now.
  filterBlur: {
    position: "absolute",
    left: 0,
    top: 0,
    width: FILTER_W,
    height: BAR_H,
  },
  filterHit: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  filterLabel: {
    color: INK,
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 12,
    letterSpacing: 1.68,
  },
  satRow: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
  },
  glyphSlot: {
    width: BAR_H,
    alignItems: "center",
    justifyContent: "center",
  },
  // Pinned to the right end of the run and out of the flex flow entirely, so it can
  // neither move anything nor be moved by anything. `right: 0` puts it exactly where
  // the field's right edge sits before the field slides left out from under it.
  close: {
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 2,
    width: CLOSE_W,
    height: CLOSE_W,
    borderRadius: CLOSE_W / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 15, 20, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  closeHit: {
    width: CLOSE_W,
    height: CLOSE_W,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldWrap: {
    overflow: "hidden",
    justifyContent: "center",
  },
  field: {
    color: "#fff",
    fontSize: 15,
    padding: 0,
  },
  // Space for the clear mark is reserved WHENEVER the field is open, not only while
  // a query exists — otherwise the text would shift sideways the moment you typed
  // your first character and again when you cleared it.
  fieldWithClear: {
    paddingRight: CLEAR_INSET + CLEAR_BOX,
  },
  // Absolutely placed so it sits at the field's right edge without joining the flex
  // run — the field's animated width is locked geometry and must not be divided.
  clearWrap: {
    position: "absolute",
    right: CLEAR_INSET,
    width: CLEAR_BOX,
    height: CLEAR_BOX,
    alignItems: "center",
    justifyContent: "center",
  },
  clearHit: {
    width: CLEAR_BOX,
    height: CLEAR_BOX,
    alignItems: "center",
    justifyContent: "center",
  },
});
