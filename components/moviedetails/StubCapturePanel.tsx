import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { formatCaptureTime, type CaptureStatus } from "@/hooks/useCaptureSession";
import { INK_AMBER, TICKET_ACCENT, ink } from "@/components/moviedetails/ticketTheme";
import { DANGER, RED, SAVE_GREEN, useWaveHistory } from "./CapturePill";

// The capture module — the Paper flow's screens 02–07. It lives in the ticket stub
// (below the synopsis) and, via `docked`, doubles as the detached bottom dock: the
// SAME anatomy minus the waveform, so the hand-off reads as the module compacting
// and re-docking rather than morphing into a different control (Paper 04–05).
//
//   recording → accent strip (● RECORDING · timer) · waveform · PAUSE / STOP & SAVE
//   paused    → quiet strip (❚❚ PAUSED · time) · frozen wave · Resume/Restart/Save/Delete
//   confirms  → the button row SWAPS in place (Paper 06/07)
//
// Celebration (confetti/chime/thud) is owned by the SCREEN, not this component —
// the dock instance unmounts the moment a take resolves, and sounds/confetti must
// outlive it. This component only reports intent via the on* callbacks.
//
// RENDERING RULES learned on device (see PROJECT-PLAN's Fabric landmine):
// - Touchables are TouchableOpacity with PLAIN style props (style functions on
//   Pressable silently drop here). All visuals live on inner face Views.
// - No fractional `gap` — the waveform distributes with space-between instead.

const PANEL_WAVE_N = 40;
const WBAR_MIN = 4;
const WBAR_SWING = 20;
const INK_DARK = "#0f0f14"; // glyphs/text on accent fills

function PanelWaveBar({ wave, index, color }: { wave: SharedValue<number[]>; index: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const v = wave.value[index] ?? 0;
    // pow > 1 tames the mids the noise gate lets through — peaks still land,
    // ordinary room rumble stays near the centerline instead of saturating.
    return { height: WBAR_MIN + Math.pow(v, 1.5) * WBAR_SWING };
  });
  return <Animated.View style={[styles.waveBar, { backgroundColor: color }, style]} />;
}

type ConfirmKind = "delete" | "restart" | null;

interface StubCapturePanelProps {
  status: CaptureStatus;
  remainingMs: number;
  durationMs: number;
  level: SharedValue<number>;
  // Compact pose for the detached bottom dock — verbs only, no strip, no waveform.
  docked?: boolean;
  // Inline pose: 0 → verbs seated · 1 → verbs handed off to the dock. Drives the
  // parallax fade/sink of the verb row ONLY (strip + wave stay put and simply
  // scroll with the page).
  detachProgress?: SharedValue<number>;
  // While the dock owns the verbs, the seated (faded) row must not take touches.
  rowsInert?: boolean;
  onCancel: () => void; // during arming
  onPause: () => void;
  onResume: () => void;
  onStartOver: () => void;
  onDone: () => void;
  onDiscard: () => void;
}

