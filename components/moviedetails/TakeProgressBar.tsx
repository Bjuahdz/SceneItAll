import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";

import { INK_RED } from "./ticketTheme";

// The surviving ACID palette — the lime hatched bar is the one acid element that
// made it through the ticket redesign. Deliberate literals, NOT ticket tokens.
const ACID_LIME = "#D6F32F";
const ACID_INK = "#0E0E10";

const TRACK_HEIGHT = 16;
const HATCH_STEP = 8; // px between diagonal hatch lines
const TICK_COUNT = 5;

interface TakeProgressBarProps {
  /** 0–100. Width animates (~600ms) whenever this changes. */
  percent: number;
  /** Failed takes: recolors the stalled fill red. */
  error?: boolean;
}

/**
 * The lime hatched progress bar — a full-pill track with a hard-edged acid fill.
 * Diagonal dark hatching is drawn once across the full track width (measured via
 * onLayout, never hardcoded) and revealed by the fill's clip, so the lines stay
 * put while the width animates. Small ticks pace out the empty remainder.
 */
export default function TakeProgressBar({ percent, error = false }: TakeProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const [trackW, setTrackW] = useState(0);

  const p = useSharedValue(clamped);
  useEffect(() => {
    p.value = withTiming(clamped, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [clamped, p]);

  const fillStyle = useAnimatedStyle(() => ({ width: (p.value / 100) * trackW }), [trackW]);

  // The hatch FLOWS while the take is genuinely in flight — a conveyor of
  // diagonals drifting in the direction of progress. One step of travel loops
  // seamlessly because the pattern's period IS the step. Stalled (error) and
  // finished bars hold still.
  const flowing = !error && clamped > 0 && clamped < 100;
  const flow = useSharedValue(0);
  useEffect(() => {
    if (!flowing) {
      flow.value = 0;
      return;
    }
    flow.value = 0;
    flow.value = withRepeat(withTiming(1, { duration: 520, easing: Easing.linear }), -1, false);
  }, [flowing, flow]);
  const hatchStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: flow.value * HATCH_STEP }],
  }));

  // X origins for bottom-left → top-right hatch segments spanning the whole track,
  // padded one step past each edge so the drifting window never uncovers a gap.
  const hatch = useMemo(() => {
    if (trackW <= 0) return [];
    const xs: number[] = [];
    for (let x = -TRACK_HEIGHT - HATCH_STEP; x < trackW + HATCH_STEP; x += HATCH_STEP) xs.push(x);
    return xs;
  }, [trackW]);

  return (
    <View
      style={styles.track}
      onLayout={(e) => setTrackW(Math.round(e.nativeEvent.layout.width))}
    >
      <Animated.View
        style={[styles.fill, error && styles.fillError, clamped === 0 && styles.fillEmpty, fillStyle]}
      >
        {clamped > 0 && trackW > 0 && (
          <Animated.View style={[StyleSheet.absoluteFill, hatchStyle]} pointerEvents="none">
            <Svg width={trackW + HATCH_STEP * 2} height={TRACK_HEIGHT} style={styles.hatchSvg}>
              {hatch.map((x) => (
                <Line
                  key={x}
                  x1={x}
                  y1={TRACK_HEIGHT}
                  x2={x + TRACK_HEIGHT}
                  y2={0}
                  stroke={ACID_INK}
                  strokeWidth={2}
                  strokeOpacity={0.45}
                />
              ))}
            </Svg>
          </Animated.View>
        )}
      </Animated.View>

      {/* Ticks pace out the empty remainder only — the fill pushes them along. */}
      <View style={styles.remainder} pointerEvents="none">
        {Array.from({ length: TICK_COUNT }, (_, i) => (
          <View key={i} style={styles.tick} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "stretch",
  },
  fill: {
    backgroundColor: ACID_LIME,
    // Hard 2px dark leading edge on the acid fill.
    borderRightWidth: 2,
    borderRightColor: ACID_INK,
    overflow: "hidden",
  },
  fillError: {
    backgroundColor: INK_RED,
  },
  fillEmpty: {
    borderRightWidth: 0,
  },
  // The drifting hatch sheet — anchored one step left so the loop never uncovers.
  hatchSvg: {
    position: "absolute",
    left: -HATCH_STEP,
    top: 0,
  },
  remainder: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  tick: {
    width: 1,
    height: 6,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
});
