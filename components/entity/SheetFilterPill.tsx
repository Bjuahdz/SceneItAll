import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import Svg, { Path } from "react-native-svg";

import {
  NAV_BAR_H,
  NAV_BAR_R,
  NAV_BLUR_INTENSITY,
  NAV_FILTER_RECT,
  NAV_GLASS_RIM,
  NAV_GLASS_TINT,
} from "@/constants/navMetrics";
import { SIGNAL } from "@/constants/signal";
import { FOLD_MS, GROW_MS } from "./EntityScreen";

/**
 * THE FILTER PILL, FOR AN ENTITY PAGE INSIDE A MOVIE SHEET.
 *
 * The nav bar owns the pill everywhere else, but the nav lives in the tabs
 * layout — buried under the sheet route — so a person page reached by drilling
 * through a film's cast had no way to filter a filmography at all. That gap was
 * shipped knowingly and Bryan closed it (2026-08-13): "the bare minimum is
 * allowing someone to go through the filter pill at least."
 *
 * ▸ ONLY THE PILL. No destinations, no seat disc, no search disc: none of them
 *   mean anything three sheets deep, and the nav's "never hides" law is about
 *   the nav, not about this. One control, one job.
 *
 * ▸ IT RISES, IT DOES NOT MORPH (his ruling on the entrance). On the search
 *   surface the pill is the nav CHANGING POSE — the discs trade the middle room
 *   away and the pill grows into it — and that motion is meaningless here,
 *   because there are no discs to trade with. So it simply comes up from below,
 *   centred, into the same seat it occupies everywhere else.
 *
 * ▸ IT LANDS ON NAV_FILTER_RECT, which is DERIVED rather than measured (see
 *   navMetrics). That is what makes this cheap: the filter sheet grows out of
 *   that exact rect, so mounting the sheet here needs no origin plumbing and
 *   cannot drift from the nav's version by a pixel.
 *
 * Deliberately NOT a reuse of the nav's pill. That one is welded to pose
 * springs, an ink ramp and a ledger sink that exist to survive morphing between
 * three layouts; none of it has meaning for a control that only ever rises and
 * falls. What IS shared is the material — every colour, radius and metric here
 * comes from navMetrics, so the two pills cannot drift apart.
 */

const INK = "#F2EDE4";
const ACCENT = SIGNAL.accent;
const ACCENT_LINE = "rgba(156, 202, 223, 0.5)";

/** How far below its seat the pill starts. A little under half its own height:
 *  far enough to read as arriving from off-screen, near enough that the rise
 *  never looks like it travelled. */
const RISE = 26;

/** ▸ IT MOVES ON THE PAGE'S CLOCK, NOT ITS OWN. The pill borrows the grow and
 *  fold durations from EntityScreen rather than keeping numbers beside them —
 *  a control that arrives on a different curve from the thing it belongs to
 *  reads as two events, which is exactly what Bryan saw ("mistimed... make it
 *  so that the entity page and the filter button happen at the same time").
 *  The page eases in-out cubic both ways; so does this. */

export default function SheetFilterPill({
  visible,
  filtered,
  onPress,
}: {
  /** The page's own motion says so — raised on the grow's first frame, dropped
   *  the moment a fold commits. NOT merely "a page is mounted": the overlay
   *  mounts several beats before it visibly moves (it measures its origin
   *  first), and rising on the mount put the pill on screen while the page was
   *  still a card. */
  visible: boolean;
  /** The filmography is currently filtered — the pill says so, same as the
   *  nav's does, by taking the accent on its rim and its glyph. */
  filtered: boolean;
  onPress: () => void;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(visible ? 1 : 0, {
      duration: visible ? GROW_MS : FOLD_MS,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [visible, p]);

  // Transform-only, and an EMPTY transform once seated: the pill is a blur, and
  // glass under a live transform is this app's oldest scar.
  const style = useAnimatedStyle(() => {
    if (p.value === 1) return { opacity: 1, transform: [] };
    return { opacity: p.value, transform: [{ translateY: (1 - p.value) * RISE }] };
  });

  const ink = filtered ? ACCENT : INK;

  return (
    <Animated.View
      pointerEvents={visible ? "box-none" : "none"}
      style={[styles.seat, style]}
    >
      <View style={[styles.pill, { borderColor: filtered ? ACCENT_LINE : NAV_GLASS_RIM }]}>
        {/* Born at its full rect and never resized — a visual-effect view
            created at zero size never establishes a backdrop, which is the bug
            the nav's own pill carries a paragraph about. */}
        <BlurView
          intensity={NAV_BLUR_INTENSITY}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          onPress={onPress}
          disabled={!visible}
          style={styles.hit}
          accessibilityRole="button"
          accessibilityLabel="Filter this filmography"
        >
          <View style={styles.row}>
            {/* The board's sliders glyph — three staggered faders, drawn as
                broken lines so each knob sits IN its track. Same path data as
                the nav's, because it is the same control. */}
            <Svg width={17} height={17} viewBox="0 0 17 17">
              <Path
                d="M2 4.25H8.5M12.5 4.25H15M2 8.5H3.5M7.5 8.5H15M2 12.75H7M11 12.75H15"
                stroke={ink}
                strokeWidth={1.4}
                strokeLinecap="round"
                fill="none"
              />
              <Path
                d="M10.5 2.25a2 2 0 100 4 2 2 0 000-4ZM5.5 6.5a2 2 0 100 4 2 2 0 000-4ZM9 10.75a2 2 0 100 4 2 2 0 000-4Z"
                stroke={ink}
                strokeWidth={1.4}
                fill="none"
              />
            </Svg>
            <Text style={[styles.label, { color: ink }]}>FILTER</Text>
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The nav's own derived rect, so the sheet that grows out of it needs no
  // origin plumbing and the two pills cannot land in different places.
  seat: {
    position: "absolute",
    left: NAV_FILTER_RECT.x,
    top: NAV_FILTER_RECT.y,
    width: NAV_FILTER_RECT.width,
    height: NAV_BAR_H,
    // ABOVE THE PAGE. The overlay host declares zIndex 2000, so tree order
    // alone loses and the pill was drawn under the very page it filters. The
    // filter sheet sits at 2500, which is the order that matters: page, then
    // its pill, then the sheet the pill opens.
    zIndex: 2200,
    elevation: 2200,
  },
  pill: {
    flex: 1,
    borderRadius: NAV_BAR_R,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: NAV_GLASS_TINT,
    borderWidth: 1,
  },
  hit: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  label: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 12,
    letterSpacing: 1.68,
  },
});
