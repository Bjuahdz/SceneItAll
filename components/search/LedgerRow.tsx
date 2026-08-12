import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import EntryStar from "./EntryStar";
import { ChevronDown } from "./glyphs";
import { FONT, ROW, SEARCH_LAYOUT, SIGNAL, TRACK, TRACK2 } from "@/constants/signal";

// A CLOSED row in the recents ledger. Taller than a result row (68 vs 62) because
// this list is short, deliberate, and the only thing on the default screen — it can
// afford the air.
//
// Anatomy: [index 20][title + meta, flex 1][14px marker][13px chevron]
// The chevron is DOWN because tapping opens the row here; it becomes UP inside the
// marquee, which closes it. One directional language across the surface.

interface Props {
  index: number;
  title: string;
  meta: string;
  hasEntry?: boolean;
  onPress: () => void;
  /** The rule under the marquee must still read, so the row directly beneath an
   *  open item carries a top border — and it moves as the open index moves. */
  showTopBorder?: boolean;
  isLast?: boolean;
}

export default function LedgerRow({
  index,
  title,
  meta,
  hasEntry = false,
  onPress,
  showTopBorder,
  isLast,
}: Props) {
  return (
    <Pressable
      style={[styles.row, showTopBorder && styles.topBorder, isLast && styles.noBottom]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta.replace(/ · /g, ", ")}.${
        hasEntry ? " You have an entry." : ""
      } Opens a preview.`}
    >
      <Text style={styles.index}>{String(index).padStart(2, "0")}</Text>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title.toUpperCase()}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>

      <View style={styles.marker}>{hasEntry ? <EntryStar /> : null}</View>
      <ChevronDown />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: SEARCH_LAYOUT.rowGap,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
    paddingVertical: 8,
  },
  topBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: SIGNAL.line },
  noBottom: { borderBottomWidth: 0 },
  index: {
    width: SEARCH_LAYOUT.indexWidth,
    flexShrink: 0,
    color: ROW.index,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.index11,
  },
  body: { flex: 1, gap: 4 },
  title: {
    color: ROW.titleEntry,
    fontFamily: FONT.display,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: TRACK2.title18,
  },
  meta: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: TRACK.micro10,
  },
  marker: {
    width: SEARCH_LAYOUT.markerWidth,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
