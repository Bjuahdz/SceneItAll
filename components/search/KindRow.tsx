// ─────────────────────────────────────────────────────────────────────────────
// THE KIND ROW — how you say "show me people" on the results surface.
//
// ⚠ THIS IS NAVIGATION, NOT A FILTER. The FILTER sheet narrows WITHIN a kind; this
// row picks WHICH kind you are looking at.
//
// ▸ EVERY NUMBER HERE IS OFF THE PAPER BOARD (G1 · THE BAR AT REST, read with
// get_computed_styles on 2026-08-08 — the third build of this row, after two from
// memory that Bryan rejected on sight: "it doesn't even resemble anything close").
// The board's voice is TWO FACES, not two sizes of one face: the chosen kind is a
// display word — Bricolage 800 · 17 · accent — sitting among small mono labels at
// 8/0.1em. One large bright word in a quiet row is the whole hierarchy.
//
// ▸ NO COUNTS IN THE ROW — the board names itself "two sizes, no counts". The
// masthead above carries the chosen kind's count as `847 FILMS`, where there is
// room for it to be a fact instead of a squeeze. Emptiness is still shown HERE,
// as dimness: a kind with nothing for this query is dim and untappable.
//
// ▸ ONE STATIC ROW BETWEEN TWO HAIRLINES — height 46, paddingBlock 12, baseline,
// space-between, edge to edge. Nothing scrolls; the small mono is what makes six
// words fit.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FONT, ROW, SIGNAL } from "@/constants/signal";
import { SEARCH_KIND_CYCLE, type KindKey } from "@/hooks/useFilterState";

/** Plural everywhere except ALL — you are choosing a pile, not a thing. */
export const KIND_ROW_LABEL: Record<KindKey, string> = {
  any: "ALL",
  film: "FILMS",
  shows: "SHOWS",
  person: "PEOPLE",
  studio: "STUDIOS",
  collection: "COLLECTIONS",
};

/** What the MASTHEAD's count calls one-or-many of each kind — `21 PEOPLE`,
 *  `1 PERSON`. Lives here because it is the kind row's vocabulary, even though the
 *  masthead is the one that prints it. */
export const KIND_UNIT: Record<KindKey, { one: string; many: string }> = {
  any: { one: "MATCH", many: "MATCHES" },
  film: { one: "FILM", many: "FILMS" },
  shows: { one: "SHOW", many: "SHOWS" },
  person: { one: "PERSON", many: "PEOPLE" },
  studio: { one: "STUDIO", many: "STUDIOS" },
  collection: { one: "COLLECTION", many: "COLLECTIONS" },
};

/** ▸ NO ALL TAB (Bryan, 2026-08-08). Five piles, FILMS first and resting. ALL's
 *  sheet could only ask the questions every kind shares, which made the app's most
 *  visible filter its most confusing one — "if they see it's based off films first,
 *  they can manually hit whatever they want accordingly." */
/** Exported for THE EMPTY-TAB RESCUE (search.tsx): the rescue must pick from
 *  EXACTLY the tabs this row offers. It once searched SEARCH_KIND_CYCLE raw,
 *  whose first entry is "any" — never empty while results exist — so every
 *  rescue quietly resurrected the deleted ALL: mixed piles under a row with no
 *  chosen tab, masthead counting the whole set (Bryan's CHRIS P / TOM HO
 *  screenshots, 2026-08-09). One list, one truth. */
export const ROW_KINDS = SEARCH_KIND_CYCLE.filter((k) => k !== "any");

export default function KindRow({
  value,
  onChange,
  counts,
}: {
  value: KindKey;
  onChange: (k: KindKey) => void;
  /** Used ONLY to know which kinds are empty — never printed. Absent entries
   *  render as available: "not counted" and "none" must not look the same. */
  counts?: Partial<Record<KindKey, number>>;
}) {
  return (
    <View style={styles.row}>
      {ROW_KINDS.map((k) => {
        const on = k === value;
        // Only a POSITIVE zero disables — ALL is never empty while results exist,
        // and an uncounted kind stays live rather than guessing at emptiness.
        const empty = counts?.[k] === 0 && !on;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            disabled={empty}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled: empty }}
            hitSlop={{ top: 12, bottom: 12 }}
          >
            <Text
              style={on ? styles.chosen : empty ? styles.empty : styles.quiet}
              numberOfLines={1}
            >
              {KIND_ROW_LABEL[k]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  /** The board's container, verbatim: 46 tall, 12 block padding, baseline,
   *  space-between, a hairline above AND below. No horizontal padding — the
   *  screen's own inset does that, same as the masthead. */
  row: {
    height: 46,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: "#F2EDE424",
    borderBottomColor: "#F2EDE424",
  },
  /** The display face, not a bigger mono — Bricolage 800 · 17 · accent. Changes on
   *  a tap, which is a discrete render; nothing moves mid-gesture. */
  chosen: {
    fontFamily: FONT.display,
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: -0.17, // -0.01em at 17px
    color: SIGNAL.accent,
  },
  /** 10, not the board's 8 — the same correction navMetrics.ts already records for
   *  the nav ("the board's numbers read as cramped on device", NAV_SCALE 1.15).
   *  Paper at 1:1 flatters micro type; a phone at arm's length does not. The
   *  hierarchy survives untouched: 17 display vs 10 mono is still two faces. */
  quiet: {
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.0, // 0.1em at 10px
    color: SIGNAL.muted,
  },
  /** Empty = nothing of this kind matched. Dimmer than quiet, untappable — the
   *  silence is the message, which is what let the counts leave the row. */
  empty: {
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.0,
    color: ROW.indexDim,
  },
});
