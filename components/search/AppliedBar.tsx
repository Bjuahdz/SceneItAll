// ─────────────────────────────────────────────────────────────────────────────
// THE APPLIED-FILTER BAR — what is currently on, sitting above the FILTER pill.
//
// Bryan chose this over four alternatives (F-A…F-E) for one reason: it is a SCROLL
// EVENT. It rides above the nav at rest and sinks into the pill as you read down the
// results, which is increment 11; this file is the bar at rest.
//
// ▸ WORDS, NOT BUBBLES. Every term is a tappable word between hairlines, because a
// row of pills below a row of pills (the kind row) would be two competing chip
// languages on one screen. Tapping a word removes exactly that control — each term
// carries its own `clear`, so nothing here switches on a key.
//
// ▸ IT SCROLLS, IT DOES NOT WRAP. Bryan on the two-row version: "absolutely
// horrible." Nor does it truncate to `+3 MORE`, which names a number instead of the
// thing you would want to remove.
//
// ▸ AND IT MUST NOT CUT A WORD IN HALF. The track is sized so at least four whole
// terms show, and the fades at either end are the only thing that says there is more
// — subtle enough never to obscure a letter, which was the explicit brief.
// ─────────────────────────────────────────────────────────────────────────────
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { SIGNAL } from "@/constants/signal";
import {
  NAV_BLUR_INTENSITY,
  NAV_GLASS_TINT,
} from "@/constants/navMetrics";
import type { AppliedTerm } from "@/constants/filterBands";

/** 38 tall on a 62 nav — read as a lighter object of the same family, not a second
 *  nav bar. The radius is exactly half, so it is a capsule like everything else. */
export const APPLIED_BAR_H = 38;
const BAR_R = APPLIED_BAR_H / 2;
/** How far above the nav run the bar rests. */
export const APPLIED_BAR_GAP = 14;

const FADE_W = 22;

/** A hairline between two terms. Dimmer than the pin below, because it separates
 *  peers; the pin separates the list from the verb that empties it. */
function Divider({ tall = false }: { tall?: boolean }) {
  return <View style={[styles.divider, tall ? styles.dividerPin : styles.dividerPeer]} />;
}

