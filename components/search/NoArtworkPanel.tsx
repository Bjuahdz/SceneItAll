import React from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";

import { ChevronRight, ChevronUp } from "./glyphs";
import { FONT, MARQUEE, ROW, SEARCH_LAYOUT, SIGNAL, TRACK, TRACK2 } from "@/constants/signal";

// What an expanded item becomes when there is NO artwork to open into.
//
// This is not an edge case — 80% of a film's crew have no photo, plenty of
// collections have no backdrop, and studios have no usable imagery at all. The
// panel keeps the open-state identity and the CTA while refusing to fake a picture:
// no placeholder poster, no initials avatar, no empty frame. Design contract 7.
//
// Same width and 16px radius as the marquee so the list geometry does not lurch,
// but it is a hairline box on bare ground and its height collapses to fit.

// The content column — identical rule to Marquee's, so an artworkless row and a
// marquee occupy exactly the same span. See MARQUEE in constants/signal.ts.
const CARD_W = Dimensions.get("window").width - SEARCH_LAYOUT.padH * 2;

interface Props {
  index: number;
  typeTag?: string;
  title: string;
  facts: string;
  ctaLabel: string;
  onPressCollapse: () => void;
  onPressCta: () => void;
}

export default function NoArtworkPanel({
  index,
  typeTag,
  title,
  facts,
  ctaLabel,
  onPressCollapse,
  onPressCta,
}: Props) {
  return (
    <View style={styles.wrap}>
      {/* Whole panel is the tap target, exactly like the marquee — the behaviour
          must not change just because there is no artwork to show. */}
      <Pressable
        style={styles.panel}
        onPress={onPressCta}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${facts}. ${ctaLabel}`}
      >
        <View style={styles.topRow}>
          <Text style={styles.index}>{String(index).padStart(2, "0")}</Text>
          {typeTag ? <Text style={styles.typeTag}>{typeTag}</Text> : null}
          <View style={styles.spacer} />
          <Pressable
            onPress={onPressCollapse}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Collapse ${title}`}
          >
            <ChevronUp color={SIGNAL.muted} />
          </Pressable>
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {title.toUpperCase()}
        </Text>

        {/* The same bottom lane as the marquee — facts left, verb right, one
            baseline. An artworkless row must not compose itself differently. */}
        <View style={styles.lane}>
          <Text style={styles.facts} numberOfLines={1}>
            {facts}
          </Text>
          {/* A label, not a button — the panel handles the press. */}
          <View style={styles.cta} importantForAccessibility="no">
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
            <ChevronRight />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: MARQUEE.padTop, paddingBottom: MARQUEE.padBottom },
  panel: {
    width: CARD_W,
    borderRadius: MARQUEE.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SIGNAL.line,
    paddingHorizontal: MARQUEE.inset,
    paddingVertical: MARQUEE.insetTop,
    gap: 8,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  spacer: { flex: 1 },
  index: {
    color: SIGNAL.muted,
    fontFamily: FONT.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK2.marqueeIndex,
  },
  typeTag: {
    color: SIGNAL.muted,
    fontFamily: FONT.monoMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: TRACK2.tag9,
  },
  title: {
    color: ROW.titleOpen,
    fontFamily: FONT.display,
    fontSize: 25,
    lineHeight: 26,
    letterSpacing: TRACK2.marquee25,
  },
  lane: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 2 },
  facts: {
    flex: 1, // yields to the verb, exactly as on the marquee
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: TRACK.micro10,
  },
  cta: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  ctaLabel: {
    color: SIGNAL.ink,
    fontFamily: FONT.monoMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: TRACK2.tag9,
  },
});
