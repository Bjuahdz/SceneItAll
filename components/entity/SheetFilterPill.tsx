import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import Svg, { Path } from "react-native-svg";

import {
  NAV_BAR_H,
  NAV_BAR_R,
  NAV_BLUR_INTENSITY,
  NAV_FILTER_RECT,
  NAV_FILTER_RISE,
  NAV_FILTER_W,
  NAV_GLASS_RIM,
  NAV_GLASS_TINT,
} from "@/constants/navMetrics";
import { NAV_SPRING } from "@/contexts/NavMorphContext";
import { SIGNAL } from "@/constants/signal";

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
 * ▸ IT PERFORMS THE NAV PILL'S OWN ENTRANCE. The first cut was a fade + rise on
 *   the page's timing curve, and Bryan called it: "super boring and bland — we
 *   want it to look like it's a bubble expanding into its location, similar to
 *   how we have it looking in other locations." The other location IS the nav's
 *   FILTER pill (_layout.tsx), and its entrance is a recipe, copied here move
 *   for move:
 *
 *   · WIDTH opens the room — the capsule swells from nothing on NAV_SPRING,
 *     the same spring every nav morph rides, so the two pills arrive with the
 *     same character. The nav's swells from an edge because it splits a run of
 *     islands open; this one is alone and centred, so it swells from its
 *     CENTRE — translateX walks the box back by half the missing width, which
 *     pins the capsule's midpoint to the seat's on every frame.
 *   · THE RISE from below — NAV_FILTER_RISE, the nav's own number, now shared
 *     from navMetrics so the two entrances cannot drift apart.
 *   · INK ARRIVES LAST — the glyph and word fade in over the top of the swell
 *     ([0.62, 1], the nav's seat-label ramp), so the pill opens itself a room
 *     before anything is written in it. On the way out the ink leaves FIRST
 *     and the capsule travels empty — a word losing letters off both edges
 *     reads as clipping, not motion (Bryan, nav round 11).
 *
 * ▸ THE EXIT IS A CUT, NOT A TRANSITION (Bryan's ruling, 2026-08-13, after
 *   two rounds of tuning the collapse): "you're keeping this collapsed exit...
 *   there's really no need for that. Just get rid of it fast." An exit does
 *   not owe the entrance a reverse performance — the page is leaving and the
 *   eye is on it, so anything the pill does with SHAPE on the way out reads
 *   as an object hanging around. It now fades out whole, in place, in EXIT_MS,
 *   and the bubble clock resets silently for the next entrance.
 *
 * ▸ ⚠ NO SCALE, EVER. The bubble is a WIDTH animation because the nav pill
 *   proved the alternative: a scale on that island cost it its blur (a
 *   UIVisualEffectView under a scaled ancestor stops sampling its backdrop and
 *   renders as tint alone — Bryan's Chris Evans screenshot). Translations are
 *   proven safe; scale is the one transform glass cannot wear.
 *
 * ▸ IT LANDS ON NAV_FILTER_RECT, which is DERIVED rather than measured (see
 *   navMetrics). That is what makes this cheap: the filter sheet grows out of
 *   that exact rect, so mounting the sheet here needs no origin plumbing and
 *   cannot drift from the nav's version by a pixel.
 *
 * Deliberately NOT a reuse of the nav's pill component. That one is welded to
 * pose springs and a sheet-handoff ledger that exist to survive morphing
 * between three layouts. What IS shared is the material and the choreography —
 * every colour, radius, metric, spring and ramp here comes from navMetrics /
 * NavMorphContext or is quoted from _layout.tsx with its reasoning.
 */

const INK = "#F2EDE4";
const ACCENT = SIGNAL.accent;
const ACCENT_LINE = "rgba(156, 202, 223, 0.5)";

/** The cut. Fast enough to read as gone-at-once against the page's own fold,
 *  slow enough not to strobe — a hard 0ms pop reads as a glitch, not a cut. */
const EXIT_MS = 120;

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
  const grow = useSharedValue(0);
  // The cut's own clock: 0 = present, 1 = cut away. Separate from `grow` so
  // the exit never touches the bubble's shape — the pill fades out WHOLE.
  const out = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      // A cancelled swipe (or any return) fades the pill back in fast; the
      // first entrance is a no-op here (out is already 0) and the bubble
      // spring below carries the arrival.
      out.value = withTiming(0, { duration: EXIT_MS });
      grow.value = withSpring(1, NAV_SPRING);
    } else {
      // THE CUT — see the header. Shape untouched; once the fade lands, the
      // bubble clock resets silently so the next entrance blooms from zero.
      out.value = withTiming(1, { duration: EXIT_MS }, (finished) => {
        if (finished) grow.value = 0;
      });
    }
  }, [visible, grow, out]);

  // The bubble. Width opens the room, translateX keeps the swell centred,
  // translateY is the rise from below. Opacity is a SLIVER GUARD, not a fade —
  // a hard 0/1 at a sliver-sized width, because a bordered zero-width capsule
  // shows a hairline at rest (the nav pill's constant, same threshold) — and
  // the CUT multiplies over the top of whatever the bubble is doing.
  //
  // Seated, the branch collapses to an EMPTY transform: the pill is a blur,
  // and glass under a live transform is this app's oldest scar. Springs snap
  // to their target on settle, so the branch does engage.
  const capsuleStyle = useAnimatedStyle(() => {
    if (grow.value === 1)
      return { width: NAV_FILTER_W, opacity: 1 - out.value, transform: [] };
    return {
      width: grow.value * NAV_FILTER_W,
      opacity: (grow.value > 0.03 ? 1 : 0) * (1 - out.value),
      transform: [
        { translateX: ((1 - grow.value) * NAV_FILTER_W) / 2 },
        { translateY: (1 - grow.value) * NAV_FILTER_RISE },
      ],
    };
  });

  // The ink rides the seat-label ramp quoted above. It never moves: the
  // centre-pinned swell keeps the capsule's midpoint fixed, so the row centred
  // inside it holds still while the clip edges open around it.
  const inkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(grow.value, [0.62, 1], [0, 1], "clamp"),
  }));

  const ink = filtered ? ACCENT : INK;

  return (
    <View pointerEvents={visible ? "box-none" : "none"} style={styles.seat}>
      <Animated.View
        style={[
          styles.pill,
          // Static width PINNED to the pose endpoint, like the nav pill's: if
          // a React commit lands mid-spring, Fabric may apply the static style
          // for a frame before Reanimated re-asserts — unpinned, that frame
          // resolves to AUTO and the capsule visibly jumps.
          {
            width: visible ? NAV_FILTER_W : 0,
            borderColor: filtered ? ACCENT_LINE : NAV_GLASS_RIM,
          },
          capsuleStyle,
        ]}
      >
        {/* ⚠ FIXED SIZE, NOT absoluteFill — the nav pill's blur lesson. This
            capsule is born at width 0, and a visual-effect view created at
            zero size never establishes a backdrop; resizing it later does not
            recover one. Born at its full rect and never resized, it samples
            correctly, and the capsule's own overflow clips it as the width
            springs. */}
        <BlurView
          intensity={NAV_BLUR_INTENSITY}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.blur}
        />
        {/* absoluteFill, so the hit area is the capsule itself and shrinks to
            nothing with it — a zero-width pill cannot be tapped by a stray
            finger at rest. */}
        <Pressable
          onPress={onPress}
          disabled={!visible}
          style={styles.hit}
          accessibilityRole="button"
          accessibilityLabel="Filter this filmography"
        >
          <Animated.View style={[styles.row, inkStyle]}>
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
          </Animated.View>
        </Pressable>
      </Animated.View>
    </View>
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
    position: "absolute",
    left: 0,
    top: 0,
    height: NAV_BAR_H,
    borderRadius: NAV_BAR_R,
    overflow: "hidden",
    backgroundColor: NAV_GLASS_TINT,
    borderWidth: 1,
  },
  blur: {
    position: "absolute",
    left: 0,
    top: 0,
    width: NAV_FILTER_W,
    height: NAV_BAR_H,
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
