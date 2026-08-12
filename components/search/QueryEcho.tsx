import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { FONT, ROW, SIGNAL, TRACK } from "@/constants/signal";

// The masthead for anything you have typed: what you asked for, set large, with the
// size of the haystack beside it. Its hairline is the SAME rule that opens the
// accordion below — one continuous line, not two stacked borders.
//
// Used by the TYPING ladder as well as the submitted state (Bryan, 2026-08-02), so
// the query is on screen from the first keystroke rather than appearing only once you
// submit. It also means submitting no longer swaps the masthead out from under you —
// the header is the same object either side, and only the list beneath it changes.

export default function QueryEcho({
  query,
  count,
  unit,
}: {
  query: string;
  /**
   * Withheld — `null`/`undefined` — whenever there is no count that belongs to THIS
   * query: the debounce is still running, the request is in flight, or the rows on
   * screen are a keystroke behind. Rendering a stale or zero total would be the
   * screen asserting something it cannot support, and the count lane simply stays
   * empty until the number is true.
   */
  count?: number | null;
  /**
   * What one-or-many of the counted thing is CALLED. Defaults to MATCH/MATCHES —
   * the whole-query number. The kind row hands its own vocabulary up instead
   * (`847 FILMS`, `1 PERSON`): the board keeps the count in the masthead, where it
   * is a fact with room, and out of the row, where it was a squeeze.
   */
  unit?: { one: string; many: string };
}) {
  return (
    <View style={styles.bar}>
      <Text style={styles.query} numberOfLines={1}>
        {query.toUpperCase()}
      </Text>
      {/* paddingBottom optically bottom-aligns 14px mono against a 33px display
          baseline — without it the count floats. */}
      {count != null && (
        <View style={styles.countWrap}>
          <Text style={styles.count}>
            {count.toLocaleString()}{" "}
            {count === 1 ? (unit?.one ?? "MATCH") : (unit?.many ?? "MATCHES")}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    // Air on BOTH sides of the title block (Bryan, 2026-08-08: "ever since we added
    // the Recent Back tab... everything below is just so squished"). The ← RECENT
    // row used to sit straight on the title's cap height; 10 above and the board's
    // 18 below give the masthead the same breathing room the board draws.
    paddingTop: 10,
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
  },
  query: {
    flexShrink: 1,
    color: SIGNAL.ink,
    fontFamily: FONT.display,
    fontSize: 32,
    lineHeight: 33,
    letterSpacing: -1.12, // -0.035em at 32px
  },
  countWrap: { paddingBottom: 4, flexShrink: 0 },
  count: {
    color: ROW.index,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
});
