/**
 * CaptureWell — the capture control as TWO HOLES IN THE GLASS THAT BECOME ONE.
 *
 *   IDLE                                                  ( ◉ )
 *
 *                            0:12                    ← elapsed, bare, centred
 *   RECORDING  ( SAVE ■ )      ▁▂▄▆█▆▄▂▁▃▅▇█▇▅▃▁      ( ❚❚ )
 *
 *   REACHING   ( SAVE ■ )    ▁▃▅▇█    ( RESTART ↺ │ ▶ )
 *   TOUCHING   ( SAVE ■ )══( DELETE 🗑 │ RESTART ↺ │ ▶ )
 *   PAUSED     ( ■ SAVE │ 🗑 DELETE │ ↺ RESTART │ ▶ )
 *
 * THE IDEA. The transport sits in a recess cut into the glass on the RIGHT; SAVE sits in
 * a second one at the far left. Tapping the transport does not open a panel — the right
 * recess GROWS leftward until the two touch, neck, and become a single trough. The
 * options were never revealed and never arrived: the hole simply widened until it was
 * underneath them. Tapping play runs it backwards and the take continues.
 *
 * WHY THE MIC IS ON THE RIGHT. It takes the same seat the nav's search satellite has, so
 * crossing from a tab into a movie never moves the one round thing at the bottom of the
 * screen. Trailer and Slate ride the island to its left (see FloatingVerbs), which is where
 * the nav keeps its pill of destinations.
 *
 * EVERY X IS MEASURED FROM THE PILL'S RIGHT EDGE. That is the whole trick to the mirror:
 * the arithmetic below is identical to the left-handed version it replaced, and the only
 * thing that changed is that children anchor with `right:` instead of `left:`. If you add
 * anything here, anchor it from the right or it will drift as the pill grows.
 *
 * WHY IT NEEDS NOTHING ELSE INSIDE. A recess is already a container, so the transport's
 * siblings need no home of their own — no taller card, no cells subdividing. And because
 * SAVE keeps the far left for the whole session, a take can be kept at any moment without
 * pausing first, while still being stated exactly once. The reach is the trade: SAVE is
 * the longest stretch for a right thumb, and it is what buys the merge its distance.
 *
 * THE MERGE IS THE WHOLE THING. Two rounded caps closing on each other would just
 * overlap; what makes it read as material is the NECK — a thin bridge that appears
 * when they are within NECK_START of each other and then races open. Its height rides
 * a power curve off the same progress, so the last few points snap. There is no second
 * timeline: one spring drives the width, and the neck's acceleration falls out of the
 * geometry.
 *
 * NOTHING SEATED EVER MOVES. The transport is at PAD for the whole session; SAVE is at
 * the far left for the whole session; RESTART and DELETE are already at their final x
 * before you can see them. They fade up as the trough's edge passes under them, which
 * is why the motion reads as one object opening rather than four objects arriving.
 *
 * RENDERING RULES (device-learned — correctness, not taste):
 *   · The recess is per-side BORDER COLOURS, not an inset shadow. RN 0.81 on the New
 *     Architecture does support inset boxShadow, but this stack has surprised us four
 *     times today and borders cannot be unsupported.
 *   · TouchableOpacity with PLAIN style props. A `style` FUNCTION on Pressable
 *     silently drops flexDirection and flex here.
 *   · No `overflow: hidden` anywhere: this stack does not reliably clip a TRANSFORMED
 *     child, so the waveform is eaten by per-bar OPACITY keyed to the trough's edge
 *     rather than by a moving clip.
 *   · No fractional `gap`. Wave bars are absolutely positioned, never flexed, so the
 *     trough's animated width cannot reflow them.
 *   · Worklets cannot call ordinary JS helpers — every colour used inside an animated
 *     style is a module constant. See scripts/check-worklets.mjs.
 *   · The trough animates WIDTH, deliberately. Scaling it would flatten the 25pt cap
 *     into an ellipse at rest, and the resting circle is the whole design. It is one
 *     absolutely-positioned view, so no sibling re-solves — the same trade the nav
 *     pill makes for its slots.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import MaskedView from '@react-native-masked-view/masked-view';
import * as Haptics from 'expo-haptics';

import { formatCaptureTime, type CaptureStatus } from '@/hooks/useCaptureSession';
import { PREF_MIC_USED, getBoolPref, onPrefsReady, setBoolPref } from '@/services/prefs';
import { NAV_SPRING } from '@/contexts/NavMorphContext';
import {
  NAV_BAR_H,
  NAV_BLUR_INTENSITY,
  NAV_GLASS_RIM,
  NAV_GLASS_TINT,
  NAV_SIDE_INSET,
} from '@/constants/navMetrics';
import { TICKET_ACCENT, INK_RED } from './ticketTheme';
import { SAVE_GREEN, useWaveHistory } from './CapturePill';
import ShimmerSweep from './ShimmerSweep';

// Glass, height and margins come from the nav's metrics — this pill and the tab pill
// are never on screen together, so they must occupy the same footprint or crossing
// between them reads as crossing between two apps.
const GLASS_TINT = NAV_GLASS_TINT;
const GLASS_RIM = NAV_GLASS_RIM;
// The recess: darker than the glass it is cut into, with a deeper lip along the top where
// the shadow would pool. Depth by value only — every side is a shade of black.
//
// There used to be a light "catch" along the bottom (white at 0.07), the highlight a real
// bevel would pick up. On a shape whose radius is half its height the bottom border is an
// ARC, and a 1px light arc under a dark glyph does not read as a bevel — it reads as a
// stray line at the foot of the well. The dark top lip is what sells the hole; the catch
// was only ever the second, weaker half of the cue.
const WELL_FILL = 'rgba(0, 0, 0, 0.42)';
const WELL_LIP = 'rgba(0, 0, 0, 0.55)';
const WELL_SIDE = 'rgba(0, 0, 0, 0.28)';
const SEAM = 'rgba(255, 255, 255, 0.10)';
const INK_QUIET = 'rgba(255, 255, 255, 0.62)';
const WAVE_INK = TICKET_ACCENT;
const CLOCK_INK = 'rgba(255, 255, 255, 0.78)';
const RESTART_FLOOD = 'rgba(255, 255, 255, 0.16)';
const DELETE_FLOOD = 'rgba(232, 114, 104, 0.62)';

// ── Geometry. Every number derived; nothing measured. ────────────────────────
// Width and height are the tab pill's, so the two land on the same footprint.
const PILL_W = Dimensions.get('window').width - NAV_SIDE_INSET * 2;
const PILL_H = NAV_BAR_H; // 62
const PILL_R = PILL_H / 2;

// EVERYTHING INSIDE IS MEASURED AGAINST THE CONTENT BOX, NOT THE PILL.
//
// RN is border-box, so a 62pt pill with a 1pt rim has a 60pt content box — and absolutely
// positioned children are placed inside that, not inside the border. Sizing the recess off
// the full 62 while offsetting it by PAD from the content box put it 1pt low and 1pt to the
// left of true centre: at rest, the disc's hole was visibly off inside its own ring. The
// two subtractions have to come from the same box.
const PILL_BORDER = 1;
const PILL_INNER_W = PILL_W - PILL_BORDER * 2;
const PILL_INNER_H = PILL_H - PILL_BORDER * 2; // 60

const PAD = 7; // air between the rim and the recess — 7 + 46 + 7 = 60, dead centre
const WELL_H = PILL_INNER_H - PAD * 2; // 46
const WELL_R = WELL_H / 2;
const WELL_MIN = WELL_H; // closed, the transport recess is a circle

// The transport mark — mic, pause, play, ✕. Half the recess it sits in, which is a touch
// larger than the nav's icon-to-slot ratio ON PURPOSE: this glyph sits in a dark hole that
// absorbs light, where the nav's sit on lit glass, so the same ratio read smaller here.
const TRANSPORT_ICON = Math.round(WELL_MIN * 0.5); // 23

// Width of the light band that walks the resting disc. A third of the glass: wider and it
// covers the whole face at once and stops reading as a moving highlight.
const SHEEN_BAND = Math.round(PILL_INNER_H / 3);

const SAVE_W = 68;
// How far in from the pill's right edge the save recess starts, once the pill is full.
const SAVE_X = PILL_INNER_W - PAD - SAVE_W;
const TROUGH_W = PILL_INNER_W - PAD * 2; // fully merged, the trough spans the pill

// At rest the pill IS the well plus its rim: a circle, nothing else. There is no label —
// a recessed mic in a glass disc is the whole invitation, and the words that used to sit
// beside it are now their own island (FloatingVerbs).
const PILL_W_IDLE = PILL_H;

// Seats, in TROUGH-LOCAL coordinates measured from the RIGHT (add PAD for pill
// coordinates). Fixed for the whole session — a seat is never laid out, only faded up.
//
// DERIVED, not tuned. The transport owns the right end and SAVE the left end; RESTART and
// DELETE split whatever is left, evenly, with one gap between every pair. Hand-placed
// numbers were fine at exactly one pill size and left a lopsided hole before SAVE the
// moment the height or the margins moved.
const SEAT_GAP = 7;
const SEAT_SAVE = { x: SAVE_X - PAD, w: SAVE_W };
const SEAT_MID_W = Math.floor((SEAT_SAVE.x - WELL_MIN - SEAT_GAP * 3) / 2);
// No SEAT_TRANSPORT constant: the transport keeps its own recess rather than moving into
// a seat, so it is laid out inline at { right: PAD, width: WELL_MIN }. Its x is 0 by
// definition — that is what the other three measure from.
const SEAT_RESTART = { x: WELL_MIN + SEAT_GAP, w: SEAT_MID_W };
const SEAT_DELETE = { x: SEAT_RESTART.x + SEAT_MID_W + SEAT_GAP, w: SEAT_MID_W };
// A hairline down the middle of each gap.
const SEAM_X = [
  Math.round(WELL_MIN + SEAT_GAP / 2),
  Math.round(SEAT_RESTART.x + SEAT_MID_W + SEAT_GAP / 2),
  Math.round(SEAT_DELETE.x + SEAT_MID_W + SEAT_GAP / 2),
];

// The waveform lives between the two recesses while they are apart. Bar 0 sits nearest the
// transport, so the trough eats the record from its own end outwards.
const WAVE_X = PAD + WELL_MIN + 16;
const WAVE_W = SAVE_X - 14 - WAVE_X;
const WAVE_N = 26;
const WBAR_W = 3;
const WBAR_PITCH = (WAVE_W - WBAR_W) / (WAVE_N - 1);
const WBAR_MIN = 3;
const WBAR_SWING = 26;
// How far the record reaches from the right edge, and therefore how wide the pill has to
// have grown before the outermost bar has glass under it. DERIVED: hard-coding this gate
// is what let a bar hang past the growing cap the last time the idle size changed.
const WAVE_FAR_EDGE = WAVE_X + WBAR_PITCH * (WAVE_N - 1) + WBAR_W + 4;
const WAVE_GATE_IN = Math.min(
  0.95,
  (WAVE_FAR_EDGE - PILL_W_IDLE) / (PILL_W - PILL_W_IDLE)
);

// How close the two recesses must be before a bridge appears between them, and how
// hard the bridge races open once it does. The exponent IS the snap.
const NECK_START = 44;
const NECK_SNAP = 2.4;
const NECK_OVERLAP = 5; // the bridge tucks under both caps so no seam can show

/** Hold duration for a destructive verb — deliberate, but never a chore. */
const HOLD_MS = 620;
const HAPTIC_SLOW_MS = 165;
const HAPTIC_FAST_MS = 60;

