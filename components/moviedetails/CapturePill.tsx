import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { NAV_SPRING } from "@/contexts/NavMorphContext";
import type { CaptureStatus } from "@/hooks/useCaptureSession";

// Shared capture palette — the in-ticket panel imports these so both surfaces
// speak one color language.
export const ACCENT = "#9ccadf";
export const AMBER = "#FFAE42";
export const RED = "#ef4444";
export const DANGER = "#ff6b6b";
export const SAVE_GREEN = "#8fd6b3";
export const NEUTRAL = "rgba(255,255,255,0.92)";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// Docked bottom-center. The gap is the knob for how far it floats above the safe area.
const PILL_BOTTOM_GAP = 14;

// ── Morph geometry (the nav pill's proven slot technique) ────────────────────
// ONE bar, always mounted. progress 0 = expanded options, 1 = collapsed capsule.
// Each of the 4 slots animates its own width; inside, two absolutely-positioned
// centered layers (labeled option ↔ dot/bar) cross-fade. Labels are laid out ONCE
// at a fixed width and clipped during the glide — they can never smush or overlap.
// Collapsed pose copies the MAIN NAV's capsule numbers exactly (40 tall, radius 20,
// pad 10, 30-wide dot slots, 8px dots) so every minimized bar in the app is one size.
const BAR_H = { exp: 64, col: 40 };
const BAR_RADIUS = { exp: 32, col: 20 };
const BAR_PAD_H = { exp: 8, col: 10 };
// Short uniform labels (Resume · Restart · Save · Delete — max 7 chars) keep the slots
// tight and the rhythm even; color coding lives in the ICONS, labels stay one quiet gray.
const OPT_W = 72; // expanded slot width — 4 evenly spaced labeled columns
const COL_SLOT_W = 30; // collapsed slot width — one dot each (nav TAB_W.col)
const OPT_LABEL_W = 64; // fixed label width (laid out once, clipped while gliding)

// Idle dots (nav DOT).
const DOT = 8;

// Recording waveform — a rolling HISTORY of mic levels across many thin bars, so speech
// travels through the capsule as a genuine wave. Silence = every bar at 2px, which reads
// as a flat line; sound pops the newest bars and ripples left.
const WAVE_N = 20; // bars across the capsule
const WAVE_TICK_MS = 70; // history push cadence
const WBAR_W = 3;
const WBAR_GAP = 2.5;
const WBAR_MIN = 2;
const WBAR_SWING = 20; // max growth above the flat line — quieter ceiling, so motion reads

// Save confirmation chime (generated asset — ascending "ba·da·da·DING").
export const DING = require("@/assets/sounds/take-saved.wav");
// Delete confirmation (generated asset — a deep descending "thoom" + sub thump).
export const THUD = require("@/assets/sounds/take-deleted.wav");

// Time-left → color: calm accent → amber → red as the take runs down. Shared with
// the in-ticket capture panel so both surfaces tell time the same way.
export const timeColor = (remainingMs: number, durationMs: number): string => {
  const used = 1 - Math.max(0, Math.min(1, remainingMs / durationMs));
  if (used < 0.6) return ACCENT;
  if (used < 0.85) return AMBER;
  return RED;
};

