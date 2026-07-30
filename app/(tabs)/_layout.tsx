import React, { useEffect, useRef } from "react";
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
  NAV_BAR_R,
  NAV_BLUR_INTENSITY,
  NAV_BOTTOM,
  NAV_BUBBLE_H,
  NAV_GLASS_RIM,
  NAV_GLASS_TINT,
  NAV_ICON,
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

// ⚠ WORKLET SAFETY — read before editing any useAnimatedStyle in this file.
// Animated styles run on the UI thread. They may ONLY use: shared values, plain
// arithmetic, Math.*, and Reanimated helpers (interpolate, withSpring). Calling
// any ordinary function from inside one — px(), seatShift(), a formatter — throws
// at runtime and crashes the app on launch. tsc CANNOT catch it. Precompute the
// value into a constant outside the hook and close over that instead.
// Verify after editing:  npm run check:worklets

const ACCENT = "#9ccadf";
const INACTIVE = "rgba(255, 255, 255, 0.85)";

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
// Collapsed the pill is three seats and one label; expanded it is a single
// circle, so its width is a real number at both ends and can be sprung.
const PILL_W_FULL = BAR_PAD * 2 + SLOT_W * 4 + LABEL_W_MAX + LABEL_GAP;
// Search open, keyboard down: the field runs from the pill all the way to the right
// margin. Nothing is reserved for the ✕ — an empty slot sitting there before there
// is any keyboard to dismiss just reads as a hole in the bar.
const SAT_W_OPEN = TOTAL_W - BAR_H - ISLAND_GAP_OPEN;
// The keyboard then slides the field left by exactly the pill's footprint, and the
// ✕ opens into the space that leaves on the right. Equal and opposite: the row's
// total width is identical at both ends AND every frame between, which is what
// keeps the bar from wandering sideways while it happens.
const FIELD_SHIFT = BAR_H + ISLAND_GAP_OPEN;
// Air between the bottom of the field and the top of the keyboard.
const KB_GAP = 10;
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
  const { expanded, query, lastTab, setQuery, noteTab, open, close } = useSearchIsland();
  const { progress } = useNavMorph();
  // No `typing` state. Nothing about this bar needs React to know the keyboard is
  // up — the keyboard drives the motion directly on the UI thread. A state flip
  // here re-rendered the whole tab bar mid-transition for nothing.
  const inputRef = useRef<TextInput>(null);

  const current = state.routes[state.index]?.name;
  // Search is a destination like any other: when you are on it, it wears the
  // accent — the island is the only thing telling you where you are.
  const onSearch = current === "search" || expanded;
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
    });
    const hide = Keyboard.addListener(hideEvt, (e) => {
      const d = e?.duration || KB_FALLBACK_MS;
      const ride = { duration: d, easing: KB_EASE };
      // Height and placement ride the keyboard all the way back down; only the ✕
      // is allowed to leave early, because a mark that lingers reads as lag.
      kbH.value = withTiming(0, ride);
      slideP.value = withTiming(0, ride);
      xP.value = withTiming(0, { duration: Math.round(d * 0.45), easing: KB_EASE });
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
  const grow = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    grow.value = withSpring(expanded ? 1 : 0, NAV_SPRING);
  }, [expanded, grow]);

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

  // The field grows LEFTWARD into the pill's footprint as the keyboard arrives. The
  // width gain and the negative margin are the same number, so the satellite's
  // contribution to the row is unchanged and the ✕ slot to its right does not move a
  // pixel — only the field's left edge travels. The islands row is centre-aligned,
  // which means the row's TOTAL width is a horizontal position for everything in it:
  // hold the total constant and nothing can drift sideways. That is the whole trick.
  // Width and margin move ONLY with `grow` — the one-off spring when search opens.
  // Everything the keyboard drives is a transform, so once search is open there is
  // no layout work left at all: no Yoga re-solve, no re-measuring the blur behind
  // the field, nothing on the slow path. That is the difference between this
  // gliding and the marginLeft version stuttering.
  // Deliberately TWO styles rather than one. Reanimated re-runs an animated style
  // only when a shared value it reads has changed, so keeping the layout properties
  // in a style that reads `grow` alone means it stops running the instant search has
  // finished opening. If width and marginLeft shared a style with the keyboard, they
  // would be re-applied on every frame of every keyboard move — dirtying layout, and
  // re-measuring the blur behind the field, for values that never change.
  const satLayout = useAnimatedStyle(() => ({
    width: interpolate(grow.value, [0, 1], [SATELLITE, SAT_W_OPEN]),
    marginLeft: interpolate(grow.value, [0, 1], [ISLAND_GAP, ISLAND_GAP_OPEN]),
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

  const barStyle = useAnimatedStyle(() => ({
    width: interpolate(grow.value, [0, 1], [PILL_W_FULL, BAR_H]),
  }));
  // Resolved on the JS thread and captured as a plain number: a worklet cannot
  // call seatShift() (a non-worklet module function) from the UI thread.
  const shift = seatShift(0);
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: grow.value * shift }],
  }));
  // The ✕ is OUT OF FLOW — absolutely pinned to the right end of the run. It has no
  // width to animate and no margin to give back, so it cannot push anything or be
  // pushed, and the row's total width is constant by construction rather than by
  // arithmetic that has to be kept balanced. It floats up with the field and scales
  // in and out on its own quick clock.
  const closeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: xP.value }],
  }));

  const openSearch = () => {
    open();
    router.push("/search");
  };

  const leaveSearch = (to: string) => {
    Keyboard.dismiss();
    close();
    navigation.navigate(to as never);
  };

  // Expanded, the pill carries exactly one seat: the tab you came from.
  const allSeats = state.routes.filter((r) => Boolean(TAB_CONFIG[r.name]));
  // Expanded, ONLY the seat you came from exists. Keeping the rest mounted so the
  // pill could shrink past them flashed a full row of unlabelled icons for the
  // length of the spring — the reference simply has them gone.
  const seats = expanded ? allSeats.filter((r) => r.name === lastTab) : allSeats;

  return (
    <Animated.View style={styles.wrapper} pointerEvents="box-none">
      <Animated.View style={[styles.islands, expanded && styles.islandsOpen, shrinkStyle]}>
        <Animated.View style={[styles.bar, barStyle]}>
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
              const isFocused = !expanded && state.index === routeIndex;
              const onPress = () => {
                // While search is open only the surviving seat is live, and it is
                // the way OUT of search.
                if (expanded) return leaveSearch(route.name);
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
                  hideLabel={expanded}
                />
              );
            })}
          </Animated.View>
        </Animated.View>

        {/* The satellite. Collapsed it is a disc; expanded it is the search field. */}
        <Animated.View
          style={[styles.satellite, onSearch && styles.satelliteOn, satLayout, satFloat]}
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
            accessibilityLabel={expanded ? "Search" : "Open search"}
            onPress={expanded ? () => inputRef.current?.focus() : openSearch}
          >
            {/* Small and quiet, sitting inside the field — the magnifier is the
                field's mark, not a button of its own. */}
            <View style={styles.glyphSlot}>
              <Ionicons name="search" size={GLYPH_SM} color={onSearch ? ACCENT : INACTIVE} />
            </View>

            <Animated.View style={[styles.fieldWrap, fieldStyle]}>
              {expanded && (
                <TextInput
                  ref={inputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search films"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  style={styles.field}
                  autoCorrect={false}
                  returnKeyType="search"
                />
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
            <Ionicons name="close" size={GLYPH_SM} color={INACTIVE} />
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
  islands: {
    flexDirection: "row",
    alignItems: "center",
  },
  bar: {
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
  islandsOpen: {
    width: TOTAL_W,
    justifyContent: "flex-start",
  },
  satellite: {
    marginLeft: ISLAND_GAP,
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
});
