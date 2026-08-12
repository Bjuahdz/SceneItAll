import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { FONT, ROW, SIGNAL, TRACK } from "@/constants/signal";

// The hairline-ruled label bar above every list on the search surface:
// HOW IT WORKS / RECENT / MATCHING RECORDS / RELEASED / UPCOMING / THE COLLECTION /
// ONE PICK / DID YOU MEAN.
//
// Two alignments, both real and both on the boards:
//   spread — label left, count hard right   (MATCHING RECORDS · 1265 FOUND)
//   inline — label and count grouped left    (RECENT  05)
//
// A cross-board audit could not derive the rule behind the right-hand grey, which
// ships as #4A453F on some boards and #5C5651 on others. Rather than invent one,
// `rightTone` exposes both and each caller states which the board it came from used.

interface Props {
  label: string;
  right?: string;
  align?: "spread" | "inline";
  /** Accent marks a section that is about the user's own data. */
  accentLabel?: boolean;
  rightTone?: "dim" | "dimmer";
  /** Collection/studio sheets sit 20 down; person and no-artwork sit 16. */
  paddingTop?: number;
}

export default function SectionHeader({
  label,
  right,
  align = "spread",
  accentLabel = false,
  rightTone = "dimmer",
  paddingTop = 16,
}: Props) {
  return (
    <View
      style={[
        styles.bar,
        { paddingTop },
        align === "inline" ? styles.inline : styles.spread,
      ]}
    >
      <Text style={[styles.label, accentLabel && styles.labelAccent]}>{label}</Text>
      {right ? (
        <Text style={[styles.right, rightTone === "dim" ? styles.rightDim : styles.rightDimmer]}>
          {right}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
  },
  spread: { justifyContent: "space-between" },
  inline: { justifyContent: "flex-start", gap: 12 },
  label: {
    color: SIGNAL.muted,
    fontFamily: FONT.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
  labelAccent: { color: SIGNAL.accent },
  right: {
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
  rightDim: { color: ROW.index },
  rightDimmer: { color: ROW.indexDim },
});
