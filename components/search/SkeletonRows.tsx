import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { SEARCH_LAYOUT, SIGNAL } from "@/constants/signal";

// Loading state, FR-4: SKELETONS, NOT A SPINNER.
//
// A spinner says "something is happening somewhere". A skeleton at the real row
// geometry says "results are coming, and here is the shape they will take" — so
// when they land, nothing moves. That only works if the bars sit on the actual
// lanes, which is why every measurement here comes from SEARCH_LAYOUT rather than
// being eyeballed: same 62px row, same 20px index lane, same 14px gaps, same
// hairline. The title bar is 19px tall because the title is 19/24.
//
// One shared opacity drives every row — a per-row animation would shimmer out of
// phase and read as noise. Opacity only, so nothing re-lays-out while it breathes.

export default function SkeletonRows({ count = 5 }: { count?: number }) {
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [pulse]);

  const breathe = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View accessibilityLabel="Loading results" accessibilityRole="progressbar">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.row, i === count - 1 && styles.rowLast]}>
          <Animated.View style={[styles.index, breathe]} />
          <View style={styles.body}>
            {/* Varying widths so the block does not read as a table of identical
                bars — real titles are not all the same length. */}
            <Animated.View style={[styles.title, { width: `${72 - (i % 3) * 14}%` }, breathe]} />
            <Animated.View style={[styles.meta, breathe]} />
          </View>
          {/* The right lane's ghost — result rows carry their year there now (the
              old trailing marker slot died with the 2026-08-12 star grammar). */}
          <Animated.View style={[styles.year, breathe]} />
        </View>
      ))}
    </View>
  );
}

const bar = { backgroundColor: SIGNAL.surface2, borderRadius: 2 } as const;

const styles = StyleSheet.create({
  row: {
    minHeight: SEARCH_LAYOUT.rowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: SEARCH_LAYOUT.rowGap,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
    paddingVertical: 8,
  },
  rowLast: { borderBottomWidth: 0 },
  index: { ...bar, width: SEARCH_LAYOUT.indexWidth, height: 11, flexShrink: 0 },
  body: { flex: 1, gap: 6 },
  title: { ...bar, height: 19 },
  meta: { ...bar, height: 10, width: "38%" },
  year: { ...bar, width: 40, height: 10, flexShrink: 0 },
});