type HoldKind = 'restart' | 'delete' | null;

/**
 * Is a take in flight — i.e. is the pill open rather than a resting disc?
 *
 * Recording and paused obviously count. A get-ready countdown counts only when it is a
 * RESUME (the clock has already run), because folding back to the single well is the
 * confirmation that a fresh start threw the old audio away.
 *
 * Exported because FloatingVerbs has to collapse on exactly this predicate. Computed
 * separately in the two places, they would eventually disagree and leave a hole in the run
 * where one island had closed and the other had not yet grown.
 */
export const isCaptureLive = (
  status: CaptureStatus,
  remainingMs: number,
  durationMs: number
): boolean =>
  status === 'recording' ||
  status === 'paused' ||
  (status === 'arming' && remainingMs < durationMs);

export interface CaptureWellProps {
  status: CaptureStatus;
  remainingMs: number;
  durationMs: number;
  level: SharedValue<number>;
  onStart: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onStartOver: () => void;
  onDone: () => void;
  onDiscard: () => void;
}

/**
 * One bar of the printed record. It owns its own disappearance: as the trough's edge
 * arrives, the bar fades over a 16pt front, so the wave is EATEN by the advancing
 * recess rather than covered by it or clipped — this stack cannot be trusted to clip
 * a transformed child.
 */
