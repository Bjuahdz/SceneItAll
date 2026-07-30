import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

// A prismatic light-band sweep — the "something waits here" cue. Not a flat white
// flash: the band is feathered and carries faint spectral edges (rose → white → ice),
// moving slowly, like light walking across brushed glass. An absolute overlay that
// never takes touches.
//
// THE HOST OWNS THE CLIP, and it no longer has to be overflow:hidden. Its one caller is
// CaptureWell's first-run sheen, which clips with a MaskedView instead — this stack will
// not reliably contain a transformed child inside overflow:hidden, but a mask clips by
// alpha and does. Rendered BEFORE the recesses there, so the light passes behind the hole.
export default function ShimmerSweep({
  travel = 420,
  band = 130,
  period = 5200,
}: {
  travel?: number; // px the band walks (cover the widest host)
  band?: number; // band width
  period?: number; // full cycle incl. rest, ms
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1 }), // reset so each cycle sweeps again
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.cubic) }),
        withTiming(1, { duration: Math.max(0, period - 2200) }) // rest
      ),
      -1,
      false
    );
    // An infinite repeat outlives the component otherwise — this one is unmounted the
    // moment its host stops needing it.
    return () => cancelAnimation(p);
  }, [p, period]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(p.value, [0, 1], [-band - 40, travel]) },
      { rotate: "24deg" },
    ],
  }));

  return (
    <Animated.View style={[styles.host, { width: band }, style]} pointerEvents="none">
      <LinearGradient
        colors={[
          "rgba(255,255,255,0)",
          "rgba(255,190,205,0.09)", // rose edge
          "rgba(255,255,255,0.18)", // soft white core
          "rgba(190,225,255,0.10)", // ice edge
          "rgba(255,255,255,0)",
        ]}
        locations={[0, 0.3, 0.5, 0.7, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: -24,
    bottom: -24,
    left: 0,
  },
});
