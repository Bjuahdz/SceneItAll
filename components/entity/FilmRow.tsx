import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import EntryStar from "../search/EntryStar";
import { FONT, ROW, SEARCH_LAYOUT, SIGNAL } from "@/constants/signal";
import type { EntityFilm } from "@/services/entities";

// A row in an entity's filmography sheet. 56px, shorter than a search result row
// — and DELIBERATELY so, re-affirmed by Bryan 2026-08-12 after he questioned the
// difference and then answered it himself: a search result row stacks a meta line
// (kind · year · format) UNDER its title, which is what buys its extra height;
// this row is a single title lane with the year beside it, because format lives
// in the page's filter sheet instead. Do not "fix" the size difference — the two
// rows carry different cargo.
//
// Anatomy: [index 20][title flex 1][year 40, right] — and nothing after the year.
// The row used to end in a 14px marker slot reserved on EVERY row for the entry
// star, which pushed the year lane in from the edge and read as dead air on the
// ~all rows that had no star (Bryan, 2026-08-12: "weirdly spaced out"). The star
// floats just LEFT OF THE YEAR now (his placement, corrected same day) — in the
// gap the title and year columns already keep — so a journaled film wears its
// mark by its year and every other row reserves nothing. Upcoming rows widen the
// date lane to 62 ("JUL 2026" needs the room); their chevron-right died with the
// marker: they unroll in place like every other row, no navigation to advertise.
//
// THE WHOLE ROW DIMS, not just the title. A film you have not journaled drops its
// index and year with its title; that is what makes the sheet scannable at a glance.

// The released year lane's width — the star's berth is measured off it.
const YEAR_W = 40;

interface Props {
  film: EntityFilm;
  index: number;
  hasEntry: boolean;
  onPress: (film: EntityFilm) => void;
  isLast?: boolean;
}

export default function FilmRow({ film, index, hasEntry, onPress, isLast }: Props) {
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

      {/* The earned mark, in the margin the columns already keep — absolute, so a
          starless row is byte-identical in layout and nothing is ever reserved. */}
      {hasEntry && (
        <View style={styles.entryMark} pointerEvents="none">
          <EntryStar size={11} />
        </View>
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
    width: YEAR_W,
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
  // The star's berth: centered in the title→year gap (the columns sit rowGap
  // apart, an 11px star floats in that 14), so it reads as the year's mark —
  // Bryan's corrected placement. Vertically centered on the row so a two-line
  // title carries the mark at its middle. Anchored off the RELEASED lane width
  // on purpose: upcoming rows can never have entries.
  entryMark: {
    position: "absolute",
    right: YEAR_W + (SEARCH_LAYOUT.rowGap - 11) / 2,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
});