// Rolling mic-level history for a waveform: every tick pushes a level in on the
// right and everything shifts left — speech genuinely TRAVELS across the bar.
//
// The level is ADAPTIVELY NOISE-GATED, not just boosted. The dB meter puts ordinary
// room noise around 0.25–0.4, so a fixed boost saturated the bars near-full-height
// all the time and speech had no headroom left to show. Instead we track the room's
// own noise floor (sinks instantly to quiet, creeps up slowly) and the recent speech
// peak (jumps up, decays gently), then draw each bar from the level's position
// BETWEEN them: silence hugs the floor → flat line; speech spans the whole swing —
// on any mic, in any room. Shared by the docked pill and the in-ticket panel.
// `resetOnInactive: false` keeps the last wave frozen (the panel's paused pose).
export function useWaveHistory(
  active: boolean,
  level: SharedValue<number>,
  n: number,
  resetOnInactive = true
) {
  const wave = useSharedValue<number[]>(new Array(n).fill(0));
  const noiseFloor = useRef(0.5);
  const speechPeak = useRef(0);
  useEffect(() => {
    if (!active) {
      if (resetOnInactive) wave.value = new Array(n).fill(0); // settle back to the flat line
      return;
    }
    noiseFloor.current = 0.5; // re-learn the room each take
    speechPeak.current = 0;
    const id = setInterval(() => {
      const raw = level.value;
      noiseFloor.current = raw < noiseFloor.current ? raw : Math.min(1, noiseFloor.current + 0.002);
      // Peak never sits closer than 0.18 above the floor, so faint hiss wobble can't
      // get stretched into a fake full-range wave.
      speechPeak.current = Math.max(raw, speechPeak.current * 0.985, noiseFloor.current + 0.18);
      const gated = Math.max(0, raw - noiseFloor.current - 0.03); // 0.03 dead-band eats breath noise
      const norm = Math.min(1, gated / (speechPeak.current - noiseFloor.current));
      const next = wave.value.slice(1);
      next.push(Math.pow(norm, 0.8));
      wave.value = next;
    }, WAVE_TICK_MS);
    return () => clearInterval(id);
  }, [active, wave, level, n, resetOnInactive]);
  return wave;
}

// One bar of the rolling waveform — reads its slot in the shared history buffer.
function WaveBar({ wave, index, color }: { wave: SharedValue<number[]>; index: number; color: string }) {
  const style = useAnimatedStyle(() => ({
    height: WBAR_MIN + (wave.value[index] ?? 0) * WBAR_SWING,
  }));
  return <Animated.View style={[styles.waveBar, { backgroundColor: color }, style]} />;
}

/**
 * One slot of the pill (the nav bar's MorphSlot, adapted). The slot's width
 * interpolates between the labeled-option pose and the dot/bar pose; the two
 * layers cross-fade and scale. `collapsed` is whatever the minimized capsule
 * shows in this position (idle dot · live bar · colored paused dot).
 */
function OptionSlot({
  progress,
  icon,
  label,
  tint,
  onPress,
  interactive,
  collapsed,
}: {
  progress: SharedValue<number>;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  onPress: () => void;
  interactive: boolean;
  collapsed: React.ReactNode;
}) {
  const slotStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [OPT_W, COL_SLOT_W]),
  }));
  const glyphStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.55]) }],
  }));
  const collapsedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.55, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0.55, 1], [0.5, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <Animated.View style={[styles.slot, slotStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, glyphStyle]}>
        <Pressable
          onPress={onPress}
          disabled={!interactive}
          style={({ pressed }) => [styles.optPressable, pressed && styles.optPressed]}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          {/* Icon and label are both fixed-width blocks (same width, both centered), so
              their centerlines are locked together — the icon always sits dead-center
              over its word. Color coding lives in the icon; the label stays quiet. */}
          <View style={styles.optIconWrap}>
            <Ionicons name={icon} size={20} color={tint} />
          </View>
          <Text numberOfLines={1} style={styles.optLabel}>
            {label}
          </Text>
        </Pressable>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, collapsedStyle]} pointerEvents="none">
        {collapsed}
      </Animated.View>
    </Animated.View>
  );
}

// ── Save confetti — a full-screen rain falling from the top ──────────────────
const CONFETTI_COLORS = [ACCENT, "#c8b6ff", AMBER, "#ffffff", SAVE_GREEN];
const RAIN_COUNT = 28;
export const RAIN_LIFETIME_MS = 2600;

type RainCfg = {
  x: number;
  delay: number;
  dur: number;
  sway: number;
  amp: number;
  spin: number;
  w: number;
  h: number;
  color: string;
};