function WaveBar({
  wave,
  index,
  x,
  edge,
  live,
}: {
  wave: SharedValue<number[]>;
  index: number;
  x: number;
  edge: SharedValue<number>;
  live: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    // Squared — a gentler curve let ordinary speech saturate every bar at once, which
    // is what made this read as a picket fence rather than as audio.
    const v = wave.value[index] ?? 0;
    const h = WBAR_MIN + v * v * WBAR_SWING;
    const eaten = interpolate(edge.value, [x - 10, x + 6], [1, 0], Extrapolation.CLAMP);
    return {
      height: h,
      // Anchored to the pill's midline, so a bar grows both ways off the centre.
      transform: [{ translateY: -h / 2 }],
      opacity: eaten * live.value,
    };
  });
  return <Animated.View style={[styles.waveBar, { right: x }, style]} />;
}

const CaptureWell = ({
  status,
  remainingMs,
  durationMs,
  level,
  onStart,
  onCancel,
  onPause,
  onResume,
  onStartOver,
  onDone,
  onDiscard,
}: CaptureWellProps) => {
  const recording = status === 'recording';
  const paused = status === 'paused';
  const arming = status === 'arming';
  const live = isCaptureLive(status, remainingMs, durationMs);

  const [holdKind, setHoldKind] = useState<HoldKind>(null);
  const wave = useWaveHistory(recording, level, WAVE_N, false);

  // ── Shared values, ALL declared before any worklet that reads them ──
  const liveV = useSharedValue(live ? 1 : 0); // idle ⇄ a take exists
  const open = useSharedValue(paused ? 1 : 0); // the merge
  const charge = useSharedValue(0);

  useEffect(() => {
    liveV.value = withSpring(live ? 1 : 0, NAV_SPRING);
    open.value = withSpring(paused ? 1 : 0, NAV_SPRING);
  }, [live, paused, liveV, open]);

  // The trough's LEADING edge, as a distance from the pill's right edge. Everything on
  // this control is a function of this one number, and because the whole component is laid
  // out from the right, the arithmetic is the same as it was when the trough grew the
  // other way — only the anchors flipped.
  const edge = useDerivedValue(
    () => PAD + interpolate(open.value, [0, 1], [WELL_MIN, TROUGH_W]),
    [open]
  );

  // A disc at rest; the full run once a take is live. CLAMPed because NAV_SPRING is
  // slightly underdamped, and an overshoot past PILL_W would push the pill out past the
  // run's edge — the island beside it gives back exactly PILL_W and not a point more.
  const pillStyle = useAnimatedStyle(() => ({
    width: interpolate(liveV.value, [0, 1], [PILL_W_IDLE, PILL_W], Extrapolation.CLAMP),
  }));

  const troughStyle = useAnimatedStyle(() => ({
    width: interpolate(open.value, [0, 1], [WELL_MIN, TROUGH_W]),
  }));

  // THE NECK. It hangs off the trough's leading edge (right: '100%'), so it tracks the
  // growth for free and only its own size animates. The wrapper spans the gap; the bar
  // inside it is what actually thickens, and the wrapper's centring keeps the waist on
  // the midline as it does. Height rides a power curve on how closed the gap is: a thin
  // bridge the moment they are near, then a race to full. The exponent IS the snap.
  // Once the trough has reached the save recess the bridge has no job left — the trough
  // itself now spans everything — so it must collapse to nothing. Left visible it hangs
  // off the trough's leading cap as a bar sticking out past the pill.
  const neckWrapStyle = useAnimatedStyle(() => {
    const gap = SAVE_X - edge.value;
    return { width: gap >= 0 ? gap + NECK_OVERLAP * 2 : 0 };
  });
  const neckBarStyle = useAnimatedStyle(() => {
    const t = interpolate(SAVE_X - edge.value, [NECK_START, 0], [0, 1], Extrapolation.CLAMP);
    const h = WELL_H * Math.pow(t, NECK_SNAP);
    // Hidden until it is thick enough to read as a bridge. Without this the bar's own
    // minimum height draws a hairline the full width of the gap for the whole session.
    return { height: h, opacity: interpolate(h, [0, 4], [0, 1], Extrapolation.CLAMP) };
  });

  // The save recess fades out exactly as the trough arrives over it. Two recesses
  // stacked would double the fill and the borders, which is what made SAVE look like it
  // had a dark plate laid over it.
  const saveWellStyle = useAnimatedStyle(() => {
    const covered = interpolate(edge.value, [SAVE_X - 6, SAVE_X + 18], [0, 1], Extrapolation.CLAMP);
    return { opacity: liveV.value * (1 - covered) };
  });
  const saveSeatStyle = useAnimatedStyle(() => ({ opacity: liveV.value }));
  const clockStyle = useAnimatedStyle(() => ({ opacity: liveV.value }));

  // ── The first-run sheen ───────────────────────────────────────────────────────────
  // At rest this control is one small disc at the corner of a busy screen, and nothing on
  // it says "start here". So until the user has actually used it, a prismatic band walks
  // slowly across the glass — rose, white, ice — the way light moves over a curved surface.
  // Not a pulse, not a glow: something present rather than something demanding.
  //
  // It retires on the first tap and is remembered across launches. A hint that keeps
  // hinting after you have learned it is just noise.
  const [hintOn, setHintOn] = useState(false);

  // Starts OFF and is switched on only once the prefs cache is in memory. The other way
  // round, a returning user would see the sheen run until the cache landed — and if the
  // read failed, forever.
  useEffect(() => onPrefsReady(() => setHintOn(!getBoolPref(PREF_MIC_USED))), []);

  // Only while the disc is a disc. The moment a take is armed the control has a job and
  // the invitation is over.
  const hinting = hintOn && status === 'idle';

  const retireHint = useCallback(() => {
    if (!hintOn) return;
    setHintOn(false);
    setBoolPref(PREF_MIC_USED, true);
  }, [hintOn]);
  // The record only appears once the pill is long enough to hold it, or the far bars
  // hang outside the glass while it is still growing. See WAVE_GATE_IN.
  const waveGate = useDerivedValue(
    () => interpolate(liveV.value, [WAVE_GATE_IN, 1], [0, 1], Extrapolation.CLAMP),
    [liveV]
  );

  // A seat lights up as the trough's edge passes under it — never before, so nothing is
  // ever floating on bare glass. Written out rather than generated by a helper: a hook
  // inside a function is a rule-of-hooks trap waiting for the first conditional render.
  const restartSeat = useAnimatedStyle(() => ({
    opacity: interpolate(
      edge.value,
      [PAD + SEAT_RESTART.x - 4, PAD + SEAT_RESTART.x + 26],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));
  const deleteSeat = useAnimatedStyle(() => ({
    opacity: interpolate(
      edge.value,
      [PAD + SEAT_DELETE.x - 4, PAD + SEAT_DELETE.x + 26],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));
  const seam0 = useAnimatedStyle(() => ({
    opacity: interpolate(edge.value, [PAD + SEAM_X[0] - 4, PAD + SEAM_X[0] + 26], [0, 1], Extrapolation.CLAMP),
  }));
  const seam1 = useAnimatedStyle(() => ({
    opacity: interpolate(edge.value, [PAD + SEAM_X[1] - 4, PAD + SEAM_X[1] + 26], [0, 1], Extrapolation.CLAMP),
  }));
  const seam2 = useAnimatedStyle(() => ({
    opacity: interpolate(edge.value, [PAD + SEAM_X[2] - 4, PAD + SEAM_X[2] + 26], [0, 1], Extrapolation.CLAMP),
  }));

  const floodStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (-SEAT_RESTART.w / 2) * (1 - charge.value) },
      { scaleX: charge.value },
    ],
  }));

  // ── Hold to confirm ──
  const hapticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hapticFrom = useRef(0);

  const stopHaptics = useCallback(() => {
    if (hapticTimer.current) {
      clearTimeout(hapticTimer.current);
      hapticTimer.current = null;
    }
  }, []);

  const pulse = useCallback(() => {
    const t = Math.min(1, (Date.now() - hapticFrom.current) / HOLD_MS);
    if (t >= 1) return; // the commit's own Success notification lands instead
    Haptics.impactAsync(
      t < 0.35
        ? Haptics.ImpactFeedbackStyle.Light
        : t < 0.72
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Heavy
    );
    hapticTimer.current = setTimeout(pulse, HAPTIC_SLOW_MS - t * (HAPTIC_SLOW_MS - HAPTIC_FAST_MS));
  }, []);

  const fire = useCallback(
    (kind: 'restart' | 'delete') => {
      stopHaptics();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHoldKind(null);
      charge.value = 0;
      if (kind === 'delete') onDiscard();
      else onStartOver();
    },
    [charge, stopHaptics, onDiscard, onStartOver]
  );

  const holdStart = useCallback(
    (kind: 'restart' | 'delete') => {
      setHoldKind(kind);
      hapticFrom.current = Date.now();
      stopHaptics();
      pulse(); // the first tap lands on press, then the ramp takes over
      charge.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear }, (done) => {
        'worklet';
        if (done) runOnJS(fire)(kind);
      });
    },
    [charge, fire, pulse, stopHaptics]
  );

  const holdEnd = useCallback(() => {
    stopHaptics();
    cancelAnimation(charge);
    charge.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }, (done) => {
      'worklet';
      if (done) runOnJS(setHoldKind)(null);
    });
  }, [charge, stopHaptics]);

  useEffect(() => stopHaptics, [stopHaptics]);

  // Flatten the record once the pill folds down. `useWaveHistory` is deliberately told
  // NOT to reset on inactive — that is what freezes the last frame through a pause —
  // so without this the next take would open on the tail of the previous one.
  useEffect(() => {
    if (!live) wave.value = new Array(WAVE_N).fill(0);
  }, [live, wave]);

  const handleSave = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDone();
  }, [onDone]);

  // The merge and its reverse are the same gesture on the same button, so they get the
  // same weight of impact — the snap should feel like one mechanism, not two.
  const handleTransport = useCallback(() => {
    retireHint(); // any tap on the transport means it has been found
    if (status === 'idle') {
      onStart(); // the screen fires its own impact on this path
      return;
    }
    if (status === 'arming') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onCancel();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    if (recording) onPause();
    else onResume();
  }, [status, recording, onStart, onCancel, onPause, onResume, retireHint]);

  const elapsed = formatCaptureTime(Math.max(0, durationMs - remainingMs));
  const transportIcon: keyof typeof Ionicons.glyphMap = arming
    ? 'close'
    : recording
      ? 'pause'
      : paused
        ? 'play'
        : 'mic';
  const transportA11y = arming
    ? 'Cancel countdown'
    : recording
      ? 'Pause recording'
      : paused
        ? 'Resume recording'
        : 'Record a take';

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* The elapsed time. Bare numerals above the pill, centred on it — a readout, so
          it wears no bubble, no plate and no rule. */}
      <Animated.Text
        style={[styles.clock, clockStyle]}
        numberOfLines={1}
        allowFontScaling={false}
        pointerEvents="none"
      >
        {elapsed}
      </Animated.Text>

      <Animated.View style={[styles.pill, pillStyle]}>
        {/* The blur carries the pill's own radius and clips itself. It is NOT clipped by
            the parent: this stack will not reliably clip a transformed child, and the
            wave bars and the hold flood are both transformed. Left unrounded, the blur
            renders as a full rectangle behind the pill — which is the box. */}
        <BlurView
          intensity={NAV_BLUR_INTENSITY}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={[StyleSheet.absoluteFill, styles.blur]}
        />

        {/* THE FIRST-RUN SHEEN, rendered BEFORE the recesses on purpose: the light walks
            across the glass and passes BEHIND the hole, which stays as dark as it ever was.
            Lighting the recess itself is what made the previous attempt at visibility read
            wrong — the sunken look is the design, not an obstacle to it.

            Masked rather than clipped. `overflow: hidden` will not reliably contain a
            TRANSFORMED child on this stack (the band translates), and that is the same
            trap that keeps the pill from clipping its own waveform. MaskedView clips by
            alpha instead, which has no such problem and is already proven here on the
            ticket silhouette. The mask is the glass INSIDE the rim, so the band can never
            ride over the pill's own edge. */}
        {hinting && (
          <MaskedView
            style={styles.sheen}
            pointerEvents="none"
            maskElement={<View style={styles.sheenMask} />}
          >
            <ShimmerSweep band={SHEEN_BAND} travel={PILL_INNER_H + SHEEN_BAND} period={4200} />
          </MaskedView>
        )}

        {/* ── The two recesses. Cut first, so everything else stands in them. ── */}
        <Animated.View style={[styles.saveWell, saveWellStyle]} pointerEvents="none" />
        <Animated.View style={[styles.trough, troughStyle]} pointerEvents="none">
          <Animated.View style={[styles.neckWrap, neckWrapStyle]}>
            <Animated.View style={[styles.neckBar, neckBarStyle]} />
          </Animated.View>
        </Animated.View>

        {/* THE PRINTED RECORD, between the two holes while they are apart. */}
        {Array.from({ length: WAVE_N }, (_, i) => (
          <WaveBar
            key={i}
            wave={wave}
            index={i}
            x={WAVE_X + i * WBAR_PITCH}
            edge={edge}
            live={waveGate}
          />
        ))}

        {/* ── Seams. Hairlines only where two seats meet. ── */}
        <Animated.View style={[styles.seam, { right: PAD + SEAM_X[0] }, seam0]} pointerEvents="none" />
        <Animated.View style={[styles.seam, { right: PAD + SEAM_X[1] }, seam1]} pointerEvents="none" />
        <Animated.View style={[styles.seam, { right: PAD + SEAM_X[2] }, seam2]} pointerEvents="none" />

        {/* ── Seats. Fixed positions for the whole session; only their opacity moves. ── */}
        {/* The glyph is just a face — the target is separate, so the whole disc can be the
            button at rest without the icon having to live inside it. */}
        <View style={[styles.hit, { right: PAD, width: WELL_MIN }]} pointerEvents="none">
          <View style={styles.face}>
            <Ionicons name={transportIcon} size={TRANSPORT_ICON} color={TICKET_ACCENT} />
          </View>
        </View>

        {/* At rest the pill IS the button — the whole disc, glass and rim included, not
            just the recess inside it. Same during the fresh countdown, where all of it
            cancels. Once a take is live the target shrinks back to the well, because the
            rest of the pill belongs to the record and to SAVE. */}
        <TouchableOpacity
          style={live ? [styles.hit, { right: PAD, width: WELL_MIN }] : styles.hitAll}
          activeOpacity={1}
          onPress={handleTransport}
          accessibilityRole="button"
          accessibilityLabel={transportA11y}
        />

        <Animated.View
          style={[styles.seat, { right: PAD + SEAT_RESTART.x, width: SEAT_RESTART.w }, restartSeat]}
          pointerEvents={paused ? 'auto' : 'none'}
        >
          {holdKind === 'restart' && (
            <Animated.View
              style={[styles.flood, { width: SEAT_RESTART.w, backgroundColor: RESTART_FLOOD }, floodStyle]}
              pointerEvents="none"
            />
          )}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPressIn={() => holdStart('restart')}
            onPressOut={holdEnd}
            accessibilityRole="button"
            accessibilityLabel="Hold to restart this take"
          />
          <View style={styles.stack} pointerEvents="none">
            <Ionicons name="refresh" size={15} color={INK_QUIET} />
            <Text style={[styles.seatLabel, { color: INK_QUIET }]} numberOfLines={1}>
              RESTART
            </Text>
          </View>
        </Animated.View>

        <Animated.View
          style={[styles.seat, { right: PAD + SEAT_DELETE.x, width: SEAT_DELETE.w }, deleteSeat]}
          pointerEvents={paused ? 'auto' : 'none'}
        >
          {holdKind === 'delete' && (
            <Animated.View
              style={[styles.flood, { width: SEAT_DELETE.w, backgroundColor: DELETE_FLOOD }, floodStyle]}
              pointerEvents="none"
            />
          )}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPressIn={() => holdStart('delete')}
            onPressOut={holdEnd}
            accessibilityRole="button"
            accessibilityLabel="Hold to delete this take"
          />
          <View style={styles.stack} pointerEvents="none">
            <Ionicons name="trash" size={15} color={INK_RED} />
            <Text style={[styles.seatLabel, { color: INK_RED }]} numberOfLines={1}>
              DELETE
            </Text>
          </View>
        </Animated.View>

        {/* SAVE. In its own recess from the moment a take exists, so it can be kept
            without stopping — and it is the thing the growing trough runs into. */}
        <Animated.View
          style={[styles.saveSeat, saveSeatStyle]}
          pointerEvents={live ? 'auto' : 'none'}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={0.6}
            onPress={handleSave}
            accessibilityRole="button"
            accessibilityLabel="Stop and save this take"
          />
          <View style={styles.stack} pointerEvents="none">
            <Ionicons name="stop" size={15} color={SAVE_GREEN} />
            <Text style={[styles.seatLabel, { color: SAVE_GREEN }]} numberOfLines={1}>
              SAVE
            </Text>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

