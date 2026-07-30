/**
 * FillGlyph — an outlined mark that FILLS from its base as its seat turns on.
 *
 * The outline is always there; a solid copy rises up through it. A fill, not a crossfade —
 * nothing in this app's bars fades.
 *
 * Built from TRANSFORMS ONLY. The window is a fixed size-tall clip: slide it down and the
 * solid copy is hidden, slide it back up and the mark is revealed from its base. The copy
 * inside counter-slides by exactly the same amount, so the mark itself never moves on
 * screen — only the window over it does. That is what makes it read as filling rather than
 * rising.
 *
 * This used to animate the clip's HEIGHT, which was wrong twice over: it is the slow layout
 * path, and it left the box with no height of its own, so on any frame the animated style
 * was not applied the box sized to its content and the solid mark flashed in at FULL. That
 * flash is the drain-fill-drain the old version had on the way out.
 *
 * ONE COMPONENT, EVERY FILLING MARK. The Slates tab's bookmark and the movie floor's slate
 * and trailer seats all use it. They were separate implementations of the same twelve lines
 * and would have drifted.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { NAV_ICON } from '@/constants/navMetrics';
import { TICKET_ACCENT } from '@/components/moviedetails/ticketTheme';

export default function FillGlyph({
  /** 0 = hollow outline, 1 = filled. Drive it with a spring. */
  focus,
  /** Ionicons name for the hollow state, e.g. "bookmark-outline". */
  outline,
  /** Ionicons name for the solid state, e.g. "bookmark". */
  solid,
  /** Colour of the OUTLINE. */
  color,
  /** Colour of the fill that rises through it. */
  fillColor = TICKET_ACCENT,
  size = NAV_ICON,
}: {
  focus: SharedValue<number>;
  outline: keyof typeof Ionicons.glyphMap;
  solid: keyof typeof Ionicons.glyphMap;
  color: string;
  fillColor?: string;
  size?: number;
}) {
  const clipStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: size * (1 - focus.value) }],
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -size * (1 - focus.value) }],
  }));

  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <Ionicons name={outline} size={size} color={color} />
      {/* Bottom-anchored clip window over the solid copy. Fixed size — it is MOVED, never
          resized. The static transforms are the RESTING (empty) state on purpose: if an
          animated style ever fails to apply for a frame, this reads empty rather than
          flashing a full mark. */}
      <Animated.View
        style={[styles.clip, { width: size, height: size, transform: [{ translateY: size }] }, clipStyle]}
        pointerEvents="none"
      >
        <Animated.View
          style={[styles.inner, { height: size, transform: [{ translateY: -size }] }, innerStyle]}
        >
          <Ionicons name={solid} size={size} color={fillColor} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  clip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    justifyContent: 'center',
  },
});
