import React, { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/**
 * ▸ THE LIVING FIELD — a suspended luminous canopy the cards are born from.
 *
 * v4 frame review. The family is finally right ("soft, dark-preserving, cool-toned,
 * increasingly premium — keep that family") and two structural problems remain.
 *
 * ▸ SIZE IS WHERE THE LIGHT IS PERCEPTIBLE, NOT WHERE THE GRADIENT ENDS. The canopy
 * pass "widened" the outer fields to 0.78–0.85W — and F05 still shows a compact
 * centered pool, because those widths existed only at 2–6% luminance, which is black
 * on a dark room's OLED. A field's real footprint is where falloff × peak crosses
 * roughly 4%. Everything here is now sized by that rule, against the brief's anchors:
 * the outer indigo/royal atmosphere is PERCEPTIBLE from slightly left of the clock to
 * slightly right of the battery (~85% of width), while the corners compute to ~3% —
 * genuinely dark margins before the physical edges. Vertically the atmosphere reads
 * down to ~120pt at peak (≈ two Dynamic-Island heights below the island), the bright
 * heart staying pinned near the edge.
 *
 * ▸ THREE COMPONENTS, NO SHARED CLOCK — the pulse diagnosis. Every earlier cut
 * multiplied one `energy` envelope into every layer, so the field could only get
 * brighter and dimmer as one object: an attractive glow with an opacity animation
 * (F03/F07/F10 — same shape, three brightnesses). Now the structure is the brief's:
 *   1. ATMOSPHERE (indigo + royal) — very wide, low alpha, slowly changing WIDTH
 *      (6.1s clock) and DEPTH (9.7s clock) independently;
 *   2. TWO CYAN CONCENTRATIONS — unequal, off-centre in opposite directions, each
 *      with its own intensity clock (5.1s / 8.3s), so one side gathers while the
 *      other relaxes, sometimes both, sometimes neither — redistribution, never a
 *      seesaw and never a translation (drifts stay ≤ 14pt);
 *   3. THE SOURCE — one compact icy heart (0.17W: COMPACT, the 0.24W core is what
 *      read as a bulb) that wanders a few points and varies ±8% on its own clock.
 * The clocks are incommensurate, so the combined field never repeats a phase — alive,
 * not dramatic. The banned list stands: no aurora, no waveform, no visible blobs, no
 * travelling band, and NO UNIFORM BREATHING LOOP — the energy envelope holds flat
 * after the release and all life comes from redistribution.
 *
 * ▸ THE ARC (kept from the approved family): fast ignition that wins the race with
 * the first card, a short controlled peak as it emerges, small local swells in the
 * cyan pair per later card (never a replay), then the staged recession — the white
 * source collapses first, the cyans follow, and the atmosphere is drawn upward last,
 * energy withdrawing beyond the edge rather than a layer fading (F13's note).
 *
 * ▸ INHERITED ABSOLUTES: every field is a radial ellipse whose gradient dies at its
 * own rim (no boundary anywhere), every centre is above the display edge (the source
 * is offscreen as geometry), `mixBlendMode: "screen"` keeps blacks black at any peak,
 * and nothing is clipped at meaningful alpha.
 */

const OV = 100;
/** How far the canvas rises above the display edge — where the field centres live. */
const LIFT = 130;
const CANVAS_H = 380;

/** Four incommensurate idle clocks. No two layers modulate the same property from
 *  the same clock, which is what "internal movement without traceable shapes" costs. */
const DRIFT_A = 6100;
const DRIFT_B = 8300;
const DRIFT_C = 9700;
const DRIFT_D = 5100;

/**
 * One shared falloff: plateaus near peak through r 0.4 (the band the display edge
 * samples), then dies smoothly to zero INSIDE the ellipse's rim. Monotonic, so no
 * step reads as a ring; ends at zero, so no shape has an edge.
 */
const FALL = [
  [0, 1],
  [0.4, 0.88],
  [0.62, 0.5],
  [0.82, 0.2],
  [1, 0],
] as const;

/** Inside → out: icy heart, cyan pair, royal spread, indigo atmosphere. Saturated and
 *  driven — under screen blending peaks are luminance, and the falloff to zero is what
 *  protects the blacks, not timidity. */
const INDIGO = { rgb: "rgb(40,48,165)", peak: 0.13 };
const ROYAL = { rgb: "rgb(64,120,255)", peak: 0.26 };
const CYAN_L = { rgb: "rgb(96,222,255)", peak: 0.42 };
const CYAN_R = { rgb: "rgb(96,222,255)", peak: 0.36 };
const CORE = { rgb: "rgb(236,250,255)", peak: 0.9 };

const stops = ({ rgb, peak }: { rgb: string; peak: number }) =>
  FALL.map(([o, k]) => <Stop key={o} offset={o} stopColor={rgb} stopOpacity={peak * k} />);

export default function ArrivalAurora({
  on,
  beats,
}: {
  on: SharedValue<number>;
  /** When each card lands, in ms from now. The arc is BUILT from these: the gather
   *  fills the lead before the first, local swells ride the rest, recession follows
   *  the last. */
  beats?: number[];
}) {
  const { width: W } = useWindowDimensions();
  const CANVAS_W = W + 2 * OV;

  /** 0 → 1 across the anticipation: entry and concentration of the gathering field. */
  const gather = useSharedValue(0);
  /** The event envelope: build → peak → settle → HOLD. No breath here — a uniform
   *  breathing loop is on the banned list; life belongs to the clocks below. */
  const energy = useSharedValue(0);
  /** The release — the body expanding downward once, as the first card comes out. */
  const swell = useSharedValue(0);
  /** Small local swells for later cards, applied to the cyan pair and heart only —
   *  the atmosphere never replays anything. */
  const ripple = useSharedValue(0);
  /** The staged ending: heart first, cyans next, atmosphere drawn upward last. */
  const recede = useSharedValue(0);
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);
  const d = useSharedValue(0);

  useEffect(() => {
    const list = beats && beats.length > 0 ? [...beats].sort((x, y) => x - y) : [420];
    const first = list[0];
    const last = list[list.length - 1];

    // Ignition must win the race with the first ghost's fringe (~220ms in): fast
    // concentrated arrival, then the slower spread across the rest of the lead.
    gather.value = withSequence(
      withTiming(0.7, { duration: 120, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: Math.max(200, first - 120), easing: Easing.inOut(Easing.cubic) })
    );
    energy.value = withSequence(
      withTiming(0.75, { duration: 140, easing: Easing.out(Easing.cubic) }),
      withTiming(0.95, { duration: Math.max(140, first - 220), easing: Easing.inOut(Easing.sin) }),
      // The release — short and controlled, peaking as the first tile emerges…
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
      // …then settle and HOLD. The recede owns the exit entirely.
      withTiming(0.88, { duration: 620, easing: Easing.inOut(Easing.sin) })
    );
    swell.value = withDelay(
      Math.max(0, first - 60),
      withSequence(
        withTiming(1, { duration: 640, easing: Easing.inOut(Easing.cubic) }),
        withTiming(0.3, { duration: 1200, easing: Easing.inOut(Easing.sin) })
      )
    );
    if (list.length > 1) {
      const seq: ReturnType<typeof withTiming>[] = [];
      let clock = 0;
      for (const t of list.slice(1)) {
        const at = Math.max(0, t - 90);
        const wait = Math.max(0, at - clock);
        const up = withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) });
        seq.push(wait > 0 ? withDelay(wait, up) : up);
        seq.push(withTiming(0, { duration: 340, easing: Easing.inOut(Easing.sin) }));
        clock = at + 470;
      }
      // @ts-expect-error withSequence is variadic; spreading the built list is the intent
      ripple.value = withSequence(...seq);
    }
    recede.value = withDelay(
      last + 680,
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.cubic) })
    );

    const spin = (v: SharedValue<number>, ms: number) => {
      v.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.sin) }), -1, true);
    };
    spin(a, DRIFT_A);
    spin(b, DRIFT_B);
    spin(c, DRIFT_C);
    spin(d, DRIFT_D);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const band = useAnimatedStyle(() => ({ opacity: on.value }));

  /** 1 — THE ATMOSPHERE. Width breathes on `a` (6.1s), depth on `c` (9.7s) — two
   *  unrelated clocks on two axes, which is "slowly changes width and depth" without
   *  a synchronized pulse. Exits LAST, drawn upward. */
  const atmosphereStyle = useAnimatedStyle(() => {
    const A = a.value - 0.5;
    const B = b.value - 0.5;
    const C = c.value - 0.5;
    return {
      opacity:
        interpolate(energy.value, [0, 0.45, 1], [0, 0.62, 0.95]) *
        interpolate(recede.value, [0.25, 1], [1, 0], "clamp"),
      transform: [
        { translateY: -20 * (1 - gather.value) + 12 * swell.value - 58 * recede.value + 6 * A },
        { translateX: 10 * B },
        { scaleX: 0.9 + 0.1 * gather.value + 0.1 * A },
        {
          scaleY:
            0.84 + 0.16 * gather.value + 0.1 * swell.value + 0.12 * C - 0.16 * recede.value,
        },
      ],
    };
  });

  /** 2a — CYAN, the heavier left concentration. Intensity on `d` (5.1s). */
  const cyanLStyle = useAnimatedStyle(() => {
    const A = a.value - 0.5;
    const C = c.value - 0.5;
    const D = d.value - 0.5;
    return {
      opacity:
        Math.min(
          1,
          interpolate(gather.value, [0, 0.35, 1], [0, 0.5, 1]) *
            interpolate(energy.value, [0, 0.4, 1], [0.3, 0.8, 1]) *
            (0.78 + 0.36 * D) +
            0.1 * ripple.value
        ) * interpolate(recede.value, [0, 0.7], [1, 0], "clamp"),
      transform: [
        { translateY: -26 * (1 - gather.value) + 15 * swell.value - 42 * recede.value + 5 * C },
        { translateX: 12 * A },
        { scaleX: 0.85 + 0.15 * gather.value },
        { scaleY: 0.85 + 0.15 * gather.value + 0.06 * ripple.value },
      ],
    };
  });

  /** 2b — CYAN, the lighter right concentration. Intensity on `b` (8.3s), INVERTED —
   *  with L on 5.1s the two drift through every relationship: one gathers while the
   *  other relaxes, sometimes both, sometimes neither. Redistribution, not a seesaw. */
  const cyanRStyle = useAnimatedStyle(() => {
    const B = b.value - 0.5;
    const D = d.value - 0.5;
    return {
      opacity:
        Math.min(
          1,
          interpolate(gather.value, [0, 0.45, 1], [0, 0.4, 1]) *
            interpolate(energy.value, [0, 0.4, 1], [0.3, 0.75, 1]) *
            (0.78 - 0.36 * B) +
            0.08 * ripple.value
        ) * interpolate(recede.value, [0, 0.7], [1, 0], "clamp"),
      transform: [
        { translateY: -22 * (1 - gather.value) + 13 * swell.value - 42 * recede.value + 4 * D },
        { translateX: -10 * D },
        { scaleX: 0.85 + 0.15 * gather.value },
        { scaleY: 0.85 + 0.15 * gather.value + 0.05 * ripple.value },
      ],
    };
  });

  /** 3 — THE SOURCE. Compact, wandering a few points, intensity ±8% on `d`. The
   *  first thing seen gathering and the FIRST thing to die at the recession. */
  const coreStyle = useAnimatedStyle(() => {
    const A = a.value - 0.5;
    const B = b.value - 0.5;
    const D = d.value - 0.5;
    return {
      opacity:
        Math.min(
          1,
          (0.25 + 0.75 * gather.value) *
            interpolate(energy.value, [0, 0.3, 1], [0, 0.8, 1]) *
            (0.92 - 0.16 * D) +
            0.08 * ripple.value
        ) * interpolate(recede.value, [0, 0.35], [1, 0], "clamp"),
      transform: [
        { translateY: -30 * (1 - gather.value) + 16 * swell.value - 26 * recede.value + 4 * A },
        { translateX: 8 * B + 6 * D },
        { scaleX: 0.6 + 0.4 * gather.value },
        { scaleY: 0.6 + 0.4 * gather.value + 0.04 * ripple.value },
      ],
    };
  });

  /** Field geometry, canvas coordinates — display edge at y = LIFT, every cy above it.
   *  Sized by PERCEPTIBILITY (see header): the atmosphere's ~4%-luminance boundary
   *  lands just outside the clock and battery; the corners compute to ~3%. Rims all
   *  die inside the canvas, so nothing clips at meaningful alpha. */
  const sx = OV;
  return (
    <Animated.View style={[styles.band, band]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.additive, atmosphereStyle]}>
        <Svg width={CANVAS_W} height={CANVAS_H}>
          <Defs>
            <RadialGradient id="aurIndigo" cx="50%" cy="50%" rx="50%" ry="50%">
              {stops(INDIGO)}
            </RadialGradient>
            <RadialGradient id="aurRoyal" cx="50%" cy="50%" rx="50%" ry="50%">
              {stops(ROYAL)}
            </RadialGradient>
          </Defs>
          <Ellipse cx={sx + 0.5 * W} cy={25} rx={0.58 * W} ry={300} fill="url(#aurIndigo)" />
          <Ellipse cx={sx + 0.46 * W} cy={45} rx={0.5 * W} ry={280} fill="url(#aurRoyal)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.additive, cyanLStyle]}>
        <Svg width={CANVAS_W} height={CANVAS_H}>
          <Defs>
            <RadialGradient id="aurCyanL" cx="50%" cy="50%" rx="50%" ry="50%">
              {stops(CYAN_L)}
            </RadialGradient>
          </Defs>
          <Ellipse cx={sx + 0.34 * W} cy={75} rx={0.68 * W} ry={220} fill="url(#aurCyanL)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.additive, cyanRStyle]}>
        <Svg width={CANVAS_W} height={CANVAS_H}>
          <Defs>
            <RadialGradient id="aurCyanR" cx="50%" cy="50%" rx="50%" ry="50%">
              {stops(CYAN_R)}
            </RadialGradient>
          </Defs>
          <Ellipse cx={sx + 0.66 * W} cy={68} rx={0.68 * W} ry={220} fill="url(#aurCyanR)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.additive, coreStyle]}>
        <Svg width={CANVAS_W} height={CANVAS_H}>
          <Defs>
            <RadialGradient id="aurCore" cx="50%" cy="50%" rx="50%" ry="50%">
              {stops(CORE)}
            </RadialGradient>
          </Defs>
          <Ellipse cx={sx + 0.50 * W} cy={96} rx={0.35 * W} ry={115} fill="url(#aurCore)" />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** Rises ABOVE the display edge — the canvas's offscreen third is where the field
   *  centres live. Nothing here is anchored inside the interface. */
  band: { position: "absolute", top: -LIFT, left: -OV, right: -OV, height: CANVAS_H },
  /**
   * Real screen compositing — cannot darken, cannot grey-lift; device-confirmed.
   * Where unsupported, the fields alpha-blend: dark blue over black, still edgeless.
   */
  additive: { mixBlendMode: "screen" },
});