// The recess, shared by both holes and the bridge between them: darker than the glass it is
// cut into, with a deeper lip along the top where the shadow would pool.
// Two colours, not four: the top lip, and one value for the other three sides. Fewer
// distinct border colours also means iOS composites fewer segments around the cap, which is
// where per-side strokes on a full-radius shape start showing their joins.
const recess = {
  backgroundColor: WELL_FILL,
  borderTopWidth: 1,
  borderTopColor: WELL_LIP,
  borderBottomWidth: 1,
  borderBottomColor: WELL_SIDE,
  borderLeftWidth: 1,
  borderLeftColor: WELL_SIDE,
  borderRightWidth: 1,
  borderRightColor: WELL_SIDE,
} as const;

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },

  // A readout, not a control — so no plate, no rule, no bubble. The shadow is the only
  // concession to sitting over a bright film still.
  clock: {
    marginBottom: 10,
    color: CLOCK_INK,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'], // must not twitch as the digits change
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  pill: {
    height: PILL_H,
    borderRadius: PILL_R,
    backgroundColor: GLASS_TINT,
    borderWidth: PILL_BORDER,
    borderColor: GLASS_RIM,
    // The tab pill carries NO shadow, and a heavy one here was the last thing making
    // this read as a different component — it floated visibly further off the page.
    // Kept, but only just: this pill sits over a full-bleed still, where the nav sits
    // over a dark list, so it needs a little separation the nav does not.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 6,
  },
  blur: {
    borderRadius: PILL_R,
    overflow: 'hidden',
  },

  // The resting disc's glass, INSIDE the rim — pinned to the right cap, which is where the
  // pill lives when it is a disc. Only mounted while hinting, so it never has to track the
  // pill's animated width.
  sheen: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: PILL_INNER_H,
    height: PILL_INNER_H,
  },
  sheenMask: {
    width: PILL_INNER_H,
    height: PILL_INNER_H,
    borderRadius: PILL_INNER_H / 2,
    backgroundColor: '#000', // opaque = the region the sheen is allowed into
  },

  // ── The holes ──
  // Anchored to the pill's RIGHT edge, so its width grows LEFTWARD for free — no x to
  // animate alongside it, and the transport never moves under the thumb.
  trough: {
    position: 'absolute',
    right: PAD,
    top: PAD,
    height: WELL_H,
    borderRadius: WELL_R,
    ...recess,
  },
  // Anchored to the pill's LEFT edge, not to an absolute x — so while the pill is
  // extending, the save recess rides its left cap instead of hanging outside the glass.
  saveWell: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    width: SAVE_W,
    height: WELL_H,
    borderRadius: WELL_R,
    ...recess,
  },
  saveSeat: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    width: SAVE_W,
    height: WELL_H,
    zIndex: 2,
  },
  // Hangs off the trough's leading (left) edge, so it follows the growth without ever
  // being animated into position. The wrapper spans the gap and is full trough height;
  // only the bar inside it thickens, which keeps the waist on the midline throughout.
  neckWrap: {
    position: 'absolute',
    right: '100%',
    marginRight: -NECK_OVERLAP,
    top: -1, // sit over the trough's own top border so the recess reads continuous
    height: WELL_H,
    justifyContent: 'center',
  },
  // Fill only, no borders. A bordered bar has a minimum height of its own two borders,
  // which drew a hairline across the whole gap whenever the neck was meant to be absent.
  // At bridge scale the fill alone reads as the recess continuing.
  neckBar: {
    width: '100%',
    borderRadius: 5,
    backgroundColor: WELL_FILL,
  },

  // ── The record ──
  // `top: 50%` plus a translateY of half the animated height: the bar grows both ways
  // off the pill's midline without its container ever re-laying out.
  waveBar: {
    position: 'absolute',
    top: '50%',
    width: WBAR_W,
    borderRadius: WBAR_W / 2,
    backgroundColor: WAVE_INK,
  },

  // ── Seats ──
  hit: {
    position: 'absolute',
    top: PAD,
    height: WELL_H,
    zIndex: 2,
  },
  // The resting pill is one target, edge to edge and cap to cap.
  hitAll: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  seat: {
    position: 'absolute',
    top: PAD,
    height: WELL_H,
    zIndex: 2,
  },
  face: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatLabel: {
    marginTop: 3,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1,
    includeFontPadding: false,
  },
  seam: {
    position: 'absolute',
    top: PILL_INNER_H / 2 - 11, // the content box's midline, not the pill's
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: SEAM,
    zIndex: 2,
  },
  // scaleX off the left edge, so the flood fills the seat rather than growing from its
  // middle. A transform, so there is no clip anywhere for it to escape. Left-to-right
  // regardless of the pill's handedness — a progress fill reads the way text does.
  flood: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
});

export default CaptureWell;