export default function StubCapturePanel({
  status,
  remainingMs,
  durationMs,
  level,
  docked,
  detachProgress,
  rowsInert,
  onCancel,
  onPause,
  onResume,
  onStartOver,
  onDone,
  onDiscard,
}: StubCapturePanelProps) {
  const recording = status === "recording";
  const paused = status === "paused";
  const arming = status === "arming";

  // Freeze (don't flatten) the wave on pause, so the paused pose still shows the take.
  const wave = useWaveHistory(recording && !docked, level, PANEL_WAVE_N, false);
  const waveColor = recording ? ink(0.88) : ink(0.5);

  const elapsed = formatCaptureTime(durationMs - remainingMs);

  // Inline confirms (Paper 06/07) — the verb row swaps in place, nothing overlays.
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  useEffect(() => {
    if (!paused) setConfirm(null);
  }, [paused]);

  const handlePause = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPause();
  };

  const handleResume = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onResume();
  };

  const askRestart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConfirm("restart");
  };

  const confirmRestart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfirm(null);
    wave.value = new Array(PANEL_WAVE_N).fill(0); // restart discards — old bars go too
    onStartOver();
  };

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDone();
  };

  const askDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConfirm("delete");
  };

  const confirmDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setConfirm(null);
    onDiscard();
  };

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCancel();
  };

  // The verb row's side of the parallax — fades and sinks as the dock rises.
  const dp = detachProgress;
  const rowAreaStyle = useAnimatedStyle(() => ({
    opacity: dp ? 1 - dp.value : 1,
    transform: [{ translateY: dp ? dp.value * 16 : 0 }],
  }));

  // Live audibility watch — BOTH poses (the docked bar included: a doomed-quiet
  // take must be catchable while the user is reading the cast list, not only
  // while the wave is on screen). If the meter hasn't seen confident speech for
  // a few seconds, gently ask for more voice.
  const [quietHint, setQuietHint] = useState(false);
  useEffect(() => {
    if (!recording) {
      setQuietHint(false);
      return;
    }
    let lastLoud = Date.now(); // grace window from the start of recording
    const id = setInterval(() => {
      if (level.value > 0.5) lastLoud = Date.now();
      setQuietHint(Date.now() - lastLoud > 4000);
    }, 500);
    return () => clearInterval(id);
  }, [recording, level]);

  return (
    <View style={[styles.panel, docked && styles.panelDocked]}>
      {/* Docked: real chrome — blur + dark tint, so content never bleeds through. */}
      {docked && (
        <BlurView
          intensity={45}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      )}

      {/* Header strip (inline pose only — the dock is just the tray, Paper 04/05):
          the Paper lime bar translated — accent-filled while hot (dark glyphs,
          like the nav's active bubble), quiet glass otherwise. */}
      {!docked && (
      <View style={[styles.strip, recording ? styles.stripHot : styles.stripQuiet]}>
        <View style={styles.stripLeft}>
          {recording ? (
            <View style={styles.liveDot} />
          ) : paused ? (
            <Ionicons name="pause" size={12} color={ink(0.92)} />
          ) : (
            <View style={styles.armDot} />
          )}
          <Text style={[styles.stripLabel, recording && styles.onAccent]}>
            {recording ? "RECORDING" : paused ? "PAUSED" : "GET READY"}
          </Text>
        </View>
        <Text style={[styles.stripTimer, recording ? styles.onAccent : { color: ink(0.92) }]}>
          {elapsed}
        </Text>
      </View>
      )}

      <View style={styles.body}>
        {/* Waveform (inline pose only) — a fixed count of bars distributed
            edge-to-edge (space-between, never a fractional gap), growing
            symmetrically off a visible centerline. */}
        {!docked && (
          <View style={styles.waveRow} pointerEvents="none">
            <View style={styles.waveCenterline} />
            {Array.from({ length: PANEL_WAVE_N }).map((_, i) => (
              <PanelWaveBar key={i} wave={wave} index={i} color={waveColor} />
            ))}
          </View>
        )}

        {/* Too quiet? Say so NOW, while the take can still be saved by speaking up. */}
        {recording && quietHint && (
          <Animated.View
            entering={FadeIn.duration(240)}
            exiting={FadeOut.duration(200)}
            style={styles.quietRow}
          >
            <Ionicons name="mic-off-outline" size={12} color={INK_AMBER} />
            <Text style={styles.quietText}>{"CAN BARELY HEAR YOU — SPEAK A LITTLE LOUDER"}</Text>
          </Animated.View>
        )}

        {/* Verbs — boxed rectangles per Paper 02/03; each row's touchables are
            flex:1 TouchableOpacity wrappers so the boxes split the width evenly.
            The whole verb area rides the detach parallax: it fades/sinks here
            exactly as the dock rises below. */}
        <Animated.View style={rowAreaStyle} pointerEvents={rowsInert ? "none" : "auto"}>
        {recording && (
          <View style={styles.btnRow}>
            {/* Docked (Paper 04): the elapsed time RIDES the pause button — the
                count doubles as proof the mic is live. Inline keeps the word. */}
            <TouchableOpacity
              onPress={handlePause}
              activeOpacity={0.72}
              style={styles.btnTouch}
              accessibilityRole="button"
              accessibilityLabel="Pause recording"
            >
              <View style={styles.btnFace}>
                <Ionicons name="pause" size={14} color={ink(0.95)} />
                <Text style={[styles.btnLabel, docked && styles.btnTimer]}>
                  {docked ? elapsed : "PAUSE"}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              activeOpacity={0.72}
              style={styles.btnTouch}
              accessibilityRole="button"
              accessibilityLabel="Stop and save take"
            >
              <View style={styles.btnFace}>
                <Ionicons name="stop" size={14} color={ink(0.95)} />
                <Text style={styles.btnLabel}>{"STOP & SAVE"}</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Docked paused (Paper 05): "time stays, now labelled CAPTURED — it's a
            quantity to judge, not a clock." */}
        {paused && confirm === null && docked && (
          <View style={styles.capturedRow}>
            <Text style={styles.capturedTime}>{elapsed}</Text>
            <Text style={styles.capturedTag}>CAPTURED</Text>
          </View>
        )}

        {paused && confirm === null && (
          <View style={styles.btnRow}>
            {/* RESUME — the one filled verb (Paper 03's lime slot → ticket accent). */}
            <TouchableOpacity
              onPress={handleResume}
              activeOpacity={0.72}
              style={styles.btnTouch}
              accessibilityRole="button"
              accessibilityLabel="Resume"
            >
              <View style={[styles.optFace, styles.optFaceFilled, docked && styles.optFaceDocked]}>
                <Ionicons name="play" size={18} color={INK_DARK} />
                <Text style={[styles.optLabel, styles.optLabelDark]}>Resume</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={askRestart}
              activeOpacity={0.72}
              style={styles.btnTouch}
              accessibilityRole="button"
              accessibilityLabel="Restart"
            >
              <View style={[styles.optFace, docked && styles.optFaceDocked]}>
                <Ionicons name="refresh" size={18} color={ink(0.92)} />
                <Text style={styles.optLabel}>Restart</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              activeOpacity={0.72}
              style={styles.btnTouch}
              accessibilityRole="button"
              accessibilityLabel="Save"
            >
              <View style={[styles.optFace, docked && styles.optFaceDocked]}>
                <Ionicons name="checkmark-circle" size={18} color={SAVE_GREEN} />
                <Text style={styles.optLabel}>Save</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={askDelete}
              activeOpacity={0.72}
              style={styles.btnTouch}
              accessibilityRole="button"
              accessibilityLabel="Delete"
            >
              <View style={[styles.optFace, docked && styles.optFaceDocked]}>
                <Ionicons name="trash-outline" size={18} color={DANGER} />
                <Text style={styles.optLabel}>Delete</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Paper 06 — the row swaps: "Delete this take?" KEEP IT / DELETE. */}
        {paused && confirm === "delete" && (
          <View style={styles.confirmBlock}>
            <Text style={styles.confirmTitle}>Delete this take?</Text>
            <Text style={styles.confirmSub}>
              {elapsed} of audio, not saved yet. This can't be undone.
            </Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                onPress={() => setConfirm(null)}
                activeOpacity={0.72}
                style={styles.btnTouch}
                accessibilityRole="button"
                accessibilityLabel="Keep this take"
              >
                <View style={[styles.btnFace, styles.btnFaceFilled]}>
                  <Text style={[styles.btnLabel, styles.onAccent]}>KEEP IT</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDelete}
                activeOpacity={0.72}
                style={styles.btnTouch}
                accessibilityRole="button"
                accessibilityLabel="Delete this take"
              >
                <View style={styles.btnFace}>
                  <Ionicons name="trash-outline" size={14} color={DANGER} />
                  <Text style={[styles.btnLabel, { color: DANGER }]}>DELETE</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Paper 07 — "Start over?" CANCEL / RESTART. */}
        {paused && confirm === "restart" && (
          <View style={styles.confirmBlock}>
            <Text style={styles.confirmTitle}>Start over?</Text>
            <Text style={styles.confirmSub}>
              This discards all {elapsed} and begins recording again immediately.
            </Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                onPress={() => setConfirm(null)}
                activeOpacity={0.72}
                style={styles.btnTouch}
                accessibilityRole="button"
                accessibilityLabel="Cancel restart"
              >
                <View style={[styles.btnFace, styles.btnFaceFilled]}>
                  <Text style={[styles.btnLabel, styles.onAccent]}>CANCEL</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmRestart}
                activeOpacity={0.72}
                style={styles.btnTouch}
                accessibilityRole="button"
                accessibilityLabel="Restart recording"
              >
                <View style={styles.btnFace}>
                  <Ionicons name="refresh" size={14} color={ink(0.95)} />
                  <Text style={styles.btnLabel}>RESTART</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {arming && (
          <View style={styles.btnRow}>
            <TouchableOpacity
              onPress={handleCancel}
              activeOpacity={0.72}
              style={styles.btnTouch}
              accessibilityRole="button"
              accessibilityLabel="Cancel recording"
            >
              <View style={styles.btnFace}>
                <Text style={styles.btnLabel}>CANCEL</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A defined module on the ticket glass — its own surface, rim, and clipped strip.
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(12,12,16,0.45)",
    overflow: "hidden",
  },
  // Docked pose: floating chrome over arbitrary content — blur + a heavier tint.
  panelDocked: {
    backgroundColor: "rgba(10,10,14,0.62)",
    borderColor: "rgba(255,255,255,0.22)",
  },
  // Docked pause button wears the elapsed time.
  btnTimer: {
    fontSize: 12.5,
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
  // Docked paused meta — the captured quantity above the four options.
  capturedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 2,
  },
  capturedTime: {
    color: ink(0.95),
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  capturedTag: {
    color: ink(0.5),
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  strip: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 13,
  },
  stripHot: {
    backgroundColor: TICKET_ACCENT,
  },
  stripQuiet: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
  },
  stripLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RED,
  },
  armDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ink(0.5),
  },
  stripLabel: {
    color: ink(0.92),
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  stripTimer: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
  onAccent: {
    color: INK_DARK,
  },
  body: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 12,
  },
  waveRow: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  waveCenterline: {
    position: "absolute",
    left: 2,
    right: 2,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
  },
  btnRow: {
    flexDirection: "row",
    gap: 8,
  },
  // Bare layout wrapper — flex:1 splits the row evenly; visuals live on the face.
  btnTouch: {
    flex: 1,
  },
  btnFace: {
    height: 44,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.28)",
  },
  btnFaceFilled: {
    backgroundColor: TICKET_ACCENT,
    borderColor: TICKET_ACCENT,
  },
  btnLabel: {
    color: ink(0.95),
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  // Paused four-up — icon over label in a boxed rectangle (Paper 03's slots).
  optFace: {
    height: 54,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.24)",
  },
  optFaceDocked: {
    height: 48,
  },
  optFaceFilled: {
    backgroundColor: TICKET_ACCENT,
    borderColor: TICKET_ACCENT,
  },
  optLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  optLabelDark: {
    color: INK_DARK,
    fontWeight: "800",
  },
  // The too-quiet nudge — amber whisper under the wave.
  quietRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  quietText: {
    color: INK_AMBER,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  // Inline confirm block — Paper 06/07's row-swap, text then two verbs.
  confirmBlock: {
    gap: 8,
  },
  confirmTitle: {
    color: ink(0.95),
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  confirmSub: {
    color: ink(0.55),
    fontSize: 11.5,
    lineHeight: 16,
    marginBottom: 2,
  },
});
