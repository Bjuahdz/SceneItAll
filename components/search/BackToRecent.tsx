import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { FONT, SEARCH_LAYOUT, SIGNAL, TRACK } from "@/constants/signal";

/**
 * ▸ THE DOOR BACK TO RECENT (Bryan, SEARCH MASTER V3, ruling ⑤).
 *
 * Until now the only way out of a result set was to clear the field by hand —
 * "cumbersome... too much friction". This is the way out: an arrow and a word at
 * the top of the header, above the query it undoes.
 *
 * ▸ RULING A (reversed, final): IT CLEARS. Tapping it ends the search — query
 * gone, results gone, the board exactly as if you had never searched. Preserving
 * the results was ruled first and then reversed once the return path was costed:
 * it demanded a permanent control on the recents board that could only print a
 * truncated title or a bare count, and left a stale search parked while the user
 * wandered off into an entity page. Clearing deletes an entire class of state.
 *
 * ▸ EVERY VALUE HERE IS THE BOARD'S, read from it rather than eyeballed: the row
 * is 8pt gapped and centre-aligned, the mark is a 15×13 chevron-and-shaft on a
 * 16×14 canvas at 1.8 stroke, and the word is JetBrains Mono 500 / 11px / 14 line
 * / 0.14em in the enlarger blue. The accent is load-bearing rather than
 * decorative — this is the one thing on the results surface that DOES something,
 * and Signal's rule is that accent means exactly that.
 */

/** The door row's own height — the word's line box, which the 13pt mark sits inside. */
export const DOOR_ROW_H = 14;
/** Board gap between the door row and the query beneath it. */
export const DOOR_GAP = 12;
/**
 * What the header owes the door: its row plus the gap under it. The search
 * screen adds this to the scroll content's top padding whenever a query is live,
 * so the door's absolute slot is reserved by the same number that positions it —
 * and every query-bearing state (the typing ladder, submitted results, zero
 * results, an error) gets the reservation without knowing about the door at all.
 */
export const DOOR_BLOCK = DOOR_ROW_H + DOOR_GAP;

export default function BackToRecent({ onPress }: { onPress: () => void }) {
  return (
    // A SHORT fade, both ways, and only that. The door arrives on the same beat a
    // whole body swaps behind it (compose → the typing ladder) and leaves as the
    // board comes back — appearing hard on either edge is the "abrupt" this
    // surface has been called out for twice. It stays deliberately quick: at this
    // size a longer ramp reads as the control being slow to answer, and the door
    // must never look like it is still arriving when a thumb is already on it.
    <Animated.View
      style={styles.row}
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
    >
      <Pressable
        onPress={onPress}
        // A 14pt row wants precision nobody has at the top of a phone, so the slop
        // does the work — but DOWNWARD it stops at exactly DOOR_GAP, filling the
        // board's own 12pt gap and no more. Past that it would start swallowing
        // taps meant for the list, which scrolls under this band once a marquee
        // is expanded. Upward and leftward it can be generous: there is nothing
        // above it but the status bar and nothing left of it but the margin.
        hitSlop={{ top: 14, bottom: DOOR_GAP, left: 16, right: 20 }}
        accessibilityRole="button"
        accessibilityLabel="Back to recent searches, clearing this search"
        style={styles.hit}
      >
        <Svg width={15} height={13} viewBox="0 0 16 14">
          <Path
            d="M6.5 1.2 L1.2 7 L6.5 12.8"
            fill="none"
            stroke={SIGNAL.accent}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M1.6 7 H14.6"
            fill="none"
            stroke={SIGNAL.accent}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </Svg>
        <Text style={styles.label}>RECENT</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * ▸ SCREEN-FIXED, AND THAT IS THE WHOLE PIN.
   *
   * Ruling ⑤ asks for the door to be "pinned by the masthead morph". Run the
   * morph's own geometry for this row and the travel comes out at ZERO — the
   * masthead's collapsed line sits at BAR_TITLE_Y (topEdgeSolid + 32 = 86) and
   * this row rests at contentTop + 7 = 71, i.e. the door is BORN inside the
   * collapsed bar's band, above the line the title travels down to. There is
   * nowhere for it to travel to, so it does not travel: it is simply always
   * there, which is the outcome the ruling was asking for.
   *
   * ⚠ DO NOT "FIX" THIS BY GIVING IT THE TITLE'S TRANSFORM. That formula is
   * `t·(bar − rest) − (1 − t)·s`, and with `bar − rest` NEGATIVE here the row
   * would ride up ~20pt with the content and then sink back down to its pin — a
   * visible bounce, on a mark with no scale or horizontal travel to disguise it.
   * The title gets away with the same dip because the eye tracks it against the
   * content it is detaching from while it shrinks and slides to the centre.
   *
   * The honest reading is that the door is CHROME and the query is CONTENT: the
   * header slides up and dissolves into the glass, the way out stays put.
   */
  row: {
    position: "absolute",
    left: SEARCH_LAYOUT.padH,
    top: SEARCH_LAYOUT.contentTop,
    height: DOOR_ROW_H,
  },
  /** The mark and the word, on the board's 8pt gap. Separate from the positioned
   *  wrapper so the fade owns one view and the target owns another — a layout
   *  animation and a press surface on the same node is the kind of sharing this
   *  codebase has been bitten by before. */
  hit: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
    gap: 8,
  },
  label: {
    color: SIGNAL.accent,
    fontFamily: FONT.monoMedium,
    fontSize: 11,
    lineHeight: DOOR_ROW_H,
    letterSpacing: TRACK.micro11,
  },
});
