import React, { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { INK_RED, TICKET_ACCENT, ink } from "@/components/moviedetails/ticketTheme";
import type { Take } from "@/services/db";

// The star — "one mark, three phases" (Star Toggle · States board), replacing the
// old INFO/ENTRIES toggle outright. The bare mark, no chrome around it:
//
//   UNCHARTED  no takes → the CUTOUT NOTCH: void-dark fill, NO outline — a hole
//              punched through the artwork. No label, not tappable.
//   PROGRESS   the latest take's enrichment prints dots around the notch, four per
//              stage: SAVED (pending) 4 · HEARD (transcribed) 8 · UNDERSTOOD
//              (enriched, insight still owed) 12.
//   INFO FACE  takes exist → "INFO" label. The notch used to carry a slow PRISM
//              GLINT here (rose / white / ice drifting along its edge). Removed: on
//              its own 3.2s clock it read as a thin white hairline appearing and
//              disappearing for no reason the screen could explain. The notch is
//              just the notch.
//   ENTRIES    "ENTRIES" label + the star fills (accent) wearing its stipple
//              ring. Tap to go back; the fill drains. A failed/audio-missing
//              latest take turns the edge red (take kept — door stays open).

const BOX = 44; // hit target
const STAR = 26;
// The base notch draws into a PADDED canvas so its lift (below) has somewhere to go — a
// stroke centred on the path escapes half its width outward, and at 26 it was clipped by
// the viewBox. Same 1:1 scale and same centre (13,13) as the 26 overlays, so every layer
// still lands on the same star.
const STAR_BOX = 32;
const STAR_VIEWBOX = "-3 -3 32 32";
const DOT_R = 18.5; // dot ring radius around the box center
const DOT = 3;

// The void inside the notch — a hole punched through the artwork. Nearly opaque now that
// there is no outline drawing the shape: the fill has to do all the work of reading as a
// hole, and 0.9 let enough of the backdrop through to soften its points.
const NOTCH_VOID = "rgba(0,0,0,0.96)";

// 4-point curved star (concave edges), 26×26.
const STAR_PATH =
  "M13 1 C14.6 8.2 17.8 11.4 25 13 C17.8 14.6 14.6 17.8 13 25 C11.4 17.8 8.2 14.6 1 13 C8.2 11.4 11.4 8.2 13 1 Z";

// 12 dot seats, printing clockwise from 12 o'clock.
const DOT_SEATS = Array.from({ length: 12 }, (_, i) => {
  const a = ((i * 30 - 90) * Math.PI) / 180;
  return {
    left: BOX / 2 + DOT_R * Math.cos(a) - DOT / 2,
    top: BOX / 2 + DOT_R * Math.sin(a) - DOT / 2,
  };
});

interface EntriesStarProps {
  takesCount: number;
  status: Take["enrich_status"] | null; // latest take's stage, null = no takes
  insighted: boolean; // latest take's insight stage done
  active: boolean; // Entries view currently open
  // A take was saved and Entries hasn't been opened since — the star FILLS and
  // the label reads "NEW ENTRY" (the barely-there glimmer wasn't loud enough
  // for this moment; the unseen-entry state deserves full ignition).
  hasNew?: boolean;
  onToggle: () => void;
  // Tapped while uncharted — the notch answers instead of playing dead (the
  // screen explains that recording a take is what opens Entries).
  onNoEntries?: () => void;
}

export default function EntriesStar({ takesCount, status, insighted, active, hasNew, onToggle, onNoEntries }: EntriesStarProps) {
  const hasEntries = takesCount > 0;
  const failed = status === "failed" || status === "audio_missing";
  const progressDots =
    status === "pending" ? 4 : status === "transcribed" ? 8 : status === "enriched" && !insighted ? 12 : 0;
  // On the entries face the full stipple ring prints (confirmation, on a filled
  // star); on info the ring is enrichment progress around the notch.
  const dotCount = active ? 12 : progressDots;

  // NO EDGE in the ordinary case.
  //
  // The notch used to carry a faint white hairline (0.22 uncharted, 0.3 charted) to define
  // its shape against the artwork. That outline is the grey line that kept getting noticed,
  // and it appeared to swell on scroll even though nothing about it animated: the header
  // scrim fading in behind it darkened its background and raised its contrast.
  //
  // The one stroke that survives is the failure signal. That is information — a take whose
  // audio is gone — not decoration.
  const edge = failed ? INK_RED : 'none';

  // The fill — springs in when Entries opens OR when an unseen entry waits
  // (NEW ENTRY ignition); drains when the view closes / the entry is seen.
  const filled = active || !!hasNew;
  const fill = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    fill.value = withSpring(filled ? 1 : 0, { damping: 15, stiffness: 180, mass: 0.6 });
  }, [filled, fill]);
  const fillStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [{ scale: 0.55 + fill.value * 0.45 }],
  }));

  const handlePress = () => {
    if (!hasEntries) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onNoEntries?.();
      return;
    }
    Haptics.selectionAsync();
    onToggle();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={
        hasEntries
          ? active
            ? "Entries — tap for info"
            : hasNew
              ? "New entry — tap to see it"
              : "Info — tap for entries"
          : "No entries yet"
      }
    >
      {/* Face label — only once the film is charted ("no pair of labels"): the
          corner names the face you are ON — or announces the entry you haven't
          seen yet. */}
      {hasEntries && (
        <Text style={[styles.label, (active || hasNew) && styles.labelAccent]}>
          {active ? "ENTRIES" : hasNew ? "NEW ENTRY" : "INFO"}
        </Text>
      )}

      <View style={styles.box}>
        {/* Dots — enrichment progress around the notch, or the printed ring on the
            filled star while in your entries. */}
        {DOT_SEATS.slice(0, dotCount).map((seat, i) => (
          <Animated.View
            key={`${active ? "ring" : "prog"}-${i}`}
            entering={FadeIn.delay(i * 45).duration(200)}
            style={[styles.dot, seat]}
          />
        ))}

        {/* The notch — void-dark fill reads as a hole cut through the artwork.

            THE LIFT IS A GRADIENT, NOT AN OUTLINE. A near-black mark on a near-black hero
            is invisible, and there is no way around needing some light behind it. So two
            very wide, very faint white strokes sit BEHIND the fill: the half of each that
            falls inside the star is painted over, and what escapes is a soft graded haze
            with no edge to it. Over bright artwork it is effectively invisible; over a dark
            one it is the only thing separating the star from its backdrop.

            This is deliberately NOT the old edge, which was a crisp 1.2px hairline at 30%
            white — five times the alpha, sitting hard against the shape. */}
        <Svg width={STAR_BOX} height={STAR_BOX} viewBox={STAR_VIEWBOX}>
          <Path d={STAR_PATH} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={5} />
          <Path d={STAR_PATH} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={2.6} />
          <Path d={STAR_PATH} fill={NOTCH_VOID} stroke={edge} strokeWidth={1.2} />
        </Svg>

        {/* The tap fill (Paper: "fill first") — lives only while Entries is open. */}
        <Animated.View style={[styles.overlay, fillStyle]} pointerEvents="none">
          <Svg width={STAR} height={STAR} viewBox="0 0 26 26">
            <Path d={STAR_PATH} fill={TICKET_ACCENT} />
          </Svg>
        </Animated.View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  label: {
    color: ink(0.85),
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  labelAccent: {
    color: TICKET_ACCENT,
  },
  box: {
    width: BOX,
    height: BOX,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: TICKET_ACCENT,
  },
  overlay: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
});
