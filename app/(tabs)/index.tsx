import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import CloudbankCanvas, { type CloudbankController } from "@/components/home/CloudbankCanvas";
import LedgerCard from "@/components/home/LedgerCard";
import ReceiptsSheet from "@/components/home/ReceiptsSheet";
import { useHomeData } from "@/components/home/useHomeData";
import { fmtDur, tintHex, GENRE_HUES } from "@/components/home/skyModel";

// ─────────────────────────────────────────────────────────────────────────────
// Home — the SceneItAll dashboard, direction 29c
// (prototype_design_handoff/UPDATED_design_handoff_home_dashboard — the earlier
// un-prefixed copy of that package was deleted 2026-07-28).
//
// The mirror of what the user chose to remember. Layered bottom → top:
//   · THE LIVING SKY   — the ambient constellation of every film they've talked
//                        about, drifting behind everything (interactive:false).
//   · THE CROWN        — media chips, the theme name in its hue, and the latest
//                        arc verbatim. Tapping it opens RECEIPTS.
//   · THE LEDGER       — the composed glass summary card. Tapping it opens the
//                        Explore sheet, where the same sky becomes live.
//
// Guardrails: arc text renders verbatim, spoilers are masked in receipts,
// sparse is the default state (never a generic capture button — the nudge names
// a specific saved film), and the UI makes zero AI calls.
// ─────────────────────────────────────────────────────────────────────────────

const { width: W, height: H } = Dimensions.get("window");

const Home = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isFocused = useIsFocused();
  // Nav pill morph: this screen's scroll drives the collapse/expand of the floating nav.
  // No nav-morph handler here: 29c is a fixed, non-scrolling screen, so the
  // floating pill simply stays in its expanded pose on Home (never hidden).

  const { cloud, ledger, arcs, takes, fp, absorbTakeId, ready } = useHomeData();
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const cloudCtl = useRef<CloudbankController | null>(null);

  // Scrubbing the ring changes the theme printed above the void.
  const onSelect = useCallback((i: number) => {
    setSelected(i);
    Haptics.selectionAsync();
  }, []);
  useEffect(() => {
    if (selected > cloud.themes.length - 1) setSelected(0);
  }, [cloud.themes.length, selected]);

  const theme = cloud.themes[Math.min(selected, cloud.themes.length - 1)] ?? null;
  const arc = theme ? (arcs[theme.arcIndex] ?? null) : null;

  // The crown reads the SELECTED theme — its label, and its arc verbatim. With
  // no arcs yet, fall back to the dominant topic (a factual readout, never prose).
  const crown = useMemo(() => {
    if (theme)
      return {
        name: theme.name,
        kind: theme.kind,
        line: theme.insight,
        hue: theme.hue,
        tappable: true,
      };
    const top = fp?.topics?.[0];
    if (top) {
      return {
        name: top.topic.replace("-", " "),
        kind: "YOUR FOCUS",
        line: `You've spent ${fmtDur(top.seconds)} on ${top.topic.replace("-", " ")} across ${
          top.takeCount
        } take${top.takeCount === 1 ? "" : "s"}.`,
        hue: GENRE_HUES[0],
        tappable: false,
      };
    }
    return {
      name: "your themes",
      kind: "",
      line: ledger.nudgeFilm
        ? `Talk about ${ledger.nudgeFilm} and your themes will gather here.`
        : "Save a film and start talking — your themes will gather here.",
      hue: GENRE_HUES[0],
      tappable: false,
    };
  }, [theme, fp, ledger.nudgeFilm]);

  // Clear the floating nav pill (bottom = max(insets.bottom,16) + 8, height 64).
  const ledgerBottom = Math.max(insets.bottom, 16) + 8 + 64 + 10;
  // The notch tip sits at cy - NOTCH_R; the crown must stop short of it no matter
  // how long the arc is, so it can never cover the notch or the void.
  const crownMaxH = Math.max(90, H * 0.455 - 170 - (insets.top + 12) - 14);

  const openExplore = useCallback(() => router.push("/explore"), [router]);

  return (
    <View style={styles.container}>
      {/* ENGINE A — the cloudbank: your themes ringing the black-hole void.
          Drag to scrub them under the notch; press the void to warp to Explore. */}
      <View style={StyleSheet.absoluteFill}>
        <CloudbankCanvas
          data={cloud}
          width={W}
          height={H}
          active={isFocused && ready}
          onSelect={onSelect}
          onVoidPressed={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
          onExplore={openExplore}
          controllerRef={cloudCtl}
        />
      </View>

      {/* The crown floats over the canvas. It is box-none all the way down and
          HEIGHT-CAPPED above the notch — a long arc must never reach the notch
          or the void, and it must never swallow a scrub or an EXPLORE tap.
          (29c is a fixed screen: nothing scrolls, so the nav pill stays expanded.) */}
      <View
        style={[styles.crownLayer, { top: insets.top + 12, maxHeight: crownMaxH }]}
        pointerEvents="box-none"
      >
        <View style={styles.chipsRow}>
          {(["MOVIES", "SHOWS", "BOOKS"] as const).map((type) => {
            const active = type === "MOVIES";
            return (
              <View key={type} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{type}</Text>
                {!active && <Text style={styles.soonTag}>SOON</Text>}
              </View>
            );
          })}
        </View>

        <Pressable
          onPress={() => crown.tappable && setReceiptsOpen(true)}
          disabled={!crown.tappable}
          style={styles.crown}
          accessibilityRole={crown.tappable ? "button" : undefined}
          accessibilityLabel={crown.tappable ? "Open the full thread for this theme" : undefined}
        >
          {!!crown.kind && <Text style={styles.themeKind}>{crown.kind}</Text>}
          <Animated.Text
            key={`name-${crown.name}`}
            entering={FadeIn.duration(450)}
            numberOfLines={1}
            style={[
              styles.themeName,
              { color: tintHex(crown.hue, 0.55), textShadowColor: `${crown.hue}66` },
            ]}
          >
            {crown.name.toUpperCase()}
          </Animated.Text>
          {/* Clamped on purpose — the arc reads in full, verbatim, in the sheet. */}
          <Animated.Text
            key={`line-${crown.name}`}
            entering={FadeIn.duration(550)}
            numberOfLines={2}
            style={styles.insight}
          >
            {crown.line}
          </Animated.Text>
          {crown.tappable && <Text style={styles.crownHint}>TAP FOR THE FULL THREAD</Text>}
        </Pressable>
      </View>

      <LedgerCard
        ledger={ledger}
        absorbTakeId={absorbTakeId}
        onOpen={openExplore}
        bottom={ledgerBottom}
      />

      <ReceiptsSheet
        arc={arc}
        takes={takes}
        visible={receiptsOpen}
        onClose={() => setReceiptsOpen(false)}
      />
    </View>
  );
};

