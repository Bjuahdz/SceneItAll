import React, { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
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

import type { MarqueeRect, MarqueeRemeasure } from "./Marquee";
import { FONT, GRAYSCALE, ROW, SEARCH_LAYOUT, SIGNAL, TRACK2, accentAlpha, groundAlpha } from "@/constants/signal";
import { fingerprint, tileArtUri, type PositionedTile } from "@/services/recentsBoard";

/**
 * One brick on the recents board.
 *
 * Three shapes, and which one you get depends on the ARTWORK, never on what the
 * entity is — see `shapeFor`. That is what makes TV shows free later: a show is
 * landscape, and there is nothing else to write.
 *
 * ▸ NO ACCORDION, NO MARQUEE. On the ledger a row had to unroll into a card because
 * a list of text has no hero. Every tile here IS already the artwork that card
 * existed to reveal, so the middle step has nothing left to show — a tap grows
 * straight into the entity page, through the same rect pipeline the marquee feeds.
 */

/** The face sits high in a 2:3 profile, so the crop is anchored above centre —
 *  the same 0.16 the marquee and the person hero both use. */
const PERSON_FOCUS = 0.16;

/**
 * Text scales with the tile, and the SMALLEST tile earns only a name.
 *
 * ⚠ RETUNED FOR THREE COLUMNS. A single-column tile is now ~111pt wide, not ~171, so
 * its text box is 93pt — a name at 16px wrapped to four lines and buried the picture.
 * The meta lane survives on SPANS ONLY for the same reason: at this width a second
 * line of type is most of the tile.
 *
 * This is the cost Bryan accepted when he called for a third column. If a name ever
 * has to read at a glance more than the artwork does, that is the trade to revisit.
 */
const TITLE_SIZE = { span: 22, portrait: 12, wide: 11 } as const;

/**
 * ▸ THE SCRIM — one ramp, two copies, no traceable edge.
 *
 * The darkening under a tile's name. It has to make a title readable over a bright
 * poster without turning the artwork to mud, and — Bryan, device, 2026-08-10 — it
 * must never announce itself: "you can actually see the really rough and abrupt line
 * of the overlay on top of the tile."
 *
 * ⚠ WHY THERE WAS A LINE, AND IT IS NOT WHERE IT LOOKS. The old ramp was three
 * stops, `0 → 0.74 → 0.96` at `0 / 0.6 / 1`. Its alpha REACHES zero at the top edge,
 * so nothing is drawn there — but its SLOPE does not: above the box the alpha is
 * flat at zero, and one pixel below it is already climbing at full rate. The eye
 * reads a discontinuity in the first derivative as an edge (Mach banding) even
 * though every pixel value is correct. That is the "abrupt line", and no amount of
 * lowering the alpha could remove it — a gentler linear ramp just moves a fainter
 * line to the same place.
 *
 * THE FIX IS AN EASED ONSET: the ramp now leaves zero almost flat (0.04 over the
 * first sixth) and only then bends into the old curve. The stops below are chosen so
 * that at every ABSOLUTE distance from the tile's foot the alpha matches the old
 * ramp within a couple of percent — the text zone is exactly as legible as Bryan
 * signed off on; only the invisible top gained a soft lead-in, which is why the
 * heights grew by ~38% (that extra height is the whisper, not more darkness).
 */
const SCRIM_H = { span: 180, portrait: 116, wide: 80 } as const;
/** Top → bottom, one ground colour throughout — only the alpha moves. Paired
 *  positionally with SCRIM_STOPS; the two must stay the same length. */
const SCRIM_COLORS = [
  groundAlpha(0),
  groundAlpha(0.04),
  groundAlpha(0.1),
  groundAlpha(0.37),
  groundAlpha(0.74),
  groundAlpha(0.96),
] as const;
const SCRIM_STOPS = [0, 0.17, 0.28, 0.5, 0.71, 1] as const;

/**
 * ▸ TILES FLOAT IN AT THE BOTTOM AND FLOAT AWAY AT THE TOP.
 *
 * The first pass only animated arrivals, and gently — Bryan: "I don't even see it...
 * it's more like it's mounting into view." Two things were wrong. It was too small to
 * register (0.94 scale over 130pt is a rounding error at arm's length), and it was
 * one-sided, so tiles snapped out of existence at the top having drifted in at the
 * bottom. A board you climb should breathe at both ends.
 *
 * ▸ THE DEPARTURE IS THE BLUR BAND, DERIVED — not two numbers that meant to be.
 *
 * A tile is GONE once its bottom edge is under the solid head of the top mask, and
 * fully PRESENT while its bottom edge is still clear of the band entirely. Between
 * those it dissolves in step with the glass that is taking it, which is what the
 * treatment was always for.
 *
 * ⚠ These were hand-picked (96 + 150 = 246) and the band is 138. The fade therefore
 * began more than 100pt BELOW the glass — and at rest the topmost row of the board
 * sits at ~189, inside it. So the top of the board rendered permanently at ~62%
 * presence: dimmed and slightly shrunk, with nothing scrolling and nothing departing.
 * That is precisely where every new search lands, so the arrival was being watched
 * through a fade meant for content on its way out.
 */
const ARRIVE_SPAN = 190;
const DEPART_EDGE = SEARCH_LAYOUT.topEdgeSolid;
const DEPART_SPAN = SEARCH_LAYOUT.topEdge - SEARCH_LAYOUT.topEdgeSolid;
const FLOAT_SCALE = 0.88;
const FLOAT_LIFT = 26;
const FLOAT_DIM = 0.12;

/**
 * ▸ THE LANDING — a memory coming into focus, not a card falling.
 *
 * Third pass, and each rewrite fixed a different wrong idea. The first landed EVERY
 * tile, so the whole board settled when only the new search should have moved. The
 * second answered "it's a twitch" with distance, launching each tile off-screen and
 * descending the full display — which at three columns turned four searches into
 * streaks crossing the screen (Bryan: "I just don't think this looks good at all").
 *
 * The brief that replaced it made the tile begin slightly above its own slot — which
 * quietly meant only the top row ever met the light (v2: "cards populating into a
 * grid"). Then came "half-inside the glow", which leaked at scale — see LAND_OVERSHOOT
 * for the autopsy. The CURRENT rule is absolute: every tile begins BEYOND the physical
 * top edge and descends its real distance. What carries the arrival is still the
 * FOCUS PULL — the image stays an indistinct, source-lit fragment for most of the
 * move and sharpens hard at the landing, so it reads as recognition rather than as a
 * card sliding in.
 *
 * ⚠ A SECOND COPY OF THE ARTWORK AT `blurRadius`, CROSSFADED — not a BlurView.
 * expo-blur composes a backdrop filter, and a `UIVisualEffectView` inside a
 * TRANSFORMED parent renders as a bright frosted panel on iOS. A landing tile is
 * nothing but transform, so a BlurView is exactly the wrong tool here — it is the
 * hazard the entity hero gates its own blur on `settled` to avoid. `blurRadius` is
 * baked into the image itself, so it survives any transform, and fading the blurred
 * copy out over the sharp one IS the resolve.
 */
/**
 * A SPRING, not a curve, and a heavily damped one.
 *
 * `dampingRatio` just under 1 is the whole brief in a number: it settles without a
 * bounce, overshooting its slot by about a percent before resolving, which is the
 * "gained weight" landing rather than the rubbery one. Passing `duration` alongside
 * it keeps the spring on a known clock, so the board can still time the moment every
 * blurred copy is safe to unmount.
 */
/**
 * ⚠ 720 → 1120. Bryan, device: "the way that they kind of float into the grid is a bit
 * too fast. I was actually wanting it to be a little bit more spectacular." Nothing
 * about the choreography changed for this — the tile makes the same journey through the
 * same focus pull, it is simply given the time to be watched doing it. The blur now
 * holds for roughly three quarters of a second before it breaks, which is long enough
 * for the eye to find the tile and want it to resolve.
 */
const LAND_MS = 1800;
const LAND_DAMPING = 0.84;
/**
 * ▸ EVERY CARD STARTS BEYOND THE DEVICE'S TOP EDGE. NO EXCEPTIONS, NO TUNING.
 *
 * Bryan's invariant: "no matter how many movies a person ends up doing in one search
 * session... none of the cards, at first, are visible at all."
 *
 * ⚠ WHY NO CONSTANT COULD EVER FIX THIS (the circles he went in). The old start line
 * was EMERGE_BOTTOM = 96: every tile began with its bottom edge 96pt INTO the screen,
 * as a deliberate half-visible "impression". ONE waiting ghost at ~14% opacity reads
 * as an impression — but every tile in the session SITS at that line from the moment
 * the board mounts until its stagger fires, stacked on top of each other, and ten
 * stacked ghosts compound to a clearly visible pile. That is why 5 worked and 10
 * leaked, and why it depended on the packing (spans hang deepest into the screen).
 * LAND_RISE could not help: it was only a floor inside a max(), so the deep-tile
 * branch pinned the start at 96 whatever the number said. LAND_TRAVEL_MAX was worse —
 * the cap CREATED visible starts by clamping deep tiles' travel (and at 60 it clamped
 * every tile's, which is the "they just pop into their spots" Bryan saw).
 *
 * The fix is geometry, not opacity: a tile whose ghost sits entirely above the
 * physical edge is invisible however many share the line, on every device — because
 * the start is derived from the tile's OWN layout (originY + y + height), never from
 * a guessed screen size. All three old knobs are deleted.
 */
/**
 * The one knob that remains: how far past the top edge the card begins, beyond its
 * own bleed. HIGHER = starts deeper offscreen — a longer invisible fall, a later
 * entry into the glow. LOWER = starts tighter against the edge. ⚠ Never below
 * GHOST_BLEED (24): the blurred ghost overhangs the tile by that much, and under 24
 * the bleed's fringe peeks below the edge at frame one.
 */
const LAND_OVERSHOOT = 44;
/** The lateral component. Signed by the entity's own fingerprint, so tiles do not all
 *  slide in off the same axis and each one drifts the same way forever. */
const LAND_DRIFT = 55;
/**
 * Starts SMALLER and expands into its slot — Bryan: "scale down just a tad bit and
 * scale up into its location, falling into place."
 *
 * The first version over-scaled instead (1.06 → 1), which reads as a card retreating
 * from the camera. Arriving from under-size reads as the tile finding its footprint,
 * and it pairs with the blur breaking: the thing gets bigger and sharper at once,
 * which is what "resolving" looks like. Shallower than it was, because over a short
 * travel a deep scale is a pop.
 */
const LAND_FROM_SCALE = 0.75;
/**
 * How present the defocused impression is while it falls through the field.
 *
 * ⚠ RESTORED 0.25 → 0.5. Bryan dropped this to 0.25 as a WORKAROUND for the waiting
 * cards being visible — and said so: it "takes away the full effect of the defocus...
 * it looked better if we were able to show it". The offscreen start makes hiding a
 * matter of geometry instead of dimness (a card above the edge is invisible at ANY
 * opacity), so the defocus gets its presence back. If the falling impression now
 * reads too loud, THIS is the knob: higher = richer ghost, lower = fainter.
 */
const LAND_FROM_OPACITY = 0.5;
/*
 * ⚠ 28 → 40 (v4 frames). At 28 a large tile's ghost was READABLE mid-travel — F06
 * shows a portrait whose face is discernible while still high in the field, which is
 * most of why the descent kept reading as "populate". An impression, not a picture:
 * the blur has to be deep enough that recognition genuinely waits for the landing.
 */
const LAND_BLUR = 40;
/**
 * ▸ THE DEFOCUS BLEEDS PAST THE TILE. This is the difference between a memory fragment
 * and a blurry card, and it was the biggest fidelity gap in the whole arrival.
 *
 * The blurred copy used to live inside the tile's own `overflow: hidden`, so it was a
 * BLURRY IMAGE WITH A CRISP ROUNDED-RECTANGLE EDGE — which reads as a card that has
 * been blurred, never as something out of focus. Nothing out of focus has a sharp
 * outline. On the Paper board the falling cards only read as fragments because their
 * blur spilled outside their bounds.
 *
 * So the tile's clip moved INWARD, to a child, and the ghost lives in the unclipped
 * wrapper where it can overhang on every side.
 *
 * ⚠ THE FEATHER IS STILL MISSING, AND THE ATTEMPT IS WORTH RECORDING. `blurRadius` is
 * baked into the bitmap and always works, but it samples edge pixels, so its outline
 * stays hard. A view-level `filter: [{ blur }]` blurs the composited result INCLUDING
 * its outline, which is exactly the missing piece — except that on device it rendered
 * an opaque backing, giving every arriving card a pale rectangle larger than itself.
 * It has been removed. Whoever tries again should reach for a `MaskedView` with a
 * soft-edged mask rather than a filter.
 */
const GHOST_BLEED = 24;
/**
 * ▸ THE FOCUS PULL. The blur does NOT clear linearly.
 *
 * It holds flat for most of the travel and breaks at the end, which is the difference
 * between a fade-in and a memory sharpening into recognition. Everything else —
 * opacity, the bloom, the text — is timed against this one number.
 *
 * ⚠ 0.66 → 0.8 → 0.72 (v4). The v4 brief pins the window exactly: "during the final
 * 25–35% of movement, rapidly reduce blur". 0.72 is the final 28% — a touch earlier
 * than the 0.8 cut so the sharpening is watchable rather than a snap at the slot,
 * and the DEEPER blur (40, above) is what keeps mid-travel unreadable now.
 */
const LAND_REVEAL_FROM = 0.72;
/**
 * ▸ TEXT AFTER THE PICTURE, ALWAYS.
 *
 * The name lifts in once the tile is locked and sharp, never during the descent. A
 * legible title on a defocused tile is the one thing that would give away that this
 * is a card animating rather than an image resolving.
 */
const TEXT_LEAD = LAND_MS - 110;
const TEXT_MS = 360;
const TEXT_LIFT = 7;

/**
 * How long ONE tile takes from the moment its delay expires to being fully landed,
 * sharp and named.
 *
 * Exported because the board schedules two things against it — when the masthead may
 * come back, and when the blurred copies are safe to unmount — and both were guessing
 * at it before. The masthead in particular was fading in while the last tile was still
 * falling, which is exactly the overlap Bryan asked to remove.
 */
export const LAND_RESOLVE_MS = TEXT_LEAD + TEXT_MS;

/**
 * ▸ WHERE THE HAPTIC FIRES — a POSITION, not a moment in time.
 *
 * The first cut scheduled the tap on a clock (`beat + LAND_MS`) and it landed
 * badly late (Bryan: "super delayed"). The reason is the spring itself: a damped
 * spring covers most of its distance early and then EASES into the slot, so the
 * end of its duration is the end of a long quiet tail, not the arrival the eye
 * sees. Any clock-based guess is a guess about a curve.
 *
 * So the tile fires the tap itself, when `land` — which maps linearly to how much
 * of the travel is left — crosses this fraction. 0.97 = "97% of the way home",
 * which is where the descent visually stops. It is correct by construction at any
 * LAND_MS, any damping, and any travel distance.
 *
 * HIGHER (→1) = fires closer to the exact slot, later. LOWER = earlier, while the
 * tile is still visibly closing. Below ~0.9 it will read as anticipation.
 */
const LAND_HAPTIC_AT = 0.92;

/**
 * ▸ THE CUE CARRIES THE TILE'S MASS — the fix for "a continuous burst".
 *
 * With accurate timing the haptics STILL fused into one texture, and the reason is
 * perceptual, not mechanical: identical taps 150ms apart (the stagger) are below
 * the finger's resolution for discrete events — a fast drumroll is one sound. What
 * separates events at that rate is DIFFERENCE, and the honest difference between
 * landings is the size of what landed. So the cue names the tile's weight, from
 * its shape: a one-unit brick is light, a tall portrait is medium, a spanning
 * backdrop is heavy. The screen maps weight to impact style; the cascade stops
 * being a metronome and becomes objects seating.
 */
export type LandWeight = "light" | "medium" | "heavy";
const NO_TAP = (_w: LandWeight) => {};

export default function RecentTile({
  tile,
  scrollY,
  originY,
  viewportH,
  landDelay,
  landing,
  shift,
  reflow,
  onPress,
  onLand,
}: {
  tile: PositionedTile;
  scrollY: SharedValue<number>;
  /** Where board space begins inside the scroll content — see RecentsBoard. */
  originY: number;
  viewportH: number;
  /** Stagger, in ms. `null` means this tile is not part of the arriving session, so it
   *  is already landed and renders sharp from the first frame. */
  landDelay: number | null;
  /** False once the whole board has finished landing, which is what unmounts every
   *  blurred copy at once instead of re-rendering sixty tiles one at a time. */
  landing: boolean;
  /** Where this tile sat BEFORE the arriving session made room, relative to where it
   *  sits now. `null` for a tile that has not moved, and for every new tile. */
  shift: { dx: number; dy: number } | null;
  /** One timeline for the whole board's reflow, owned by RecentsBoard. Shared rather
   *  than per-tile because the older tiles are being REORGANISED, not revealed — they
   *  move as one field, once. */
  reflow: SharedValue<number>;
  onPress: (tile: PositionedTile, rect?: MarqueeRect, remeasure?: MarqueeRemeasure) => void;
  /** Fired once, from the UI thread, when this tile reaches its slot, carrying the
   *  tile's weight — see LAND_HAPTIC_AT and LandWeight. The screen decides whether
   *  and how the cue becomes a haptic. */
  onLand?: (weight: LandWeight) => void;
}) {
  const { search, shape, span, x, y, width, height } = tile;
  const ref = useRef<View>(null);

  /** Signed lateral offset for the arrival. A hash, so it is arbitrary between tiles
   *  and constant for any one of them — see `fingerprint`. */
  const drift = (fingerprint(search) & 1 ? 1 : -1) * LAND_DRIFT;
  /** This tile's OWN travel: from beyond the physical top edge down to its slot.
   *  Computed from layout (originY + y at scroll 0), not from the live position, so
   *  the start point cannot move if the board scrolls mid-flight. By construction the
   *  start puts the tile's bottom — bleed included — above screen y 0, so a waiting
   *  card CANNOT be seen, whatever the session size. A plain number the worklet
   *  closes over. */
  const rise = originY + y + height + LAND_OVERSHOOT;
  const shiftX = shift?.dx ?? 0;
  const shiftY = shift?.dy ?? 0;

  /** A tile only wears the blur and bloom if it is actually arriving. Everything
   *  already on the board renders sharp from the first frame — the complaint that
   *  started this was the whole board settling when only the new search moved. */
  const isLanding = landing && landDelay !== null;

  const land = useSharedValue(landDelay === null ? 1 : 0);
  /** Text is on its own clock, keyed to the END of the landing rather than to its
   *  progress, so nothing readable appears while the picture is still defocused. */
  const reveal = useSharedValue(landDelay === null ? 1 : 0);
  useEffect(() => {
    if (landDelay === null) return;
    land.value = withDelay(
      landDelay,
      withSpring(1, { duration: LAND_MS, dampingRatio: LAND_DAMPING })
    );
    reveal.value = withDelay(
      landDelay + TEXT_LEAD,
      withTiming(1, { duration: TEXT_MS, easing: Easing.out(Easing.cubic) })
    );
    // Mount only. The board REMOUNTS whenever you come back from a search (the body
    // was the results list, not this), so a fresh mount is exactly the moment the
    // choreography should run — and it is also what turns a re-searched entity's
    // whole-board re-flow into a landing instead of a jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ▸ THE ARRIVAL CUE — read off the animation, not off a stopwatch. See
   * LAND_HAPTIC_AT. One edge crossing per landing: `prev` guards the repeat, and a
   * spring that overshoots slightly cannot re-trigger because it never returns
   * below the threshold once past it.
   */
  const tap = onLand ?? NO_TAP;
  /** Mass from shape, no magic numbers: the packer's own vocabulary already ranks
   *  the sizes. A wordmark lands light — it is a bordered card of text. */
  const landWeight: LandWeight = span ? "heavy" : shape === "portrait" ? "medium" : "light";
  useAnimatedReaction(
    () => land.value,
    (v, prev) => {
      if (!isLanding || prev === null) return;
      if (prev < LAND_HAPTIC_AT && v >= LAND_HAPTIC_AT) runOnJS(tap)(landWeight);
    }
  );

  /**
   * Driven by POSITION, not by an entrance trigger — there is no "has this appeared
   * yet" state anywhere, so nothing can get stuck mid-animation, and scrolling back
   * and forth shows the same arrival every time rather than a board that has spent
   * its trick.
   *
   * `arrive` and `depart` are tracked separately because the LIFT has to reverse
   * sign: a tile below the fold is pushed down and rises into place, a tile leaving
   * at the top keeps rising as it goes. Scale and opacity take whichever factor is
   * smaller, so the two ends never fight over a tile that is somehow both.
   *
   * Runs entirely on the UI thread off one shared value — sixty tiles cost sixty
   * worklets per frame and zero React renders.
   */
  const float = useAnimatedStyle(() => {
    const screenY = originY + y - scrollY.value;
    // Read first: the threshold below depends on how far through its landing this tile
    // is, not only on where its slot sits.
    const l = land.value;
    const arrive = interpolate(
      screenY,
      [viewportH - ARRIVE_SPAN, viewportH],
      [1, 0],
      Extrapolation.CLAMP
    );
    /**
     * ▸ THE THRESHOLD — and the reason the landing offset belongs in this sum.
     *
     * Bryan's brief: "hide or clip cards while they are above the threshold. Reveal
     * them progressively as they cross the emergence zone." The board already had the
     * machinery for that — the departure fade — but it was reading the tile's LAYOUT
     * position, so a tile that was 150pt higher because it had not landed yet was
     * treated as though it were already in its slot. Which is exactly why cards were
     * visible sliding over the header.
     *
     * Reading where the tile ACTUALLY is makes the emergence fall out for free: it
     * starts above the line, so it starts hidden, and it reveals itself by descending.
     * No second mechanism, no clip, nothing that can disagree with the motion.
     */
    const liveY = screenY - (1 - l) * rise;
    // Measured off the tile's BOTTOM edge: it is only gone once its last pixel has
    // passed under the light, not when its top has.
    const depart = interpolate(
      liveY + height,
      [DEPART_EDGE, DEPART_EDGE + DEPART_SPAN],
      [0, 1],
      Extrapolation.CLAMP
    );
    const p = Math.min(arrive, depart);
    // THREE motions COMPOSE rather than override: the scroll float is permanent, the
    // landing is a one-shot for the arriving session, and the reflow is a one-shot for
    // everything the arrival displaced. A tile can be doing two of them at once if you
    // scroll while the board is still settling. Multiplying the scales and summing the
    // offsets keeps that honest instead of one winning. (`l` is read at the top of this
    // worklet — the threshold needs it before the departure fade is computed.)
    // 1 at mount, 0 once the field has finished making room. A tile with no shift
    // carries zeroes through and costs nothing.
    const r = 1 - reflow.value;
    return {
      opacity:
        (FLOAT_DIM + (1 - FLOAT_DIM) * p) *
        // Rises to full BY THE FOCUS PULL, not by the landing — so the last third of
        // the travel is the picture sharpening, not the picture appearing.
        interpolate(l, [0, LAND_REVEAL_FROM], [LAND_FROM_OPACITY, 1], Extrapolation.CLAMP),
      transform: [
        { translateX: shiftX * r + (1 - l) * drift },
        {
          translateY:
            shiftY * r +
            (1 - arrive) * FLOAT_LIFT -
            (1 - depart) * FLOAT_LIFT -
            (1 - l) * rise,
        },
        {
          scale:
            (FLOAT_SCALE + (1 - FLOAT_SCALE) * p) * (LAND_FROM_SCALE + (1 - LAND_FROM_SCALE) * l),
        },
      ],
    };
  });

  /**
   * The blurred copy dissolving off the sharp one — and the reason it holds FLAT
   * before it moves at all.
   *
   * A linear dissolve across the whole travel is just a crossfade, and it gives the
   * content away early. Holding at full through two thirds and then dropping steeply
   * is the focus pull: unreadable, unreadable, and then suddenly the thing is a face.
   */
  const blurStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      land.value,
      [0, LAND_REVEAL_FROM, 0.88, 1],
      [1, 0.94, 0.42, 0],
      Extrapolation.CLAMP
    ),
  }));

  /**
   * The bloom — THE SOURCE'S LIGHT STILL ON THE CARD. Brightest at the start, when the
   * tile is inside the field, and dying as it descends away from it, so the card and
   * the canopy read as one system: lit where the light is, ordinary once it has left.
   * Gone entirely before the focus pull breaks — a glow at the resolve is the flash
   * the earlier pass was told to remove.
   *
   * Accent, not ink, and SCREEN-blended: the aurora is icy blue-cyan, so a card it
   * emits must be lit in its colour — additive luminance over the blurred artwork,
   * never a milky haze. Where the blend is unsupported it alpha-blends, which is a
   * faint cool tint: quieter, never broken.
   */
  // ⚠ 0.55 → 0.38 at the start (v4, F05): at 0.55 the accent wash dominated the dim
  // ghost beneath it and the impression under the island read WHITE-lit, with a
  // traceable rounded edge — one step from the banned "visible wrapper". Lit, not lit up.
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      land.value,
      [0, 0.5, LAND_REVEAL_FROM],
      [0.38, 0.16, 0],
      Extrapolation.CLAMP
    ),
  }));

  /** The name, lifting in once the picture is already sharp. */
  const textStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * TEXT_LIFT }],
  }));

  /**
   * The rect the entity page grows out of, measured fresh.
   *
   * `measureInWindow`, not the touch — this tile is not the press target's own box
   * (the Pressable wraps artwork, a scrim and a plate), and `locationY` is relative
   * to whichever child was HIT. That mistake put an entity page's fold a card-height
   * off the marquee once already; see the M6 log.
   */
  const measure = useCallback(
    (cb: (rect: MarqueeRect | null) => void) => {
      const node = ref.current;
      if (!node) return cb(null);
      node.measureInWindow((mx, my, mw, mh) =>
        cb(mw > 0 && mh > 0 ? { x: mx, y: my, width: mw, height: mh } : null)
      );
    },
    []
  );

  const handlePress = useCallback(() => {
    // Artwork is what the page can grow out of; a wordmark has nothing to expand,
    // so it opens flat rather than folding out of an empty box.
    if (shape === "wordmark") return onPress(tile);
    measure((rect) => onPress(tile, rect ?? undefined, measure));
  }, [tile, shape, onPress, measure]);

  const titleSize = span ? TITLE_SIZE.span : shape === "portrait" ? TITLE_SIZE.portrait : TITLE_SIZE.wide;
  // Spans only. See TITLE_SIZE — at one column wide there is no room for a second line.
  const showMeta = span;
  const inset = span ? 14 : 9;
  // A one-unit tile is ~79pt tall, so the ramp is capped at the tile: a scrim taller
  // than what it darkens is just a tint. See SCRIM_H for why these grew.
  const scrimHeight = span ? SCRIM_H.span : shape === "portrait" ? SCRIM_H.portrait : SCRIM_H.wide;

  return (
    // The ref sits on the ANIMATED view, not the Pressable, because that is the box
    // the entity page grows out of — and measureInWindow on it returns the rect as
    // TRANSFORMED, so a page opened mid-swell grows from the tile you can actually see.
    <Animated.View
      ref={ref}
      style={[styles.tile, { left: x, top: y, width, height }, isLanding && styles.landingAbove, float]}
    >
    {/* ▸ THE CLIP MOVED IN HERE. The wrapper above is now unclipped so the landing ghost
        can overhang it; this child is what actually holds the corner radius and the
        surface colour. The wrapper keeps the exact same rect, so `measureInWindow` and
        the entity page's grow are untouched. */}
    <View style={styles.clip}>
    <Pressable
      onPress={handlePress}
      style={StyleSheet.absoluteFill}
      accessibilityRole="button"
      accessibilityLabel={search.title}
    >
      {shape === "wordmark" ? (
        // A wordmark has no photograph to defocus, so its whole content IS text — and
        // the reveal is the only thing standing between "it resolved" and "it faded
        // in". Without it a studio tile would land already legible next to a film
        // still coming into focus.
        <Animated.View style={[styles.wordmark, { padding: inset }, textStyle]}>
          <Text style={styles.tag}>{TYPE_TAG[search.entity_type]}</Text>
          <Text style={[styles.wordmarkName, { fontSize: span ? 34 : 14 }]} numberOfLines={2}>
            {search.title.toUpperCase()}
          </Text>
        </Animated.View>
      ) : (
        <>
          <Image
            // Via `tileArtUri`, which is also what the prefetch at commit time asks
            // for — a different width would be a different cache entry and the warm-up
            // would silently do nothing.
            source={{ uri: tileArtUri(search) ?? "" }}
            // Grayscale is per-shape: a portrait cropped small fights the backdrops
            // around it at full colour, the same reason the person hero runs heavier
            // than a film's. Authored in StyleSheet rather than inline because an
            // inline `filter` array collides with Array.prototype.filter in the style
            // prop's type — the same reason Marquee keeps its own filter in a sheet.
            style={shape === "portrait" ? styles.artPerson : styles.artWide}
            contentFit="cover"
            contentPosition={{
              top: `${(shape === "portrait" ? PERSON_FOCUS : 0.5) * 100}%`,
              left: "50%",
            }}
            // ⚠ NO TRANSITION, and it is load-bearing. The board REMOUNTS every
            // time you come back from a search (that is what runs the arrival),
            // and expo-image replays a `transition` dissolve on every mount —
            // cached or not. Sixty tiles re-dissolving at once, each compositing
            // its grayscale `filter` against the opaque backing this file has
            // already been burned by (see the ghost note below), was the "big
            // white flash on all of the movies" (Bryan, device, 2026-08-08).
            // Settled tiles must paint instantly from cache; ARRIVING tiles never
            // needed a dissolve — the blur ghost and the landing spring are their
            // entrance.
            transition={0}
          />
          {/* Same ground colour at every stop — only the alphas differ. See SCRIM_H:
              eased onset so the ramp has no traceable top edge, the flood kept at
              the foot where the name is. */}
          <LinearGradient
            colors={SCRIM_COLORS}
            locations={SCRIM_STOPS}
            style={[styles.scrim, { height: Math.min(height, scrimHeight) }]}
            pointerEvents="none"
          />
          <Animated.View
            style={[styles.plate, { left: inset, right: inset, bottom: inset - 1 }, textStyle]}
          >
            <Text style={[styles.title, { fontSize: titleSize, lineHeight: titleSize + 2 }]} numberOfLines={2}>
              {search.title.toUpperCase()}
            </Text>
            {showMeta && (
              <Text style={styles.meta} numberOfLines={1}>
                {metaFor(search)}
              </Text>
            )}
          </Animated.View>
        </>
      )}
    </Pressable>
    {/* ▸ INSIDE THE CLIP, and that is not a detail.
        When the clip moved inward for the bleeding ghost, this stayed on the wrapper —
        which no longer has a radius or an overflow, so a soft bloom became a HARD GREY
        SQUARE at the tile's exact bounds, hanging over the header (Bryan, device: the
        light-grey rectangles). A wash that is not clipped to the thing it is washing is
        not a bloom, it is a panel. */}
    {isLanding && (
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.bloom, bloomStyle]}
        pointerEvents="none"
      />
    )}
    </View>
    {/* ▸ THE RESOLVE, over the whole tile rather than inside the artwork branch — a
        wordmark has no photograph to blur but still arrives, and it should bloom and
        break with everything else instead of landing bare.

        Mounted only while the board is landing, and unmounted for ALL tiles in one
        flip rather than each re-rendering itself as it settles. */}
    {isLanding && (
      <>
        {shape !== "wordmark" && (
          <Animated.View style={[styles.ghost, blurStyle]} pointerEvents="none">
            {/* Same URI as the sharp copy, so expo-image serves it from cache — only
                the blurred rasterisation costs anything. Inset back to the tile's own
                footprint: the ghost VIEW is oversized so the blur has somewhere to
                spill, but the picture it is blurring is still tile-sized. */}
            <Image
              source={{ uri: tileArtUri(search) ?? "" }}
              style={shape === "portrait" ? styles.ghostPerson : styles.ghostWide}
              contentFit="cover"
              contentPosition={{
                top: `${(shape === "portrait" ? PERSON_FOCUS : 0.5) * 100}%`,
                left: "50%",
              }}
              blurRadius={LAND_BLUR}
            />
            {/* ▸ THE GHOST CARRIES THE SCRIM TOO — the other half of Bryan's
                "consistent and reliable, no matter if we're in transitions".
                The blurred copy used to be bare artwork while the sharp copy
                underneath was already scrimmed, so the ghost's dissolve was ALSO a
                dissolve of the darkening: the ramp faded up over the last third of
                every landing, arriving on a bright poster at exactly the moment the
                picture snapped into focus. Two edges appearing at once reads as
                noise in the tile. With the identical ramp on both layers the scrim
                is simply CONSTANT across the whole arrival — the crossfade can no
                longer reveal or hide it, and only the focus is left changing.
                Same stops, same height, inset to the ghost's own footprint. */}
            <LinearGradient
              colors={SCRIM_COLORS}
              locations={SCRIM_STOPS}
              style={[styles.ghostScrim, { height: Math.min(height, scrimHeight) }]}
              pointerEvents="none"
            />
          </Animated.View>
        )}
      </>
    )}
    </Animated.View>
  );
}

