import React from "react";
import { StyleSheet, Text, View } from "react-native";

import SectionHeader from "./SectionHeader";
import { FONT, ROW, SEARCH_LAYOUT, SIGNAL, TRACK, TRACK2 } from "@/constants/signal";

// The new-account state, from board RZM-0.
//
// A fresh account has no recents AND no takes, so there is no honest ONE PICK — and
// the gap is deliberately NOT filled with trending or popular films. That would turn
// Search into Discover and erase the intent-vs-free-roam split between the two tabs.
// Instead the screen teaches the loop it wants you to run.

const STEPS = [
  { title: "SEARCH A FILM", desc: "Tap the field below and type a title." },
  { title: "OPEN IT", desc: "It gets saved here so you can come straight back." },
  {
    title: "RECORD YOUR TAKE",
    desc: "Say what you thought. We'll start suggesting films from it.",
  },
];

export default function EmptyState() {
  return (
    <View>
      <View style={styles.copy}>
        <Text style={styles.headline}>NOTHING SEARCHED YET.</Text>
        <Text style={styles.sub}>Films you look up collect here, newest first.</Text>
      </View>

      <SectionHeader label="HOW IT WORKS" right="03 STEPS" paddingTop={0} />

      <View>
        {STEPS.map((step, i) => (
          <View
            key={step.title}
            style={[styles.step, i === STEPS.length - 1 && styles.stepLast]}
          >
            <View style={styles.indexSlot}>
              <Text style={styles.index}>{String(i + 1).padStart(2, "0")}</Text>
            </View>
            <View style={styles.stepBody}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDesc}>{step.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { gap: 10, paddingBottom: 40 },
  headline: {
    color: SIGNAL.ink,
    fontFamily: FONT.display,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: TRACK2.display30,
    maxWidth: 320,
  },
  // Inter, not mono — a sentence to read, not a label to scan.
  sub: { color: SIGNAL.muted, fontSize: 14, lineHeight: 21 },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SEARCH_LAYOUT.rowGap,
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
  },
  stepLast: { borderBottomWidth: 0 },
  indexSlot: { width: SEARCH_LAYOUT.indexWidth, flexShrink: 0, paddingTop: 3 },
  index: {
    color: ROW.index,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.index11,
  },
  stepBody: { flex: 1, gap: 5 },
  stepTitle: {
    color: ROW.titleEntry,
    fontFamily: FONT.display,
    fontSize: 17,
    lineHeight: 19,
    letterSpacing: -0.34, // -0.02em at 17px
  },
  stepDesc: { color: SIGNAL.muted, fontSize: 12, lineHeight: 18 },
});