export default function AppliedBar({
  terms,
  onRemove,
  onClear,
  width,
  style,
}: {
  terms: AppliedTerm[];
  onRemove: (t: AppliedTerm) => void;
  onClear: () => void;
  /** The nav run's width — the bar spans it, so the two read as one column. */
  width: number;
  style?: any;
}) {
  const scrollX = useSharedValue(0);
  const maxX = useSharedValue(0);

  const onScroll = useCallback(
    (e: any) => {
      scrollX.value = e.nativeEvent.contentOffset.x;
      const { contentSize, layoutMeasurement } = e.nativeEvent;
      maxX.value = Math.max(0, contentSize.width - layoutMeasurement.width);
    },
    [scrollX, maxX]
  );

  // The fades are driven by position, not by "is it scrollable" — a fade that is
  // always on lies about there being more to the left when you are already at 0.
  const leftFade = useAnimatedStyle(() => ({ opacity: Math.min(1, scrollX.value / 12) }));
  const rightFade = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, maxX.value - scrollX.value) / 12),
  }));

  if (terms.length === 0) return null;

  return (
    // ▸ THE BAR HUGS ITS TERMS (Bryan, 2026-08-08: "a dynamic bar growing with how
    // many elements are active"). Width is a CEILING, not a size — one term is a
    // small capsule, four fill the run, more than fits scrolls behind the fades.
    // The wrapper centres it, so it grows symmetrically from the middle.
    <Animated.View style={[styles.bar, { maxWidth: width }, style]}>
      <BlurView
        intensity={NAV_BLUR_INTENSITY}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={styles.blur}
      />
      <View style={styles.inner}>
        <View style={styles.trackWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={styles.track}
            // ⚠ RN's horizontal ScrollView ships `flexGrow: 1` in its BASE style,
            // which inflated the track to the width ceiling however few terms it
            // held — the bar went full-run with a dead gap before CLEAR, which is
            // the "way off-center" Bryan photographed. Grow 0 is what makes the
            // capsule actually hug.
            style={styles.trackScroller}
          >
            {terms.map((t, i) => (
              <React.Fragment key={t.key}>
                {i > 0 && <Divider />}
                {/* ▸ NO PER-TERM PADDING — the board spaces EVERYTHING on one
                    gap of 10, and that density is exactly what read as premium
                    in Paper next to the airy version on device. The touch
                    target is hitSlop's job, not the layout's. */}
                <Pressable
                  onPress={() => onRemove(t)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove filter ${t.label}`}
                  hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
                >
                  <Text style={styles.termText} numberOfLines={1}>
                    {t.label}
                  </Text>
                </Pressable>
              </React.Fragment>
            ))}
          </ScrollView>

          {/* Masked, not painted — a solid scrim over the glass reads as a black
              block (learned the hard way on the F-series boards). */}
          <Animated.View pointerEvents="none" style={[styles.fade, styles.fadeLeft, leftFade]}>
            <LinearGradient
              colors={[SIGNAL.ground, "transparent"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.fade, styles.fadeRight, rightFade]}>
            <LinearGradient
              colors={["transparent", SIGNAL.ground]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>

        <Divider tall />
        {/* THE WORD, NOT AN ✕. An ✕ beside a row of removable words would be a
            second, louder remove button with a different scope — CLEAR says what it
            does and cannot be mistaken for "remove the last one". */}
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          hitSlop={{ top: 12, bottom: 12, left: 4, right: 8 }}
        >
          <Text style={styles.clearText}>CLEAR</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

/* ── EVERY NUMBER BELOW IS OFF THE BOARD (`15JU-0`, read with get_computed_styles
   2026-08-08, after two rounds of approximating it): bar h38 · r19 · paddingInline
   14 · ONE GAP OF 10 spacing everything · terms mono 500 · 11 · 0.05em · INK ·
   peer divider 1×14 #F2EDE438 · pin 1×24 #F2EDE459 · CLEAR mono 400 · 9 · 0.14em ·
   MUTED · and the rim is THE ACCENT RIM #9CCADF80 — this bar only exists when the
   surface is filtered, and it wears the same lit rim the FILTER pill does. */
const styles = StyleSheet.create({
  bar: {
    height: APPLIED_BAR_H,
    borderRadius: BAR_R,
    borderWidth: 1,
    borderColor: "#9CCADF80",
    backgroundColor: NAV_GLASS_TINT,
    paddingHorizontal: 14,
    overflow: "hidden",
    // Hug the terms; the wrapper's alignItems centres the capsule on the column.
    alignSelf: "center",
  },
  blur: { ...StyleSheet.absoluteFillObject },
  inner: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  /** Sizes to its terms and SHRINKS first when the ceiling bites, so CLEAR is never
   *  pushed off by a long list — the track scrolls instead. */
  trackWrap: { flexShrink: 1, height: "100%", overflow: "hidden" },
  trackScroller: { flexGrow: 0, flexShrink: 1 },
  /** ⚠ AN EXPLICIT HEIGHT, NOT "100%". A percentage height inside a ScrollView's
   *  content container has nothing to resolve against — the container's height IS
   *  being measured from its children — so it collapsed to the text and the whole
   *  row pinned to the capsule's top (Bryan's screenshot, 2026-08-08). A number
   *  gives `alignItems: center` a box to centre in. 36 = bar 38 minus its border. */
  track: { flexDirection: "row", alignItems: "center", height: APPLIED_BAR_H - 2, gap: 10 },
  termText: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.55, // 0.05em at 11px — HALF what two rounds of memory used
    color: SIGNAL.ink,
  },
  divider: { width: 1 },
  dividerPeer: { height: 14, backgroundColor: "#F2EDE438" },
  dividerPin: { height: 24, backgroundColor: "#F2EDE459" },
  clearText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 9,
    lineHeight: 15,
    letterSpacing: 1.26, // 0.14em at 9px
    color: SIGNAL.muted,
  },
  fade: { position: "absolute", top: 0, bottom: 0, width: FADE_W },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
});
