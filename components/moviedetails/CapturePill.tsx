import React, { useEffect, useMemo, useRef } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

// ⚠ THE CAPTURE PILL THIS FILE IS NAMED FOR IS GONE. The docked slot-morph pill
// (idle dots → waveform capsule → four labeled options, plus its SwipeToDelete
// overlay) was replaced by the floating floor — CaptureWell + FloatingVerbs —
// and its unmounted remains were deleted in the 2026-08-12 pre-publish sweep;
// git history has the full component. What lives on here is everything the
// capture flow still shares:
//
//   · the save/delete celebration (ConfettiRain + the DING/THUD assets),
//     screen-owned by the movie page so it outlives whichever surface fired it;
//   · useWaveHistory, the noise-gated rolling mic waveform CaptureWell renders;
//   · the palette bits those two still speak.

const ACCENT = "#9ccadf";
const AMBER = "#FFAE42";
export const SAVE_GREEN = "#8fd6b3";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// History push cadence for the rolling waveform.
const WAVE_TICK_MS = 70;

// Save confirmation chime (generated asset — ascending "ba·da·da·DING").
export const DING = require("@/assets/sounds/take-saved.wav");
// Delete confirmation (generated asset — a deep descending "thoom" + sub thump).
export const THUD = require("@/assets/sounds/take-deleted.wav");

// Rolling mic-level history for a waveform: every tick pushes a level in on the
// right and everything shifts left — speech genuinely TRAVELS across the bar.
//
// The level is ADAPTIVELY NOISE-GATED, not just boosted. The dB meter puts ordinary
// room noise around 0.25–0.4, so a fixed boost saturated the bars near-full-height
// all the time and speech had no headroom left to show. Instead we track the room's
// own noise floor (sinks instantly to quiet, creeps up slowly) and the recent speech
// peak (jumps up, decays gently), then draw each bar from the level's position
// BETWEEN them: silence hugs the floor → flat line; speech spans the whole swing —
// on any mic, in any room.
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

const styles = StyleSheet.create({
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
});
