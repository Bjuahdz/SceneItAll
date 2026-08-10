import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import EntryStar from "../search/EntryStar";
import { ChevronRight } from "../search/glyphs";
import { FONT, ROW, SEARCH_LAYOUT, SIGNAL } from "@/constants/signal";
import type { EntityFilm } from "@/services/entities";

// A row in an entity's filmography sheet. 56px, shorter than a search result row
// because this list is long and the page already has a hero doing the talking.
//
// Anatomy: [index 20][title flex 1][year 40, right][14px marker]
// Upcoming swaps the marker for a bare chevron-right and widens the date lane to
// 62 — "JUL 2026" needs the room, and "when" is the useful fact for something that
// has not come out.
//
// THE WHOLE ROW DIMS, not just the title. A film you have not journaled drops its
// index and year with its title; that is what makes the sheet scannable at a glance.

interface Props {
  film: EntityFilm;
  index: number;
  hasEntry: boolean;
  onPress: (film: EntityFilm) => void;
  isLast?: boolean;
}

export default function FilmRow({ film, index, hasEntry, onPress, isLast }: Props) {
  // You cannot have a take on something unreleased, so an upcoming row is never
  // expandable — it navigates. Chevron-right, never chevron-down.
  const upcoming = !film.released;
  const dim = upcoming || !hasEntry;

  return (
    <Pressable
      style={[styles.row, (isLast || upcoming) && styles.noBorder]}
      onPress={() => onPress(film)}
      accessibilityRole="button"
      accessibilityLabel={`${film.title}, ${
        upcoming ? `releases ${film.releaseLabel}` : film.year ?? "year unknown"
      }.${hasEntry ? " You have an entry." : ""}`}
    >
      <Text style={[styles.index, dim && styles.indexDim]}>
        {String(index).padStart(2, "0")}
      </Text>

      <Text style={[styles.title, dim && styles.titleDim]} numberOfLines={2}>
        {film.title.toUpperCase()}
      </Text>

      <Text
        style={[styles.year, dim && styles.yearDim, upcoming && styles.dateWide]}
        numberOfLines={1}
      >
        {upcoming ? film.releaseLabel : film.year}
      </Text>

      {upcoming ? (
        <ChevronRight size={13} color={ROW.indexDim} />
      ) : (
        <View style={styles.marker}>{hasEntry ? <EntryStar /> : null}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: SEARCH_LAYOUT.rowGap,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
    paddingVertical: 6,
  },
  noBorder: { borderBottomWidth: 0 },
  index: {
    width: SEARCH_LAYOUT.indexWidth,
    flexShrink: 0,
    color: ROW.index,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
  },
  indexDim: { color: ROW.indexDim },
  title: {
    flex: 1,
    color: ROW.titleEntry,
    fontFamily: FONT.display,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.34, // -0.02em at 17px
  },
  titleDim: { color: ROW.titleDim },
  year: {
    width: 40,
    flexShrink: 0,
    textAlign: "right",
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.0, // 0.10em at 10px
  },
  yearDim: { color: ROW.yearDim },
  dateWide: { width: 62 },
  marker: {
    width: SEARCH_LAYOUT.markerWidth,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
