import React from "react";
import { View, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";

/**
 * Minimal hold-to-record countdown: a single large number that pops on each tick, over a
 * light dim for legibility. Mounted only while a take is arming (the 3s hold).
 */
export default function CaptureCountdownOverlay({ secondsLeft }: { secondsLeft: number }) {
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root]}
      entering={FadeIn.duration(140)}
      exiting={FadeOut.duration(220)}
      pointerEvents="none"
    >
      <View style={styles.dim} />
      <View style={styles.center}>
        <Animated.Text key={secondsLeft} entering={ZoomIn.duration(220)} style={styles.number}>
          {secondsLeft}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 2000, // above the top bar (1000) and the pill
    alignItems: "center",
    justifyContent: "center",
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  number: {
    color: "#fff",
    fontSize: 120,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
});
