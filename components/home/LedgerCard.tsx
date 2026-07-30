import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { AMBER_INK, ICE } from "./skyModel";
import type { LedgerData } from "./useHomeData";

// ─────────────────────────────────────────────────────────────────────────────
// Module A — the ledger. One composed glass card pinned to the bottom that
// summarizes the journal: a cycling TIMELINE of the latest takes, four stat
// squares, and the PEAK / FLOOR rating chips. It breathes: the highlighted
// timeline row cycles every 4.2s, unenriched takes read "distilling", and a
// freshly-absorbed take glows once.
//
// Tapping the card opens the Explore sheet.
// ─────────────────────────────────────────────────────────────────────────────

const CYCLE_MS = 4200;

const StatTile = ({ value, label }: { value: string | number; label: string }) => (
  <View style={styles.tile}>
    <Text style={styles.tileValue}>{value}</Text>
    <Text style={styles.tileLabel}>{label}</Text>
  </View>
);

const RatingChip = ({
  label,
  title,
  score,
  amber,
}: {
  label: string;
  title: string;
  score: number;
  amber?: boolean;
}) => (
  <View style={[styles.chip, amber ? styles.chipAmber : styles.chipIce]}>
    <View style={styles.chipBody}>
      <Text style={[styles.chipLabel, amber ? styles.chipLabelAmber : styles.chipLabelIce]}>
        {label}
      </Text>
      <Text style={styles.chipTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
    <Text style={[styles.chipScore, amber ? styles.chipScoreAmber : styles.chipScoreIce]}>
      ★ {score.toFixed(1)}
    </Text>
  </View>
);

interface LedgerCardProps {
  ledger: LedgerData;
  absorbTakeId: number | null;
  onOpen: () => void;
  bottom: number;
}

export default function LedgerCard({ ledger, absorbTakeId, onOpen, bottom }: LedgerCardProps) {
  // The highlighted timeline row cycles through the newest three.
  const [tick, setTick] = useState(0);
  const rows = ledger.timeline.length;
  useEffect(() => {
    if (rows < 2) return;
    const id = setInterval(() => setTick((t) => t + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, [rows]);

  const press = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpen();
  };

  const empty = ledger.takes === 0;

  return (
    <Pressable
      onPress={press}
      style={[styles.wrap, { bottom }]}
      accessibilityRole="button"
      accessibilityLabel="Open your constellation"
    >
      <BlurView intensity={20} tint="dark" style={styles.card}>
        <View style={styles.cardTint} pointerEvents="none" />

        {empty ? (
          // Sparsity first: a specific saved film, never a generic record button.
          <Text style={styles.emptyLine}>
            {ledger.nudgeFilm
              ? `Record a take on ${ledger.nudgeFilm} and your journal starts here.`
              : "Save a film, record a take, and your journal starts here."}
          </Text>
        ) : (
          <>
            <View style={styles.row}>
              {/* TIMELINE */}
              <View style={styles.timelineCol}>
                <Text style={styles.timelineLabel}>TIMELINE</Text>
                {ledger.timeline.map((r, i) => {
                  const lit = rows < 2 || i === tick % rows;
                  const absorbing = absorbTakeId === r.takeId;
                  return (
                    // LAYERED ON PURPOSE. FadeIn animates opacity, and so does the
                    // tick dim below — putting both on one view makes Reanimated warn
                    // that the layout animation may overwrite the style. The wrapper
                    // owns the entrance; the inner row owns the dim. (Same split
                    // CaptureStatusBadge documents.)
                    <Animated.View key={r.takeId} entering={FadeIn.duration(400)}>
                      <View style={[styles.tlRow, { opacity: lit ? 1 : 0.42 }]}>
                        <View
                          style={[
                            styles.tlDot,
                            { backgroundColor: r.hue, shadowColor: r.hue },
                            absorbing && styles.tlDotAbsorb,
                          ]}
                        />
                        <Text style={styles.tlTitle} numberOfLines={1}>
                          {r.title}
                        </Text>
                        <Text style={styles.tlSub}>
                          {r.distilling ? `${r.ago} · distilling` : r.ago}
                        </Text>
                      </View>
                    </Animated.View>
                  );
                })}
              </View>

              {/* Stat squares */}
              <View style={styles.statsCol}>
                <View style={styles.statRow}>
                  <StatTile value={ledger.films} label="FILMS" />
                  <StatTile value={ledger.takes} label="TAKES" />
                </View>
                <View style={styles.statRow}>
                  <StatTile value={ledger.spoken} label="SPOKEN" />
                  <StatTile value={ledger.nights} label="NIGHTS" />
                </View>
              </View>
            </View>

            {/* PEAK / FLOOR — hidden until ratings exist (most takes have none) */}
            {ledger.peak && ledger.floor ? (
              <View style={styles.chipRow}>
                <RatingChip label="PEAK" title={ledger.peak.title} score={ledger.peak.rating} />
                <RatingChip label="FLOOR" title={ledger.floor.title} score={ledger.floor.rating} amber />
              </View>
            ) : ledger.peak ? (
              <View style={styles.chipRow}>
                <RatingChip label="RATED" title={ledger.peak.title} score={ledger.peak.rating} />
              </View>
            ) : null}
          </>
        )}
      </BlurView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
  },
  card: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 11,
  },
  cardTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,8,26,0.62)",
  },
  emptyLine: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: "center",
    paddingVertical: 6,
  },
  row: {
    flexDirection: "row",
    gap: 14,
  },
  // TIMELINE
  timelineCol: {
    flex: 1.35,
    minWidth: 0,
  },
  timelineLabel: {
    textAlign: "center",
    fontSize: 7,
    fontWeight: "800",
    letterSpacing: 2,
    color: "rgba(156,202,223,0.8)",
  },
  tlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5.5,
  },
  tlDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  tlDotAbsorb: {
    shadowOpacity: 1,
    shadowRadius: 10,
  },
  tlTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 10.5,
    fontWeight: "700",
    color: "rgba(255,255,255,0.88)",
  },
  tlSub: {
    fontSize: 8,
    color: "rgba(255,255,255,0.42)",
  },
  // Stat squares
  statsCol: {
    flex: 1,
    justifyContent: "center",
    gap: 6,
  },
  statRow: {
    flexDirection: "row",
    gap: 6,
  },
  tile: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  tileValue: {
    fontSize: 13,
    fontWeight: "800",
    color: "rgba(255,255,255,0.92)",
  },
  tileLabel: {
    fontSize: 6,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(255,255,255,0.38)",
    marginTop: 1,
  },
  // PEAK / FLOOR
  chipRow: {
    flexDirection: "row",
    gap: 7,
    marginTop: 10,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipIce: {
    backgroundColor: "rgba(156,202,223,0.07)",
    borderColor: "rgba(156,202,223,0.16)",
  },
  chipAmber: {
    backgroundColor: "rgba(226,181,63,0.06)",
    borderColor: "rgba(226,181,63,0.16)",
  },
  chipBody: {
    flex: 1,
    minWidth: 0,
  },
  chipLabel: {
    fontSize: 6.5,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  chipLabelIce: {
    color: "rgba(156,202,223,0.85)",
  },
  chipLabelAmber: {
    color: "rgba(226,181,63,0.85)",
  },
  chipTitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.88)",
    marginTop: 2,
  },
  chipScore: {
    fontSize: 13.5,
    fontWeight: "800",
  },
  chipScoreIce: {
    color: ICE,
  },
  chipScoreAmber: {
    color: AMBER_INK,
  },
});