function RainPiece({ cfg }: { cfg: RainCfg }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(cfg.delay, withTiming(1, { duration: cfg.dur, easing: Easing.in(Easing.quad) }));
  }, [t, cfg.delay, cfg.dur]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.04, 0.85, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [-30, SCREEN_H + 50]) },
      { translateX: Math.sin(t.value * Math.PI * cfg.sway) * cfg.amp },
      { rotate: `${cfg.spin * t.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[styles.rainPiece, { left: cfg.x, backgroundColor: cfg.color, width: cfg.w, height: cfg.h }, style]}
    />
  );
}

export function ConfettiRain() {
  const pieces = useMemo<RainCfg[]>(
    () =>
      Array.from({ length: RAIN_COUNT }, (_, i) => ({
        x: Math.random() * (SCREEN_W - 12),
        delay: Math.random() * 320,
        dur: 1300 + Math.random() * 800,
        sway: 1.5 + Math.random() * 2.5,
        amp: 16 + Math.random() * 34,
        spin: (Math.random() * 2 - 1) * 720,
        w: 6 + Math.random() * 5,
        h: 4 + Math.random() * 3,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    []
  );

  return (
    <View style={styles.rainHost} pointerEvents="none">
      {pieces.map((cfg, i) => (
        <RainPiece key={i} cfg={cfg} />
      ))}
    </View>
  );
}

// ── Swipe-to-confirm delete overlay ──────────────────────────────────────────
const TRACK_W = 244;
const THUMB = 46;
const TRACK_PAD = 4;
const MAX_X = TRACK_W - THUMB - TRACK_PAD * 2;

export function SwipeToDelete({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const x = useSharedValue(0);

  const confirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onConfirm();
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      x.value = Math.max(0, Math.min(MAX_X, e.translationX));
    })
    .onEnd(() => {
      if (x.value >= MAX_X * 0.92) {
        x.value = withTiming(MAX_X, { duration: 80 });
        runOnJS(confirm)();
      } else {
        // Decisive ease-out return — zero oscillation (a bouncy snap-back read as silly).
        x.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // Red fill trails the thumb and deepens as you commit — transform + opacity only.
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - TRACK_W + THUMB + TRACK_PAD }],
    opacity: interpolate(x.value, [0, MAX_X], [0.5, 1], Extrapolation.CLAMP),
  }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, MAX_X * 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <View style={styles.deleteRoot}>
      <Animated.View style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Cancel deletion">
          <BlurView intensity={20} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <View style={styles.deleteDim} />
        </Pressable>
      </Animated.View>

      <View style={styles.deleteCard}>
        <BlurView intensity={50} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={styles.deleteCardTint} pointerEvents="none" />

        <Text style={styles.deleteTitle}>Delete this take?</Text>
        <Text style={styles.deleteSub}>This can't be undone.</Text>

        {/* One instruction, said once — inside the track, fading as you commit. */}
        <View style={styles.track}>
          <Animated.View style={[styles.trackFill, fillStyle]} />
          <Animated.View style={[styles.trackHintRow, hintStyle]} pointerEvents="none">
            <Text style={styles.trackHint}>Slide to delete</Text>
            <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.4)" />
            <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.2)" style={styles.trackChevron2} />
          </Animated.View>
          <GestureDetector gesture={pan}>
            <Animated.View style={[styles.thumb, thumbStyle]}>
              <Ionicons name="trash" size={18} color="#fff" />
            </Animated.View>
          </GestureDetector>
        </View>

        <Pressable
          onPress={onCancel}
          hitSlop={10}
          style={({ pressed }) => [styles.deleteCancel, pressed && styles.deleteCancelPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.deleteCancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface CapturePillProps {
  status: CaptureStatus;
  remainingMs: number;
  durationMs: number;
  level: SharedValue<number>;
  bottomInset: number;
  // The screen's scroll-fold value (0 = full, 1 = minimized) — folds the collapsed pill in
  // step with the top INFO/ENTRIES toggle and collapses the expanded paused panel.
  shrink?: SharedValue<number>;
  // The record entry point now lives in the ticket stub — with this set, the idle
  // 4-dot capsule never shows; the bar only appears once a take is live. The
  // component stays mounted so the save confetti can outlive the take.
  hideIdle?: boolean;
  // While the in-ticket capture panel is on screen the pill stays out of the way;
  // scrolling the panel off "detaches" the controls into this docked bar (the
  // Paper flow's screens 04–05). Hides the bar only — confetti/confirm overlays
  // still render.
  hidden?: boolean;
  // Elapsed take time ("0:42") shown as a small badge over the recording waveform —
  // the detached dock keeps telling time (Paper 04: the count proves the mic is live).
  elapsedLabel?: string;
  onStart: () => void; // tap the 4 dots → arming countdown
  onCancel: () => void; // tap during arming
  onPause: () => void;
  onResume: () => void; // "Resume" → fresh 3·2·1 → resumes
  onStartOver: () => void; // fresh 3·2·1 → records from scratch
  onDone: () => void; // "Save"
  onDiscard: () => void; // confirmed delete
}

/**
 * The capture pill — bottom-center, everything in fours, built on the SAME slot-morph
 * technique as the homepage nav pill (one bar, animated slot widths, cross-faded layers,
 * NAV_SPRING) so the expanded ⇄ minimized transition feels identical:
 *
 *   idle      →  capsule with 4 accent dots · TAP starts the 3·2·1
 *   recording →  capsule with 4 mic-reactive bars (color = time left) · TAP pauses
 *   paused    →  the capsule morphs into 4 evenly-spaced labeled options — colored icons
 *                (Resume=accent · Restart=white · Save=green · Delete=red) over quiet
 *                uniform gray labels. Scroll-down morphs it back to 4 dots, each wearing
 *                its option's color; scroll-up (or a tap) expands it again.
 */
export default function CapturePill({
  status,
  remainingMs,
  durationMs,
  level,
  bottomInset,
  shrink,
  hideIdle,
  hidden,
  elapsedLabel,
  onStart,
  onCancel,
  onPause,
  onResume,
  onStartOver,
  onDone,
  onDiscard,
}: CapturePillProps) {
  const recording = status === "recording";
  const paused = status === "paused";
  const arming = status === "arming";
  const color = timeColor(remainingMs, durationMs);

  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [burst, setBurst] = useState(0);

  // Auto-expand the moment recording stops; leaving paused folds everything away.
  useEffect(() => {
    setExpanded(paused);
    if (!paused) setConfirmingDelete(false);
  }, [paused]);

  // Rolling noise-gated waveform history — shared hook (see useWaveHistory above).
  const wave = useWaveHistory(recording, level, WAVE_N);

  // The morph driver — the nav pill's spring, so both pills move identically.
  const showPanel = paused && expanded;
  const progress = useSharedValue(1); // 0 = expanded options, 1 = collapsed capsule
  useEffect(() => {
    progress.value = withSpring(showPanel ? 0 : 1, NAV_SPRING);
  }, [showPanel, progress]);

  // Scroll-reactive like the nav pill: scrolling down folds the panel back to the capsule,
  // scrolling up brings the options right back (no tap required). Driven by the same
  // fold value as the top bar, so everything moves together.
  const collapseFromScroll = () => setExpanded(false);
  const expandFromScroll = () => setExpanded(true);
  useAnimatedReaction(
    () => (shrink ? shrink.value : 0),
    (s, prev) => {
      const p = prev ?? 0;
      if (s > 0.5 && p <= 0.5) runOnJS(collapseFromScroll)();
      else if (s < 0.5 && p >= 0.5) runOnJS(expandFromScroll)();
    }
  );

  // Bar pose: height / padding / radius interpolate between the two shapes.
  const barStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [BAR_H.exp, BAR_H.col]),
    paddingHorizontal: interpolate(progress.value, [0, 1], [BAR_PAD_H.exp, BAR_PAD_H.col]),
    borderRadius: interpolate(progress.value, [0, 1], [BAR_RADIUS.exp, BAR_RADIUS.col]),
  }));

  // Scroll fold (collapsed pose only) + press squeeze — transforms on the outer host.
  const pressScale = useSharedValue(1);
  const foldStyle = useAnimatedStyle(() => {
    const s = shrink ? shrink.value : 0;
    const c = progress.value; // fold applies in proportion to how collapsed we are
    return {
      opacity: 1 - s * 0.08 * c,
      transform: [{ scale: (1 - s * 0.12 * c) * pressScale.value }, { translateY: s * 3 * c }],
    };
  });

  // Save chime / delete thud + confetti lifecycle.
  const ding = useAudioPlayer(DING);
  const thud = useAudioPlayer(THUD);
  const dingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (dingTimer.current) clearTimeout(dingTimer.current);
      if (thudTimer.current) clearTimeout(thudTimer.current);
      if (burstTimer.current) clearTimeout(burstTimer.current);
    };
  }, []);

  const onCapsulePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (status === "idle") onStart();
    else if (arming) onCancel();
    else if (recording) onPause(); // → paused → auto-morphs into the 4 options
    else if (paused) setExpanded(true); // re-open after a scroll-collapse
  };

  const handleContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onResume(); // hook re-arms with a fresh 3·2·1, then resumes the same take
  };

  const handleStartOver = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStartOver(); // hook re-arms with a fresh 3·2·1
  };

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBurst((b) => b + 1); // full-screen confetti rain
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => setBurst(0), RAIN_LIFETIME_MS + 800);
    if (dingTimer.current) clearTimeout(dingTimer.current);
    dingTimer.current = setTimeout(() => {
      try {
        ding.seekTo(0);
        ding.play();
      } catch (e) {
        console.warn("Save chime failed:", e);
      }
    }, 400);
    onDone();
  };

  const handleDeletePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConfirmingDelete(true);
  };

  const handleDeleteConfirmed = () => {
    setConfirmingDelete(false);
    if (thudTimer.current) clearTimeout(thudTimer.current);
    thudTimer.current = setTimeout(() => {
      try {
        thud.seekTo(0);
        thud.play();
      } catch (e) {
        console.warn("Delete thud failed:", e);
      }
    }, 380);
    onDiscard();
  };

  // The 4 options — their colors ALSO paint the dots in the minimized paused
  // capsule, so each dot reads as its option in embryo.
  const OPTIONS: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    tint: string;
    onPress: () => void;
  }[] = [
    { icon: "play", label: "Resume", tint: ACCENT, onPress: handleContinue },
    { icon: "refresh", label: "Restart", tint: NEUTRAL, onPress: handleStartOver },
    { icon: "checkmark-circle", label: "Save", tint: SAVE_GREEN, onPress: handleSave },
    { icon: "trash-outline", label: "Delete", tint: DANGER, onPress: handleDeletePress },
  ];

  // What each slot shows in the collapsed capsule for the current status. Paused
  // minimizes to DOTS (same as idle, matching the nav pill) — each dot simply wears
  // its option's color so the four options still read in embryo. While RECORDING the
  // slots go empty: the full-width waveform overlay owns the capsule instead.
  const collapsedContent = (i: number) => {
    if (recording) return null;
    if (paused) return <View style={[styles.dot, { backgroundColor: OPTIONS[i].tint }]} />;
    return <View style={[styles.dot, { backgroundColor: arming ? "rgba(255,255,255,0.7)" : ACCENT }]} />;
  };

  const capsuleLabel =
    status === "idle"
      ? "Tap to record your take"
      : arming
        ? "Starting soon, tap to cancel"
        : recording
          ? "Recording, tap to pause"
          : "Paused, tap for options";

  return (
    <>
      {/* Delete confirmation — swipe to confirm, full-screen above everything. */}
      {confirmingDelete && paused && (
        <SwipeToDelete onConfirm={handleDeleteConfirmed} onCancel={() => setConfirmingDelete(false)} />
      )}

      {/* Full-screen confetti rain on save. */}
      {burst > 0 && <ConfettiRain key={burst} />}

      {!hidden && !(hideIdle && status === "idle") && (
      <View style={[styles.wrapper, { paddingBottom: bottomInset + PILL_BOTTOM_GAP }]} pointerEvents="box-none">
        <Animated.View style={foldStyle}>
          <Animated.View
            style={[
              styles.barShell,
              arming && styles.barArming,
              recording && { borderColor: color },
              paused && styles.barPaused,
              barStyle,
            ]}
          >
            <BlurView intensity={45} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />

            <View style={styles.slotRow} pointerEvents={showPanel ? "auto" : "none"}>
              {OPTIONS.map((opt, i) => (
                <OptionSlot
                  key={opt.label}
                  progress={progress}
                  icon={opt.icon}
                  label={opt.label}
                  tint={opt.tint}
                  onPress={opt.onPress}
                  interactive={showPanel}
                  collapsed={collapsedContent(i)}
                />
              ))}
            </View>

            {/* Recording: the rolling waveform spans the whole capsule — a flat 2px line
                in silence, popping and travelling with real speech. */}
            {recording && (
              <View style={styles.waveOverlay} pointerEvents="none">
                {Array.from({ length: WAVE_N }).map((_, i) => (
                  <WaveBar key={i} wave={wave} index={i} color={color} />
                ))}
              </View>
            )}

            {/* Detached-dock timer (Paper 04) — a small badge riding the wave's right edge. */}
            {recording && !!elapsedLabel && (
              <View style={styles.timeBadge} pointerEvents="none">
                <Text style={styles.timeBadgeText}>{elapsedLabel}</Text>
              </View>
            )}

            {/* Collapsed: the whole capsule is one generous target (start / cancel /
                pause / re-expand) — an option can never mis-fire while minimized. */}
            {!showPanel && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={capsuleLabel}
                onPress={onCapsulePress}
                onPressIn={() => (pressScale.value = withTiming(0.95, { duration: 110 }))}
                onPressOut={() => (pressScale.value = withTiming(1, { duration: 140 }))}
                hitSlop={12}
                style={StyleSheet.absoluteFill}
              />
            )}
          </Animated.View>
        </Animated.View>
      </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center", // bottom-center dock — capsule and panel share this baseline
    zIndex: 850,
  },
  // ONE shell for both poses — the bar hugs its animated slots (the nav pill recipe).
  barShell: {
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    backgroundColor: "rgba(15, 15, 20, 0.45)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  barArming: {
    borderColor: "rgba(239,68,68,0.6)",
  },
  barPaused: {
    borderColor: "rgba(255,255,255,0.18)",
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
  },
  slot: {
    height: "100%",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  optPressable: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  optPressed: {
    opacity: 0.6,
  },
  optIconWrap: {
    width: OPT_LABEL_W, // identical to the label block → shared centerline
    alignItems: "center",
  },
  optLabel: {
    // Fixed width + centered: laid out once, clipped during the glide — never reflows.
    // One muted color for ALL labels (the icons carry the color coding) — four different
    // colored words read as noise.
    width: OPT_LABEL_W,
    textAlign: "center",
    color: "rgba(255,255,255,0.55)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    includeFontPadding: false,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  // The recording waveform overlay — centered across the capsule.
  waveOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WBAR_GAP,
  },
  waveBar: {
    width: WBAR_W,
    borderRadius: WBAR_W / 2,
  },
  // Elapsed-time badge on the docked recording capsule — right edge, quiet plate.
  timeBadge: {
    position: "absolute",
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  timeBadgeText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    fontVariant: ["tabular-nums"],
    backgroundColor: "rgba(10,10,14,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 7,
    overflow: "hidden",
  },
  // --- Confetti rain (full screen) ---
  rainHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1800,
    overflow: "hidden",
  },
  rainPiece: {
    position: "absolute",
    top: 0,
    borderRadius: 1.5,
  },
  // --- Swipe-to-confirm delete ---
  deleteRoot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  deleteDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  // Proven centered-card layout (self-centering children — no divider/row architecture,
  // which misrendered on Fabric and clipped the Cancel).
  deleteCard: {
    width: 300,
    borderRadius: 24,
    overflow: "hidden",
    alignItems: "center",
    paddingTop: 22,
    paddingBottom: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
  },
  deleteCardTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20,22,28,0.8)",
  },
  deleteTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  deleteSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12.5,
    marginTop: 4,
    marginBottom: 18,
  },
  track: {
    width: TRACK_W,
    height: THUMB + TRACK_PAD * 2,
    borderRadius: (THUMB + TRACK_PAD * 2) / 2,
    padding: TRACK_PAD,
    overflow: "hidden",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  trackFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: TRACK_W,
    // Base alpha × the drag-driven opacity (0.5 → 1) = the red deepens as you commit.
    backgroundColor: "rgba(239,68,68,0.4)",
  },
  trackHintRow: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    marginLeft: THUMB / 2, // visually centered in the space right of the thumb
  },
  trackHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12.5,
    fontWeight: "600",
    marginRight: 3,
  },
  trackChevron2: {
    marginLeft: -8, // overlaps into a ›› direction cue
  },
  thumb: {
    position: "absolute",
    left: TRACK_PAD,
    top: TRACK_PAD,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: RED,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  deleteCancel: {
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  deleteCancelPressed: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  deleteCancelText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: "600",
  },
});
