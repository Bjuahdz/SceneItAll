import React, { useEffect } from "react";
import { Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSpring,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";

const RED = "#ef4444";
const BADGE_HEIGHT = 36;

/**
 * Recording status readout, top-right — a bare readout (no glass bubble: it isn't a
 * button, so it shouldn't dress like one). Text-shadowed for legibility over posters:
 *   arming    → GET READY
 *   recording → ● LIVE  (the dot breathes)
 *   paused    → ❚❚ PAUSED
 *
 * STATE ONLY — no clock, no count. Elapsed time rides above the capture pill, and the
 * pre-roll's 3·2·1 belongs to the full-screen overlay in the middle of the page, which
 * is the thing you are actually looking at while it runs. Counting down up here as well
 * made the header read as a second, competing timer.
 *
 * This badge renders inside the top bar's row (in the star's slot), so it folds with
 * the chevron and the title instead of floating over them.
 *
 * Layer split on purpose: the OUTER view owns the enter/exit layout animation and the
 * static position (`style`); the INNER view owns the animated scroll-fold (`animatedStyle`)
 * + pop. Combining them on one view made Reanimated warn that the layout animation could
 * overwrite the animated opacity.
 */
export default function CaptureStatusBadge({
  paused,
  arming,
  style,
  animatedStyle,
}: {
  paused: boolean;
  /** True while the get-ready pre-roll runs. The count itself lives in the overlay. */
  arming?: boolean;
  style?: any;
  animatedStyle?: any;
}) {
  const pulse = useSharedValue(1);
  const pop = useSharedValue(1);

  useEffect(() => {
    pop.value = 0.96;
    pop.value = withSpring(1, { damping: 11, stiffness: 260, mass: 0.55 });

    if (!paused) {
      pulse.value = withRepeat(withTiming(0.3, { duration: 700 }), -1, true);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 150 });
    }
    return () => cancelAnimation(pulse);
  }, [paused, pop, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={[styles.host, style]}>
      <Animated.View style={[styles.content, popStyle, animatedStyle]}>
        {arming ? null : paused ? (
          <Ionicons name="pause" size={13} color="rgba(255,255,255,0.92)" style={styles.iconShadow} />
        ) : (
          <Animated.View style={[styles.dot, dotStyle]} />
        )}
        <Text
          style={[
            styles.label,
            arming ? styles.labelArming : paused ? styles.labelPaused : styles.labelLive,
          ]}
        >
          {arming ? "GET READY" : paused ? "PAUSED" : "LIVE"}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    height: BADGE_HEIGHT,
    justifyContent: "center",
    alignItems: "flex-end", // hugs the screen's right edge cleanly
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RED,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    includeFontPadding: false,
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  iconShadow: {
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  labelArming: {
    color: "rgba(255,255,255,0.72)",
  },
  labelLive: {
    color: RED,
  },
  labelPaused: {
    color: "rgba(255,255,255,0.9)",
  },
});
