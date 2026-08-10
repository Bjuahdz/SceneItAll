import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { ChevronRight } from "./glyphs";
import { FONT, ROW, SIGNAL, TRACK } from "@/constants/signal";
import type { Pick } from "@/services/onePick";

// ONE PICK. A single non-expandable row with a poster — the one place on the
// default screen that carries artwork, which is what makes it read as an offer
// rather than another entry in the ledger.
//
// The reason line is the whole point: a recommendation that cannot say WHY is
// indistinguishable from an ad. It is drawn from the user's own takes, so it can
// always say why.

export default function OnePickRow({ pick, onPress }: { pick: Pick; onPress: () => void }) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${pick.title}. ${pick.facts.replace(/ · /g, ", ")}. ${pick.reason}`}
    >
      {/* No fallback art. buildOnePick only returns candidates that have a poster,
          so this never renders an empty frame. */}
      <Image
        source={{ uri: `https://image.tmdb.org/t/p/w185${pick.posterPath}` }}
        style={styles.poster}
        contentFit="cover"
        transition={180}
      />

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {pick.title.toUpperCase()}
        </Text>
        <Text style={styles.facts} numberOfLines={1}>
          {pick.facts}
        </Text>
        <View style={styles.reasonWrap}>
          <Text style={styles.reason} numberOfLines={2}>
            {pick.reason}
          </Text>
        </View>
      </View>

      <ChevronRight size={13} color={ROW.titleDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  poster: { width: 56, height: 84, borderRadius: 3, flexShrink: 0 },
  info: { flex: 1, gap: 5 },
  title: {
    color: SIGNAL.ink,
    fontFamily: FONT.display,
    fontSize: 19,
    lineHeight: 21,
    letterSpacing: TRACK.title19,
  },
  facts: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: TRACK.micro10,
  },
  reasonWrap: { paddingTop: 2 },
  // Inter, not mono — this is the one sentence on the screen meant to be READ
  // rather than scanned.
  reason: { color: SIGNAL.muted, fontSize: 12, lineHeight: 17 },
});