const TYPE_TAG: Record<string, string> = {
  movie: "FILM",
  tv: "SHOW",
  collection: "COLLECTION",
  company: "STUDIO",
  person: "PERSON",
};

/** `2024 · VILLENEUVE` when the director is known, otherwise the bare type. */
const metaFor = (r: PositionedTile["search"]): string => {
  const isFilm = r.entity_type === "movie" || r.entity_type === "tv";
  if (isFilm && r.year && r.subtitle) return `${r.year} · ${r.subtitle.toUpperCase()}`;
  return r.year ? `${TYPE_TAG[r.entity_type]} · ${r.year}` : TYPE_TAG[r.entity_type];
};

const styles = StyleSheet.create({
  // UNCLIPPED, and that is the point — see GHOST_BLEED. It carries position and nothing
  // else, so the rect it reports to the entity page is unchanged.
  tile: { position: "absolute" },
  clip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: SIGNAL.surface,
  },
  // Enough to read a face as a face, not enough to make the board a colour grid.
  //
  // ⚠ THE backgroundColor IS THE WHITE-FLASH FIX, not decoration. A `filter` view
  // composites an OPAQUE backing (this file's oldest scar — see the ghost note),
  // and while the image is still DECODING the layer has no pixels of its own, so
  // that backing rendered WHITE. On every return from a search the board remounts
  // and re-decodes sixty images at once, which painted the whole board as white
  // gradient blocks for a beat (Bryan's screenshots, 2026-08-08 — killing the
  // `transition` did not touch this, because the flash window is DECODE time, not
  // dissolve time). Giving the filtered layer the tile's own surface colour means
  // mid-decode composites as dark surface: at worst the artwork pops in over
  // near-black, which is a load, not a flash.
  artPerson: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SIGNAL.surface,
    filter: [{ grayscale: GRAYSCALE.personMarquee }],
  },
  artWide: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SIGNAL.surface,
    filter: [{ grayscale: GRAYSCALE.backdrop }],
  },
  /**
   * The ghost's box overhangs the tile on every side, and the blur lives HERE rather
   * than on the picture — a filter on the composited result softens the outline too,
   * which is the whole reason the ghost has room to spill into.
   */
  /**
   * ⚠ THE VIEW-LEVEL BLUR IS GONE. It was here to feather the ghost's OUTLINE, which
   * `blurRadius` cannot do — but on device it rendered an opaque backing, so every
   * arriving card wore a pale rectangle a good deal larger than itself (Bryan: "the
   * white flashing boxes"). A hard-edged defocus is a much smaller sin than a visible
   * panel, so the filter goes and `blurRadius` carries the blur alone.
   *
   * The oversized box stays because it costs nothing and is where a real feather would
   * have to live — but any second attempt needs a mask, not a filter.
   */
  ghost: {
    position: "absolute",
    top: -GHOST_BLEED,
    left: -GHOST_BLEED,
    right: -GHOST_BLEED,
    bottom: -GHOST_BLEED,
  },
  // Inset back to the tile's real footprint inside that oversized box.
  // Surface under the filter for the same reason as the sharp copies above — a
  // ghost mid-decode must be a dark nothing, not a white card.
  ghostPerson: {
    position: "absolute",
    top: GHOST_BLEED,
    left: GHOST_BLEED,
    right: GHOST_BLEED,
    bottom: GHOST_BLEED,
    borderRadius: 8,
    backgroundColor: SIGNAL.surface,
    filter: [{ grayscale: GRAYSCALE.personMarquee }],
  },
  ghostWide: {
    position: "absolute",
    top: GHOST_BLEED,
    left: GHOST_BLEED,
    right: GHOST_BLEED,
    bottom: GHOST_BLEED,
    borderRadius: 8,
    backgroundColor: SIGNAL.surface,
    filter: [{ grayscale: GRAYSCALE.backdrop }],
  },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  /** The ghost's copy of it — inset to the tile footprint inside the oversized
   *  bleed box, exactly like the picture it sits on. Rounded at the foot so it can
   *  never draw square corners past the artwork's own radius. */
  ghostScrim: {
    position: "absolute",
    left: GHOST_BLEED,
    right: GHOST_BLEED,
    bottom: GHOST_BLEED,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  bloom: { backgroundColor: accentAlpha(1), mixBlendMode: "screen" },
  /** A descending ghost crosses the settled field on its way down; it must pass in
   *  FRONT of it, or the emergence reads as a card sliding under the furniture. */
  landingAbove: { zIndex: 10 },
  plate: { position: "absolute", gap: 4 },
  title: {
    color: ROW.titleOpen,
    fontFamily: FONT.display,
    letterSpacing: -0.36, // -0.02em
  },
  meta: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: TRACK2.tag9,
  },
  wordmark: {
    flex: 1,
    justifyContent: "space-between",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SIGNAL.line,
    borderRadius: 8,
  },
  tag: {
    color: ROW.index,
    fontFamily: FONT.mono,
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: TRACK2.tag9,
  },
  wordmarkName: {
    color: ROW.titleEntry,
    fontFamily: FONT.display,
    letterSpacing: -0.63, // -0.03em at 21px
  },
});
