import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import ResultRow from "./ResultRow";
import SectionHeader from "./SectionHeader";
import { FONT, ROW, SIGNAL, TRACK } from "@/constants/signal";
import type { SearchResult } from "@/services/search";

// ZERO RESULTS, from board THY-0.
//
// This state is far more common than it looks, because TMDB does NO spelling
// correction whatsoever — `intersteller`, one letter off Interstellar, returns
// nothing at all. So "spelling has to be exact" is the single most useful thing the
// screen can say, and it says it plainly.
//
// The fault box is the first and only use of vermillion in the shipping palette.
// That is deliberate: accent means "your live data" and would be wrong on a fault.

interface Props {
  query: string;
  suggestions: SearchResult[];
  entryIds: Set<number>;
  onClear: () => void;
  onPickSuggestion: (r: SearchResult) => void;
}

export default function ZeroResults({
  query,
  suggestions,
  entryIds,
  onClear,
  onPickSuggestion,
}: Props) {
  return (
    <View style={styles.stack}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>NO MATCH</Text>
        <View style={styles.countWrap}>
          <Text style={styles.count}>0 RESULTS</Text>
        </View>
      </View>

      <View style={styles.fault}>
        <Text style={styles.faultLabel}>SEARCH RETURNED 0</Text>
        <Text style={styles.faultHead}>NO RECORD FOUND</Text>
        <View style={styles.faultBodyWrap}>
          <Text style={styles.faultBody}>
            {`“${query}” yielded no matches in the catalogue or your vault. Spelling must be exact — one letter off returns nothing.`}
          </Text>
        </View>
      </View>

      {/* Omitted entirely when truncate-and-retry found nothing — an empty
          "DID YOU MEAN" header would be worse than no header. Design contract 8. */}
      {suggestions.length > 0 && (
        <View>
          <SectionHeader
            label="DID YOU MEAN"
            right="CLOSEST MATCHES"
            accentLabel
            paddingTop={4}
          />
          {suggestions.map((s, i) => (
            <ResultRow
              key={`${s.entityType}-${s.id}`}
              result={s}
              index={i + 1}
              query=""
              mode="submitted"
              hasEntry={s.entityType === "movie" && entryIds.has(s.id)}
              isLast={i === suggestions.length - 1}
              onPress={onPickSuggestion}
            />
          ))}
        </View>
      )}

      {/* ONE CTA. Accent-filled because accent is the verb, and this is the only
          verb on the screen. It clears AND refocuses — the two things a dead end
          needs — rather than just wiping the field and leaving you staring. */}
      <Pressable
        style={styles.cta}
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel="Clear the search and try again"
      >
        <Text style={styles.ctaLabel}>CLEAR AND TRY AGAIN</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 22 },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
  },
  title: {
    color: SIGNAL.ink,
    fontFamily: FONT.display,
    fontSize: 32,
    lineHeight: 33,
    letterSpacing: -1.12,
  },
  countWrap: { paddingBottom: 4 },
  count: {
    color: ROW.index,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
  fault: {
    gap: 10,
    paddingTop: 20,
    paddingBottom: 22,
    paddingHorizontal: 18,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(232,68,46,0.451)",
    backgroundColor: "rgba(232,68,46,0.055)",
  },
  faultLabel: {
    color: SIGNAL.vermillion,
    fontFamily: FONT.monoMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.8, // 0.18em at 10px
  },
  faultHead: {
    color: SIGNAL.ink,
    fontFamily: FONT.display,
    fontSize: 24,
    lineHeight: 25,
    letterSpacing: -0.72,
  },
  faultBodyWrap: { paddingTop: 2 },
  faultBody: { color: "#9A938B", fontSize: 13, lineHeight: 20 },
  cta: {
    height: 54,
    borderRadius: 27,
    backgroundColor: SIGNAL.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: {
    color: SIGNAL.ground,
    fontFamily: FONT.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
});