export default Home;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#02010c",
  },
  crownLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    overflow: "hidden", // hard stop: nothing spills toward the notch
  },
  chipsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 2,
    alignSelf: "center",
    padding: 3,
    borderRadius: 999,
    backgroundColor: "rgba(10,8,26,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: 999,
  },
  chipActive: {
    backgroundColor: "rgba(156,202,223,0.16)",
    borderWidth: 1,
    borderColor: "rgba(156,202,223,0.3)",
  },
  chipText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(255,255,255,0.38)",
  },
  chipTextActive: {
    color: "#cfe6f2",
  },
  soonTag: {
    fontSize: 6,
    color: "rgba(255,255,255,0.3)",
    fontWeight: "700",
  },
  crown: {
    marginTop: 14,
    paddingHorizontal: 34,
    alignItems: "center",
  },
  themeKind: {
    fontSize: 7,
    fontWeight: "800",
    letterSpacing: 2,
    color: "rgba(255,255,255,0.3)",
    marginBottom: 5,
  },
  themeName: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 4,
    textAlign: "center",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  insight: {
    fontSize: 10.5,
    lineHeight: 15,
    color: "rgba(255,255,255,0.5)",
    marginTop: 7,
    maxWidth: 296,
    textAlign: "center",
  },
  crownHint: {
    fontSize: 6.5,
    fontWeight: "800",
    letterSpacing: 1.6,
    color: "rgba(156,202,223,0.45)",
    marginTop: 7,
  },
});
