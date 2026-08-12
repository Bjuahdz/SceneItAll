import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from "react-native-svg";

import { GENRE_MARKS, GENRES } from "@/constants/genreMarks";
import type { SizeBandKey } from "@/hooks/useFilterState";

/**
 * THE INSTRUMENT'S CONTROLS — every value here is off the board
 * (PERSON · FILTER V3 · instrument), read with get_jsx rather than off a
 * screenshot: 46pt boxes, 4pt radius, mono 12 at 0.1em, and two border alphas
 * that carry the whole ON/OFF language (#F2EDE459 chosen, #F2EDE424 not).
 *
 * ▸ ONE SURFACE, NO FOLDERS. The board's own caption. These are plain rows on
 *   the sheet, not cards — nothing here gets a container of its own.
 * ▸ NOTHING ANIMATES ON TAP. The count in the header is the referee (Bryan's
 *   conflict ruling: no auto-flip, the number tells you what you did), so a
 *   control's job is to show its state clearly and get out of the way.
 */

const INK = "#F2EDE4";
const MUTED = "#8A8279";
const DIM = "#5C5651";
const LINE_ON = "rgba(242, 237, 228, 0.35)";
const LINE_OFF = "rgba(242, 237, 228, 0.14)";
const DOT_OFF = "#3A3530";

const BOX_H = 46;
const BOX_R = 4;
const GUTTER = 16;
/** The decade strip's gap — the board's 6, and half of the identity below. */
const GAP = 6;
/** Four across, two rows — eight in view. Five was too tight for the marks. */
const PER_ROW = 4;
/** A genre cell stacks a mark over a word, so it is taller than a control box. */
const CELL_H = 76;
const MARK_SIZE = 24;
/**
 * A WHOLE NUMBER OF ROWS — never a cell cut in half. Bryan's rule, and the same
 * one the decade scroller already obeys. The row pitch divides the scroll range
 * exactly (`maxOffset = pitch × (rows − visible)`), so a plain `snapToInterval`
 * lands clean on the last page with no end-case, exactly as it does there — and
 * that identity holds for ANY whole `visible`, which is what lets a short screen
 * show one row without breaking the snap (see FIT in FilterSheet).
 *
 * TWO is the default and what every full-size phone gets. Cutting the sliver
 * removes the only hint that more exists, which is why the EDGE FADE below is
 * not decoration — it is the sole affordance.
 */
const VISIBLE_ROWS = 2;
const ROW_PITCH = CELL_H + GAP;
/** How deep the "more below / more to the right" fade reaches. */
const FADE = 44;
/** How far a cell travels while floating in, in scroll points. */
const FLOAT_SPAN = 64;

// ── Rating field, off `RATING KNOB · SCRUB & SEAT` and the instrument board ──
const PAD_H = 47;
const DOT_COLS = 19;
const DOT_ROWS = 4;
const VALUE_W = 52;
const KNOB_INSET = 8;
const KNOB_W = 10;
const KNOB_H = 33;
/** Lifted: seven proud above and below, and two wider under the thumb. */
const KNOB_W_LIFTED = 12;
const KNOB_H_LIFTED = 61;
/** How far the glow reaches, as a fraction of the pad — about three columns. */
const GLOW_REACH = 0.17;
/** The quiet grid, and how bright a dot gets right under the thumb. */
const REST_ALPHA = 0.16;
const LIT_ALPHA = 1;
/**
 * The shove. Reaches wider than the glow so the field starts parting slightly
 * before it lights — the handle should feel like it displaces air. 4pt against
 * a ~14pt column pitch: felt, not seen as a gap.
 */
const PUSH_REACH = 0.24;
const PUSH_MAX = 4;
/**
 * How much less the OUTER rows shove than the inner ones. This single number is
 * what turns a rigid sliding column into one that bows around the handle.
 */
const BEND = 0.45;
/** Vertical parting, and the swell under the thumb. Small on purpose — Bryan:
 *  "enough to where you can definitely tell there's movement", not more. */
const FAN_MAX = 2.5;
const SWELL = 0.4;
/** A seat settles. Damped hard enough that it cannot overshoot the field. */
const KNOB_SPRING = { damping: 26, stiffness: 320, mass: 1 };

/* ────────────────────────────────────────────────────────────────────────────
   ▸ THE KNOB IS A LENS, NOT A LID — board `RATING KNOB · GLASS`, K4.

   It used to be a flat bar of accent: the one part of this control that was not
   a material, sitting in the middle of a field that swells, parts and lights
   around it. Bryan picked the lens out of four because of what its BODY does —
   it is translucent, and THE DOTS READ THROUGH IT. That single fact is what
   makes it sit over the field rather than on top of it, and it is why the body
   is a gradient of alphas rather than a solid: at no point does it hide the
   thing it is measuring.

   ▸ THE HALO IS A FAKE BLUR, ON PURPOSE. A real gaussian on a 12 × 61 view that
     re-sizes every frame of the lift is precisely the class of thing that cost
     the nav pill its blur and forced the sheet's settled-strip law. A radial
     gradient buys the same softness for a single SVG that is NEVER RESIZED —
     it is drawn once at full size and only ever transformed, so the whole
     effect costs one opacity and two scales on the UI thread.

   ▸ IT GROWS WITH THE LIFT, because the swell is the point. Bryan: "I don't
     want to lose the overall theme of it swelling." The halo is scaled by the
     same `lift` that grows the knob and swells the dots, so it reads as one
     gesture getting bigger rather than a second effect arriving alongside it —
     and it is absent entirely at rest, which keeps the field even when nobody
     is touching it.
   ──────────────────────────────────────────────────────────────────────────── */
const HALO_W = 38;
const HALO_H = 78;
/** How far the halo shrinks back when the thumb lifts. Never to nothing — a
 *  halo that scaled from zero would pop rather than swell. */
const HALO_REST_SCALE = 0.55;
const HALO_MAX_OPACITY = 1;
/* ── THE BODY — and why the first pass read as plastic. ──────────────────────
   It was a light-to-dark ramp at 0.92 alpha, which is the classic 3D-button
   recipe: an object PAINTED to look lit. Bryan, on device: "a little too
   cartoonish... I was genuinely thinking of a clear-ish knob that looks glassy."
   He is right, and the fault was not the idea but the alphas — 0.92 is not
   translucent, it is opaque with a rounding error.

   ▸ GLASS IS AN EDGE, NOT A FILL. A clear rod on a dark ground is almost
     entirely invisible in the middle and bright where its walls turn away from
     you. So the ramp no longer runs light→dark; it is DENSE AT BOTH ENDS and
     nearly nothing through the core, which is what a cylinder actually does to
     light, and it lets the dots read straight through the middle — the part
     that made him pick this one.
   ▸ ONE THIN HIGHLIGHT, not a fat streak. A short bright blob reads as gloss on
     plastic; a thin line running most of the length reads as a curved surface.
   Every number here is a look, not a law — tune freely.                      */
const LENS_TOP = "rgba(230, 245, 255, 0.26)";
const LENS_MID = "rgba(156, 202, 223, 0.08)";
const LENS_FOOT = "rgba(130, 182, 208, 0.22)";
const LENS_RIM = "rgba(255, 255, 255, 0.5)";
const LENS_SPEC = "rgba(255, 255, 255, 0.5)";

/* ▸ HALF-POINTS, AND ONLY HALF-POINTS. A hold-to-refine mode was built here —
   twice, first slowing the thumb and then zooming the field — and Bryan scrapped
   it after seeing both: "most people will just want to go by the fifths anyway,
   and it covers more area quicker." He is right for this control in particular.
   This is a MINIMUM RATING on a filmography, not a score you are authoring: the
   question it answers is "roughly how good", and 7.3 is a false precision that
   costs a slower scrub across the whole range to reach. Not deferred — decided
   against, so nobody rebuilds it from the plan's log without reading this. */
/* ────────────────────────────────────────────────────────────────────────────
   ▸ COLOUR MEANS "YOU CHANGED THIS", AND IT MEANS NOTHING ELSE.

   The board's caption is the law: "EVERY TOUCHED CONTROL WEARS THE ACCENT." At
   rest a control is INK on a `#F2EDE424` rim; touched, it is `--color-enlarger`
   on a `#9CCADF80` rim — both values verified off `PERSON · FILTER V3` in its
   two frames (ANY vs RELEASED, and the chosen decade).

   The first build got this wrong in the way that is hardest to notice: a chosen
   value was drawn in a BRIGHTER GREY than an unchosen one, and STATUS/FORMAT
   never changed at all beyond their dots. Bryan, on device: "it's hard to tell
   what filters are active just from looking at it at a glance... if I click on
   one, it's just white." Brightness is a terrible carrier for state — it is the
   same channel the type hierarchy is already using, so the eye has to compare
   two greys to answer a yes/no question. Hue does not compete with anything.

   ▸ THE RULE, and it is worth stating precisely because it is NOT "the selected
     one is blue": the accent marks a value that DIFFERS FROM THE DEFAULT. ALL
     decades, ANY status, RELEASE DATE sort are all selected and none of them is
     a filter — colouring them would mean a sheet you have never touched lights
     up like a sheet you have. Selected-but-default keeps the rest state; only a
     real pick takes colour. So one glance down the sheet answers "what is
     actually filtering here", which is the question Bryan was asking.
   ──────────────────────────────────────────────────────────────────────────── */
const ACCENT = "#9CCADF";
/** The accent at half, for a rim rather than a fill. Board: `#9CCADF80`. */
const ACCENT_LINE = "rgba(156, 202, 223, 0.5)";

/**
 * THE SHEET'S TOUCH. Every control in here answers the finger physically —
 * Bryan: "more of a physical connection".
 *
 * Two weights only, matching what the app already does elsewhere (CapturePill):
 *   · `tick()`  — the rating's detent, one per half-point. `selectionAsync`
 *     was the textbook choice and it was WRONG here: Bryan, "feels a little too
 *     light and barely even noticeable". A selection tick is tuned for a picker
 *     wheel under a still finger; this handle is being dragged, the thumb is
 *     already moving, and the whole point is to feel the field notch. RIGID,
 *     not Medium — rigid is short and hard, so twenty of them across a swipe
 *     stay crisp instead of smearing into a rumble the way a heavier, longer
 *     impact would.
 *   · `tap()`   — a LIGHT impact for committing a choice: a genre, a decade, a
 *     sort, a cycle. Discrete acts deserve a discrete knock.
 *   · `thud()` — MEDIUM, and only for the rating's two endpoints. Once the
 *     detent went Rigid, a Light lift-and-seat felt weaker than the middle of
 *     the gesture, which reads backwards: the biggest events in a scrub are
 *     picking the handle up and dropping it back in. This keeps the hierarchy
 *     honest — endpoints heaviest, detents crisp, taps lightest.
 */
const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
const thud = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

/* ────────────────────────────────────────────────────────────────────────────
   ▸ THE GRAIN — the scrub itself, felt.

   Bryan: "the haptic is only really there when we cross a column of dots, which
   throws off the feel. I wanted genuine scrubbing all throughout." He is right:
   twenty-one knocks across the whole range is a control that answers you at
   checkpoints, not one you can feel your thumb dragging across.

   ▸ THERE IS NO CONTINUOUS HAPTIC TO REACH FOR. expo-haptics exposes discrete
     events only — a real sustained texture needs Core Haptics, which is a native
     module and a new dependency. So the texture is a STREAM, and the thing that
     makes a stream feel like a surface rather than a stutter is that its rate
     follows the thumb: fast drag, dense grain; slow drag, sparse grain; still
     thumb, nothing at all. That falls out of firing per unit of TRAVEL rather
     than per unit of time.

   ▸ `selectionAsync` COMES BACK, in the job it was actually built for. It was
     tried as the DETENT and removed for being "too light and barely noticeable"
     under a moving thumb — which was the correct verdict for a notch and is
     exactly the quality wanted for a grain. It is the lightest event iOS has and
     the only one tuned to fire in a rapid stream (it is what a picker wheel
     uses). A grain you consciously notice is not a grain, it is a rattle.

   ▸ THE RATE CAP IS NOT OPTIONAL. The Taptic Engine smears if it is asked for
     events faster than it can seat them, and a fast sweep at GRAIN_STEP alone
     would ask for well over a hundred a second. Distance gates it on the UI
     thread, time gates it on the JS side, and the SAME clock gates the detents —
     so a notch and a grain can never land on top of each other and mush.

   Both numbers are dials. STEP is deliberately about a third of the dot pitch
   (~14.8pt), so the grain is finer than the field it runs over: the dots stay
   the landmarks and this is the surface between them.
   ──────────────────────────────────────────────────────────────────────────── */
const GRAIN_STEP = 6;
const GRAIN_MIN_MS = 30;
const grainTick = () => Haptics.selectionAsync();

/** `01 · SORT BY` — the section's number and name, in the board's micro mono. */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/**
 * SORT — ONE BOX, TWO ZONES, split by a hairline. Variant's shape, rebuilt to
 * this sheet's own recipe (its squareness was its recipe, not its idea).
 *
 * ▸ WHY IT IS NOT TWO BOXES. Two identical half-width boxes side by side claim
 *   to be two filters, and only one of them is even a choice about what you
 *   SEE — the other only reorders it, and its words only mean anything in terms
 *   of the first. One box with a rule down the middle says "these belong
 *   together and the left one governs the right one", which is the truth.
 *
 * ▸ THE TWO ZONES ANSWER DIFFERENTLY, on purpose. The FIELD is a cycle: one
 *   value at a time, dots counting the rest, like STATUS and FORMAT. The
 *   DIRECTION shows BOTH of its words at once with the live one lit — the best
 *   part of Variant's drawing, and the reason to keep it: you never tap to find
 *   out what the alternative is, and the alternative is the whole question.
 *
 * ▸ EACH ZONE COLOURS ITSELF. The sheet's rule is that the accent means "this
 *   differs from the default", and here that resolves per zone, so a glance
 *   tells you WHICH half you changed — RELEASE DATE in ink beside OLDEST in
 *   accent is a page in its normal field, reversed.
 */
/** The morph's clock. Long enough to read as travel, short enough that the row
 *  has finished before a second tap on a cycling control can land. */
const SORT_MORPH_MS = 260;
/**
 * Where the direction's ink starts arriving, as a fraction of the morph.
 *
 * NOT A NEW NUMBER — it is the nav FILTER pill's, and it is here for the reason
 * stated there: a word that gains or loses letters off its own edge while its
 * container travels reads as CLIPPING, not as motion. So the room opens empty
 * and the words are written into it once there is room; on the way out the words
 * leave first and the room closes behind them.
 */
const SORT_INK_AT = 0.62;

export function SortBar({
  field,
  fieldIndex,
  fieldCount,
  fieldActive,
  onCycleField,
  descLabel,
  ascLabel,
  desc,
  dirActive,
  onSetDesc,
  showDirection = true,
}: {
  field: string;
  fieldIndex: number;
  fieldCount: number;
  fieldActive: boolean;
  onCycleField: () => void;
  /** The words for THIS field — newest/oldest, highest/lowest. */
  descLabel: string;
  ascLabel: string;
  desc: boolean;
  dirActive: boolean;
  onSetDesc: (d: boolean) => void;
  /**
   * ▸ DOES THIS FIELD HAVE A DIRECTION WORTH ASKING ABOUT? (Bryan, 2026-08-05.)
   *
   * RELEVANCE does not: "closest" is the only answer anyone wants and offering
   * FURTHEST is offering to make the search worse. So on the results surface the
   * row rests as ONE full-width button, and the rule and the two words only
   * exist once you have cycled to a field that genuinely has two ends.
   *
   * ⚠ DEFAULTS TRUE, so every entity-page call site renders exactly what it
   * always did: `p` starts at 1 and nothing on that surface ever flips it, which
   * leaves the margin at 0 and the opacity at 1 on every frame.
   */
  showDirection?: boolean;
}) {
  const lit = dirActive ? styles.textAccent : styles.textOn;

  // Declared above every animated style that reads them — a worklet captures its
  // closure when the hook runs, so a shared value created below one is captured
  // as undefined.
  const dirW = useSharedValue(0);
  const p = useSharedValue(showDirection ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(showDirection ? 1 : 0, {
      duration: SORT_MORPH_MS,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [showDirection, p]);

  /**
   * ▸ THE ZONE KEEPS ITS NATURAL WIDTH AND GIVES UP ITS FOOTPRINT INSTEAD.
   *
   * A NEGATIVE RIGHT MARGIN is what makes this reliable. The obvious build —
   * animate the zone's `width` to zero and clip — cannot measure itself: an
   * absolutely-positioned child is sized against its parent's inner width, so
   * inside a zero-width frame the words are measured against zero available
   * space and the row never learns how wide it wants to be. Margin sidesteps
   * that entirely: the zone is always laid out at its true size, so one
   * `onLayout` is always correct, and the margin simply removes that size from
   * the row's arithmetic. The field beside it is `flexGrow: 1`, so every point
   * the margin reclaims is taken by the button, and the zone slides out past the
   * box's right edge where `overflow: hidden` clips it.
   *
   * ⚠ ENTITY PAGES ARE UNTOUCHED BY CONSTRUCTION, not by a guard: `p` rests at 1
   * there for the life of the sheet, so the margin is 0 and the opacity is 1 on
   * every frame — the same layout Yoga solved before this existed.
   *
   * The measurement is free of first-frame flicker for a reason worth knowing:
   * the sheet ARMS its instrument while still dormant (see FilterSheet), so this
   * row is laid out and measured long before it is ever visible.
   */
  const zoneStyle = useAnimatedStyle(() => ({
    marginRight: -dirW.value * (1 - p.value),
    opacity: interpolate(p.value, [SORT_INK_AT, 1], [0, 1], "clamp"),
  }));

  /**
   * ▸ THE WORDS BEING PUT AWAY ARE THE ONES THAT WERE THERE.
   *
   * The labels are a function of the FIELD, and the field changes in the same
   * commit that starts the collapse — so without this the zone would swap to the
   * incoming field's words (CLOSEST / FURTHEST) and then fade them out, which is
   * a flash of vocabulary belonging to a control that is in the act of ceasing to
   * exist. Held through the collapse, the row simply puts away what it had.
   */
  const held = useRef({ descLabel, ascLabel });
  if (showDirection) held.current = { descLabel, ascLabel };
  const words = showDirection ? { descLabel, ascLabel } : held.current;

  return (
    <View
      style={[styles.box, styles.sortBar, fieldActive || dirActive ? styles.boxAccent : styles.boxOff]}
    >
      <Pressable
        onPress={() => {
          tap();
          onCycleField();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${field}`}
        accessibilityHint="Cycles through the available fields"
        style={styles.sortField}
      >
        {/* Single line as a guarantee, not because it is expected to be needed:
            the field only ever GAINS room when the direction collapses. */}
        <Text
          numberOfLines={1}
          style={[styles.boxText, fieldActive ? styles.textAccent : styles.textOn]}
        >
          {field}
        </Text>
        <View style={styles.dots}>
          {Array.from({ length: fieldCount }, (_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === fieldIndex ? (fieldActive ? styles.dotAccent : styles.dotOn) : styles.dotOff,
              ]}
            />
          ))}
        </View>
      </Pressable>

      {/* ▸ THE ZONE THAT LEAVES. The field beside it is `flexGrow: 1`, so every
          point the margin reclaims is taken by the button — which is what makes
          this one object changing shape rather than two things being swapped.
          The dots ride the field's right edge the whole way, so the eye always
          has a continuous mark to track and nothing arrives from nowhere. */}
      <Animated.View
        style={[styles.sortZone, zoneStyle]}
        onLayout={(e) => {
          dirW.value = e.nativeEvent.layout.width;
        }}
        pointerEvents={showDirection ? "auto" : "none"}
        // Gone from the accessibility tree too, not merely clipped — a screen
        // reader must not offer a direction this field does not have.
        accessibilityElementsHidden={!showDirection}
        importantForAccessibility={showDirection ? "auto" : "no-hide-descendants"}
      >
        {/* The rule. It takes the box's own colour so the whole control reads
            as one object in either state, and it leaves and returns with the
            words rather than on its own clock — one behaviour, not two. */}
        <View style={[styles.sortRule, dirActive || fieldActive ? styles.sortRuleOn : null]} />

        <View style={styles.sortDir}>
          {/* Tapped directly, not cycled — both words are already on screen, so
              making you tap until the one you want appears would be theatre.
              Re-tapping the live one is silent: nothing changed. */}
          <Pressable
            onPress={() => {
              if (!desc) tap();
              onSetDesc(true);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: desc }}
            hitSlop={8}
          >
            <Text style={[styles.boxText, desc ? lit : styles.textOff]}>{words.descLabel}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (desc) tap();
              onSetDesc(false);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: !desc }}
            hitSlop={8}
          >
            <Text style={[styles.boxText, desc ? styles.textOff : lit]}>{words.ascLabel}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * STATUS / FORMAT — a CYCLE, not a menu. One tap advances; the dots on the
 * right count the cycle and show where you are in it, which is what makes a
 * button that changes its own label legible. The value sits left, the dots
 * right, so the two never trade places as the word's length changes.
 */
export function CycleButton({
  label,
  index,
  count,
  active,
  onPress,
  half = true,
}: {
  label: string;
  index: number;
  count: number;
  /** Holding anything other than its default. This control changed the most:
   *  it used to look IDENTICAL whether it said ANY or RELEASED, because only
   *  the dots moved — and a 4pt dot is not a state indicator you can read at a
   *  glance across a whole sheet. */
  active: boolean;
  onPress: () => void;
  half?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityHint="Cycles through the available values"
      accessibilityState={{ selected: active }}
      style={[
        styles.box,
        half && styles.boxHalf,
        styles.boxCycle,
        active ? styles.boxAccent : styles.boxOff,
      ]}
    >
      <Text style={[styles.boxText, active ? styles.textAccent : styles.textOn]}>{label}</Text>
      <View style={styles.dots}>
        {Array.from({ length: count }, (_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === index ? (active ? styles.dotAccent : styles.dotOn) : styles.dotOff,
            ]}
          />
        ))}
      </View>
    </Pressable>
  );
}

/**
 * DECADE — pinned ALL, four in view, snapped.
 *
 * Bryan's ruling, in full: scrollable left-to-right, "the ALL block is always
 * on the left no matter what", locked so there are "always four in view", and
 * "no dates being cut off". Every one of those falls out of one identity:
 *
 *   viewport = 4·pitch − gap   (pitch = cell + gap)
 *
 * because then `maxOffset` is EXACTLY pitch × (N − 4), so a plain
 * `snapToInterval` lands clean on the last page with no end-case to special
 * -case. The cell size is derived from the run rather than fixed, so the
 * identity holds on any screen width: five columns' worth of cells and four
 * gaps live in the row, and ALL owns the first column outside the scroller.
 *
 * The decades themselves come from `decadesIn(films)` — this filmography only,
 * newest first, no future decade unless a dated unreleased film puts one there.
 */
/**
 * A ROW OF CHIPS THAT FILLS THE RUN — one choice, equal widths, no scrolling.
 *
 * STATUS uses it today; KNOWN FOR and SIZE are the same control with a different
 * list, which is the reason it is written once and generically rather than three
 * times. The decade row is deliberately NOT this: its options are derived from the
 * result set and can outnumber the row, so it pins ALL and scrolls the rest.
 *
 * ▸ THE COLOUR LAW, AND IT IS THE WHOLE COMPONENT. `defaultKey` is the option that
 * means "no filter" — ANY. Landing on it wears INK, because it is the resting state
 * and nothing is being asked; landing anywhere else wears ACCENT, because ACCENT
 * means THIS VALUE DIFFERS FROM ITS DEFAULT. It never means "this is selected".
 *
 * Widths are divided, never declared: `flexGrow: 1` with a zero basis, so three
 * chips and five chips both span the run exactly. (A fixed width summing short of
 * the run is what made the genre grid read as inset — see filterBands.ts.)
 */
export function ChipRow<T extends string>({
  options,
  value,
  defaultKey,
  onChange,
  layout = "fill",
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  /** The option that means "no filter". Wears INK when chosen, not accent. */
  defaultKey: T;
  onChange: (next: T) => void;
  /**
   * "fill" divides the run equally — right when the labels are short (STATUS,
   * SIZE). "scroll" sizes each chip to ITS OWN WORD and lets the row scroll —
   * required the moment any label outgrows an equal share. KNOWN FOR is why this
   * exists: five chips split 350pt into 65pt cells and DIRECTING became
   * `DIRECTI…` (Bryan, 2026-08-08: "we can see every letter, and the whole words
   * are very viewable"). A clipped option is not an option.
   */
  layout?: "fill" | "scroll";
}) {
  const chips = options.map((o) => {
    const on = o.key === value;
    const changed = on && o.key !== defaultKey;
    return (
      <Pressable
        key={o.key}
        onPress={() => {
          if (!on) tap();
          onChange(o.key);
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        style={[
          styles.box,
          layout === "fill" ? styles.chipCell : styles.chipCellHug,
          changed ? styles.boxAccent : on ? styles.boxOn : styles.boxOff,
        ]}
      >
        <Text
          style={[
            styles.decadeText,
            changed ? styles.textAccent : on ? styles.textOn : styles.textOff,
          ]}
          numberOfLines={1}
        >
          {o.label}
        </Text>
      </Pressable>
    );
  });

  if (layout === "fill") return <View style={styles.chipRow}>{chips}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {chips}
    </ScrollView>
  );
}

/** ChipRow's stand-in for "no filter" where the state's own value is `null`. Kept
 *  local: nothing outside this file should ever see it. */
const ANY_KEY = "__any";

/** One half of the resting CATALOGUE band — a label and its current value. */
function CatalogueField({
  label,
  value,
  changed,
  onPress,
}: {
  label: string;
  value: string;
  changed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      style={[styles.box, styles.catalogueField, changed ? styles.boxAccent : styles.boxOff]}
    >
      <Text style={[styles.catalogueLabel]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.decadeText, changed ? styles.textAccent : styles.textOn]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </Pressable>
  );
}

/**
 * CATALOGUE — BASED IN and SIZE sharing one band, on the STUDIOS sheet.
 *
 * ▸ TWO FIELDS SHARE A ROW, SO NEITHER CAN OPEN IN PLACE. A tap gives the whole band
 * to the field you touched and it becomes the same chip row DECADE uses; picking
 * collapses it back to the pair. That is the move SORT already makes when it opens to
 * show NEWEST / OLDEST, so the sheet has one idiom for "this control has more to say"
 * rather than two.
 *
 * ▸ BASED IN IS ABSENT WHEN NOTHING IS BASED ANYWHERE. TMDB leaves `origin_country`
 * empty for a lot of small studios, and a control whose only option is ANY is a dead
 * control — degrade to fewer, never to inert. SIZE then takes the full width.
 */
export function CatalogueBand({
  basedIn,
  onBasedIn,
  countries,
  size,
  onSize,
  sizeBands,
}: {
  basedIn: string | null;
  onBasedIn: (v: string | null) => void;
  /** The countries actually present in the result set — never a fixed list. */
  countries: string[];
  size: SizeBandKey | null;
  onSize: (v: SizeBandKey | null) => void;
  sizeBands: readonly SizeBandKey[];
}) {
  const [open, setOpen] = useState<null | "basedIn" | "size">(null);
  const showBasedIn = countries.length > 0;

  if (open === "basedIn") {
    return (
      <ChipRow
        options={[
          { key: ANY_KEY, label: "ANY" },
          ...countries.map((c) => ({ key: c, label: c })),
        ]}
        value={basedIn ?? ANY_KEY}
        defaultKey={ANY_KEY}
        onChange={(k) => {
          onBasedIn(k === ANY_KEY ? null : k);
          setOpen(null);
        }}
        // A result set can hold more countries than an equal split survives —
        // same clipping KNOWN FOR hit, same cure.
        layout="scroll"
      />
    );
  }

  if (open === "size") {
    return (
      <ChipRow
        options={[
          { key: ANY_KEY, label: "ANY" },
          ...sizeBands.map((b) => ({ key: b, label: b })),
        ]}
        value={size ?? ANY_KEY}
        defaultKey={ANY_KEY}
        onChange={(k) => {
          onSize(k === ANY_KEY ? null : (k as SizeBandKey));
          setOpen(null);
        }}
      />
    );
  }

  return (
    <View style={styles.chipRow}>
      {showBasedIn && (
        <CatalogueField
          label="BASED IN"
          value={basedIn ?? "ANY"}
          changed={basedIn !== null}
          onPress={() => setOpen("basedIn")}
        />
      )}
      <CatalogueField
        label="SIZE"
        value={size ?? "ANY"}
        changed={size !== null}
        onPress={() => setOpen("size")}
      />
    </View>
  );
}

export function DecadeScroller({
  decades,
  value,
  onChange,
  runWidth,
}: {
  decades: number[];
  value: number | null;
  onChange: (d: number | null) => void;
  runWidth: number;
}) {
  const cell = (runWidth - GAP * 4) / 5;
  const pitch = cell + GAP;
  const viewport = 4 * pitch - GAP;
  // The identity in the header comment, used: the strip's travel is an exact
  // number of pitches, so the fade knows precisely when the last date lands.
  const maxOffset = Math.max(0, pitch * (decades.length - 4));
  const scrollX = useSharedValue(0);
  // Plain JS event for the same reason as the genre grid — see there.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollX.value = e.nativeEvent.contentOffset.x;
    },
    [scrollX]
  );
  return (
    <View style={styles.decadeRow}>
      <Pressable
        onPress={() => {
          if (value !== null) tap();
          onChange(null);
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: value === null }}
        style={[
          styles.box,
          styles.decadeCell,
          { width: cell },
          value === null ? styles.boxOn : styles.boxOff,
        ]}
      >
        <Text style={[styles.decadeText, value === null ? styles.textOn : styles.textOff]}>
          ALL
        </Text>
      </Pressable>
      <View style={{ width: viewport }}>
      <Animated.ScrollView
        horizontal
        // Same law as the genre grid's height — an unbounded horizontal
        // ScrollView cannot scroll, and the later decades become unreachable.
        style={{ width: viewport }}
        showsHorizontalScrollIndicator={false}
        snapToInterval={pitch}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.decadeStrip}
      >
        {decades.map((d) => {
          const on = d === value;
          return (
            <Pressable
              key={d}
              onPress={() => {
                tap();
                onChange(on ? null : d);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[
                styles.box,
                styles.decadeCell,
                { width: cell },
                // A decade IS a filter, always — unlike ALL beside it, which is
                // the absence of one and keeps the rest state.
                on ? styles.boxAccent : styles.boxOff,
              ]}
            >
              <Text
                style={[styles.decadeText, on ? styles.textAccent : styles.textOff]}
              >{`${d}s`}</Text>
            </Pressable>
          );
        })}
      </Animated.ScrollView>
      <EdgeFade axis="right" offset={scrollX} maxOffset={maxOffset} />
      </View>
    </View>
  );
}

/**
 * GENRE — a 5-wide map, multi-select, ADAPTIVE.
 *
 * Bryan's board: "PICK ANY", "SCROLL FOR ALL", plain 65×54 boxes six-visible-
 * then-scroll. Two rules it inherits from the decade scroller, for the same
 * reason: it offers only genres THIS filmography actually contains (a comedian
 * has no business being offered WESTERN), and it is capped to two rows of
 * visible height so the sheet's own rhythm survives a person with everything.
 *
 * Marks carry their own viewBox and their own render mode — the set mixes
 * filled glyphs with hairline drawings on purpose — so the cell asks the mark
 * how to draw itself rather than assuming. A genre with no mark yet renders
 * label-only: visibly unfinished, never silently missing.
 */
export function GenreMap({
  available,
  chosen,
  onToggle,
  runWidth,
  visibleRows = VISIBLE_ROWS,
}: {
  available: number[];
  chosen: number[];
  onToggle: (id: number) => void;
  runWidth: number;
  /** How many rows the sheet can afford to show — see FIT in FilterSheet. Two
   *  is Bryan's ruling and what every full-size phone gets; a short screen
   *  drops to one rather than sliding the commit bar over the grid. The snap
   *  identity does not care how many, only that it is a whole number: it is
   *  `maxOffset = ROW_PITCH × (rows − visibleRows)` either way, so no row is
   *  ever cut in half at any size. */
  visibleRows?: number;
}) {
  // THREE across, not five. At five the mark was 14px in a 65pt cell and Bryan's
  // artwork — which carries real internal detail — was unreadable. Three gives
  // each cell ~114pt and the mark 26, which is what the drawings were made for.
  const cell = (runWidth - GAP * (PER_ROW - 1)) / PER_ROW;
  const offered = GENRES.filter((g) => available.includes(g.id));
  const scrollY = useSharedValue(0);
  // ⚠ A PLAIN JS SCROLL EVENT, DELIBERATELY — NOT useAnimatedScrollHandler.
  // This repo already documents Expo Go SDK 54's worklet event plumbing as
  // partially broken (see EntityScreen: "TrendingSection/discover: scroll
  // handlers never firing"), and this control hit exactly that: `scrollY`
  // stayed at 0 while the grid scrolled, so every cell below the fold held
  // opacity 0 and read as DELETED. It looked like a selection bug because any
  // pick re-renders the sheet — picking a DECADE killed the GENRES the same
  // way. A plain onScroll always fires; the shared value it writes still drives
  // the animation on the UI thread, so the only cost is one JS hop per frame at
  // throttle 16 — a price worth paying for an event that actually arrives.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = e.nativeEvent.contentOffset.y;
    },
    [scrollY]
  );
  const rows = Math.ceil(offered.length / PER_ROW);
  const maxOffset = Math.max(0, ROW_PITCH * (rows - visibleRows));
  const viewportH = CELL_H * visibleRows + GAP * (visibleRows - 1);
  if (offered.length === 0) return null;
  return (
    <View style={{ height: viewportH }}>
      <Animated.ScrollView
        // ⚠ THE HEIGHT LIVES HERE, NOT ONLY ON THE WRAPPER. A ScrollView with
        // no bound of its own grows to its content, which makes its scrollable
        // range ZERO — it renders six rows behind a two-row window and refuses
        // to scroll, so everything past the fold is unreachable rather than
        // hidden. The wrapper exists solely to hang the fade on.
        style={{ height: viewportH }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={ROW_PITCH}
        decelerationRate="fast"
        contentContainerStyle={styles.genreGrid}
      >
        {offered.map((g, i) => (
          <GenreCell
            key={g.id}
            id={g.id}
            label={g.label}
            width={cell}
            row={Math.floor(i / PER_ROW)}
            on={chosen.includes(g.id)}
            onPress={onToggle}
            scrollY={scrollY}
            visibleRows={visibleRows}
          />
        ))}
      </Animated.ScrollView>
      <EdgeFade axis="bottom" offset={scrollY} maxOffset={maxOffset} />
    </View>
  );
}

/**
 * MINIMUM RATING — the dot field, and its one handle.
 *
 * Straight off `RATING KNOB · SCRUB & SEAT`, which specifies three states of a
 * single object:
 *   01 REST      — NO HANDLE AT ALL. An untouched floor shows only the field.
 *   02 SCRUBBING — the bar is LIFTED OUT OF ITS SEAT: 33 → 61 tall (seven proud
 *                  top and bottom) and 10 → 12 wide, so the finger cannot
 *                  swallow it — the proud ends stay visible around the thumb.
 *   03 SEATED    — drops back flush on release. SPRING, not a timing curve: a
 *                  seat should settle, not arrive. No overshoot past the field.
 *
 * ▸ THE KNOB IS A SIBLING, NOT A CHILD — the board says so and the reason is
 *   structural: the pad CLIPS its dots (that is what gives the field its
 *   rounded ends), so a lifted bar inside it would be guillotined at exactly
 *   the moment it is proud. Both are positioned from the same value instead.
 * ▸ THE GLOW IS PER-COLUMN. Dots brighten near the handle; nineteen columns
 *   share an x, so nineteen animated nodes do the work of seventy-six.
 * ▸ REACT SEES ONLY STEPS. The scrub runs on shared values; `onChange` fires
 *   only when the rounded half-point changes, so a full swipe costs at most
 *   twenty renders instead of one per frame.
 */
export function RatingField({
  value,
  onChange,
  runWidth,
}: {
  value: number;
  onChange: (v: number) => void;
  runWidth: number;
}) {
  const padW = runWidth - VALUE_W - GUTTER;
  const travel = padW - KNOB_INSET * 2;
  // 0…1 along the pad. Seeded from the value so the handle is where the number
  // says it is, even after the sheet is reopened.
  // 0…1 along the pad. Seeded from the value so the handle is where the number
  // says it is, even after the sheet is reopened.
  const pos = useSharedValue(value / 10);
  const lift = useSharedValue(0);
  /** The finger's x at the last grain. Distance from here is what earns the
   *  next one — see the GRAIN block. */
  const grainX = useSharedValue(0);

  /** ONE CLOCK FOR EVERY HAPTIC THIS CONTROL FIRES. Shared between the grain
   *  and the detents on purpose: a notch landing on the same millisecond as a
   *  grain is not two events, it is one smeared one. Whichever fires stamps it,
   *  and the other stands down until the window has passed. */
  const lastHapticAt = useRef(0);

  /** The scrub's surface. Rate-limited here, distance-limited on the UI thread —
   *  see the GRAIN block. Slow thumb: sparse. Fast thumb: capped, never mush. */
  const grain = useCallback(() => {
    const now = Date.now();
    if (now - lastHapticAt.current < GRAIN_MIN_MS) return;
    lastHapticAt.current = now;
    grainTick();
  }, []);

  // THE DETENTS. This already fires only when the rounded half-point changes,
  // which makes it the exactly-right place to hang the tick: the field feels
  // notched under the thumb, one knock per 0.5, never one per frame. Rigid
  // against the grain's selection tick, which is the whole hierarchy Bryan
  // asked for — "a different type of haptic for crossing those column dots".
  const commit = useCallback(
    (t: number) => {
      const stepped = Math.round(t * 20) / 2;
      if (stepped !== value) {
        lastHapticAt.current = Date.now();
        tick();
        onChange(stepped);
      }
    },
    [onChange, value]
  );
  const knock = useCallback(() => {
    lastHapticAt.current = Date.now();
    thud();
  }, []);

  /**
   * ▸ THE HANDLE FOLLOWS THE VALUE WHEN THE VALUE MOVES WITHOUT IT.
   *
   * Kept from the scrapped work because it is not part of it — it fixes a bug
   * the sheet's persistent mount introduced. `pos` is seeded once and then
   * owned by the gesture, which was fine while this control unmounted with the
   * sheet and came back rebuilt around the current number. It does not unmount
   * any more, so RESET — or reopening onto a different applied filter — left
   * the handle where the last scrub put it while the number beside it read
   * something else.
   *
   * Guarded on `lift`, so it can never fight a scrub in progress: during a drag
   * the value is changing BECAUSE of the handle, and following it would be a
   * feedback loop.
   */
  useEffect(() => {
    if (lift.value !== 0) return;
    pos.value = value / 10;
  }, [value, pos, lift]);

  const scrub = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      "worklet";
      lift.value = withSpring(1, KNOB_SPRING);
      pos.value = Math.min(1, Math.max(0, (e.x - KNOB_INSET) / travel));
      grainX.value = e.x;
      // Felt leaving the notch, and felt dropping back into it.
      runOnJS(knock)();
      runOnJS(commit)(pos.value);
    })
    .onUpdate((e) => {
      "worklet";
      pos.value = Math.min(1, Math.max(0, (e.x - KNOB_INSET) / travel));
      // THE GRAIN, gated by TRAVEL so its rate is the thumb's speed. Measured
      // against the finger rather than the clamped value, so the texture stops
      // honestly at the ends of the field instead of buzzing on while the
      // handle has nowhere left to go.
      const moved = e.x - grainX.value;
      if (moved > GRAIN_STEP || moved < -GRAIN_STEP) {
        grainX.value = e.x;
        runOnJS(grain)();
      }
      runOnJS(commit)(pos.value);
    })
    .onFinalize(() => {
      "worklet";
      // Settle, do not arrive — and never overshoot past the field.
      lift.value = withSpring(0, KNOB_SPRING);
      runOnJS(knock)();
    });

  const knobStyle = useAnimatedStyle(() => {
    const h = KNOB_H + (KNOB_H_LIFTED - KNOB_H) * lift.value;
    const w = KNOB_W + (KNOB_W_LIFTED - KNOB_W) * lift.value;
    return {
      width: w,
      height: h,
      borderRadius: w / 2,
      // At rest there is no handle at all — the field alone.
      opacity: value > 0 || lift.value > 0 ? 1 : 0,
      transform: [{ translateX: KNOB_INSET + pos.value * travel - w / 2 }],
    };
  });

  // TRANSFORMS AND OPACITY ONLY — the halo's SVG is born at full size and is
  // never re-laid out, which is the whole reason it is affordable. Translate
  // first, then scale: scale works about the box's own centre, so doing it in
  // this order keeps the halo centred on the knob at every size.
  const haloStyle = useAnimatedStyle(() => {
    const s = HALO_REST_SCALE + (1 - HALO_REST_SCALE) * lift.value;
    return {
      opacity: lift.value * HALO_MAX_OPACITY,
      transform: [
        { translateX: KNOB_INSET + pos.value * travel - HALO_W / 2 },
        { scaleX: s },
        { scaleY: s },
      ],
    };
  });

  return (
    <View style={styles.ratingRow}>
      <GestureDetector gesture={scrub}>
        <View style={{ width: padW, height: PAD_H, justifyContent: "center" }}>
          <View style={styles.ratingPad}>
            {Array.from({ length: DOT_COLS }, (_, i) => (
              <DotColumn key={i} index={i} pos={pos} lift={lift} />
            ))}
          </View>
          {/* SIBLINGS of the pad — see the header note. The halo is drawn
              first so the lens sits IN it rather than on it. */}
          <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]}>
            <Svg width={HALO_W} height={HALO_H}>
              <Defs>
                {/* Halved from the first pass. At 0.34 the halo read as a lamp
                    behind the knob rather than light bending through it, and a
                    bright glow is most of what made the whole thing look like a
                    toy. It should be felt before it is noticed. */}
                <RadialGradient id="knobHalo" cx="50%" cy="50%" rx="50%" ry="50%">
                  <Stop offset="0" stopColor={ACCENT} stopOpacity={0.18} />
                  <Stop offset="0.45" stopColor={ACCENT} stopOpacity={0.07} />
                  <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse
                cx={HALO_W / 2}
                cy={HALO_H / 2}
                rx={HALO_W / 2}
                ry={HALO_H / 2}
                fill="url(#knobHalo)"
              />
            </Svg>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.knob, knobStyle]}>
            {/* THE BODY. Alphas, not colours — the dots have to survive the
                trip through it, and that is the whole idea. */}
            <LinearGradient
              colors={[LENS_TOP, LENS_MID, LENS_FOOT]}
              locations={[0, 0.46, 1]}
              style={styles.lensFill}
            />
            {/* The crown light. Sized in PERCENTAGES so it grows with the lift
                for free — nothing here needs its own animation. */}
            <LinearGradient
              colors={[LENS_SPEC, "rgba(255,255,255,0)"]}
              style={styles.lensSpecular}
            />
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={styles.ratingValue}>
        <Text style={[styles.ratingNumber, value > 0 ? styles.textAccent : styles.textDim]}>
          {value.toFixed(1)}
        </Text>
        <Text style={styles.ratingOutOf}>/ 10</Text>
      </View>
    </View>
  );
}

/**
 * One column of four dots, LIT by the handle's proximity — the thing that makes
 * this control itself rather than a slider with decoration.
 *
 * Three stops, not two: the falloff has a bright core and a long dim tail, so
 * the handle carries a halo instead of a linear ramp that reads as a smear.
 * `lift` folds in because the field should only be alive while a thumb is on
 * it — at rest the pad is an even, quiet grid.
 */
function DotColumn({
  index,
  pos,
  lift,
}: {
  index: number;
  pos: SharedValue<number>;
  lift: SharedValue<number>;
}) {
  return (
    <View style={styles.dotCol}>
      {Array.from({ length: DOT_ROWS }, (_, r) => (
        <Dot key={r} col={index} row={r} pos={pos} lift={lift} />
      ))}
    </View>
  );
}

/**
 * ONE DOT. Animating whole COLUMNS was cheaper but wrong: four dots moving in
 * perfect lockstep read as a line sliding, not a field reacting — Bryan, "you
 * can literally see how they're just lines". Every dot now answers for itself,
 * which costs 76 animated nodes instead of 19 and buys the only thing that
 * makes this control feel like a material.
 *
 * Three responses, all scaled by `lift` so the grid is dead even at rest, and
 * all TRANSFORMS so none of it touches layout:
 *   · THE COLUMN BENDS — rows near the centre-line are shoved harder than the
 *     outer ones, so a column bows around the handle instead of translating
 *     rigidly. This is the whole fix for the "lines" read.
 *   · THE FIELD FANS — dots part vertically as well, away from the handle's
 *     centre-line, so it looks pushed through rather than slid along.
 *   · THE DOTS SWELL — a touch bigger under the thumb, which is what makes the
 *     halo read as light rather than a brightness ramp.
 *
 */
function Dot({
  col,
  row,
  pos,
  lift,
}: {
  col: number;
  row: number;
  pos: SharedValue<number>;
  lift: SharedValue<number>;
}) {
  const t = col / (DOT_COLS - 1);
  // −1 at the top row, +1 at the bottom.
  const rowT = (row - (DOT_ROWS - 1) / 2) / ((DOT_ROWS - 1) / 2);
  const style = useAnimatedStyle(() => {
    const signed = t - pos.value;
    const d = Math.abs(signed);
    const near = interpolate(d, [0, PUSH_REACH], [1, 0], "clamp") * lift.value;
    const glow = interpolate(d, [0, GLOW_REACH * 0.45, GLOW_REACH], [1, 0.46, 0], "clamp");
    const bend = 1 - BEND * Math.abs(rowT);
    const dx =
      Math.sign(signed) *
      interpolate(d, [0, PUSH_REACH * 0.4, PUSH_REACH], [PUSH_MAX, PUSH_MAX, 0], "clamp") *
      bend *
      lift.value;
    return {
      opacity: REST_ALPHA + (LIT_ALPHA - REST_ALPHA) * glow * lift.value,
      transform: [
        { translateX: dx },
        { translateY: rowT * FAN_MAX * near },
        { scale: 1 + SWELL * near },
      ],
    };
  });
  return <Animated.View style={[styles.ratingDot, style]} />;
}

/**
 * THE MORE-TO-COME FADE. A soft wash over the trailing edge of a scroller,
 * which is the only thing left telling you there is more once nothing is cut
 * off. It is an INDICATOR, not a decoration, so it retires itself: the wash
 * fades out as the last page arrives, and a scroller with nothing hidden never
 * shows one at all. Pointer-transparent, and drawn over the content it hints
 * at rather than inside the scroller, so it cannot scroll away with it.
 */
function EdgeFade({
  axis,
  offset,
  maxOffset,
}: {
  axis: "bottom" | "right";
  offset: SharedValue<number>;
  maxOffset: number;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: maxOffset <= 0 ? 0 : interpolate(offset.value, [maxOffset - FADE, maxOffset], [1, 0], "clamp"),
  }));
  const box = axis === "bottom" ? styles.fadeBottom : styles.fadeRight;
  return (
    <Animated.View pointerEvents="none" style={[box, style]}>
      <LinearGradient
        colors={["rgba(10,9,8,0)", "rgba(10,9,8,0.92)"]}
        start={axis === "bottom" ? { x: 0, y: 0 } : { x: 0, y: 0 }}
        end={axis === "bottom" ? { x: 0, y: 1 } : { x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/**
 * One cell, and its FLOAT-IN. A cell below the fold sits low, small and dark;
 * as the scroll carries it up past the viewport's bottom edge it rises into
 * place over FLOAT_SPAN points. Driven off the scroll offset itself rather than
 * a mount trigger, so it is reversible, tracks the finger, and cannot fire
 * twice for the same cell. Everything it animates is a TRANSFORM plus opacity —
 * this bar's law — so a row entering never dirties layout.
 */
function GenreCell({
  id,
  label,
  width,
  row,
  on,
  onPress,
  scrollY,
  visibleRows,
}: {
  id: number;
  label: string;
  width: number;
  row: number;
  on: boolean;
  onPress: (id: number) => void;
  scrollY: SharedValue<number>;
  /** Both numbers below are the WINDOW'S, not a constant — a short screen shows
   *  one row, and a cell that thought the window was two rows tall would either
   *  float in early or never float at all. */
  visibleRows: number;
}) {
  const mark = GENRE_MARKS[id];
  const top = row * (CELL_H + GAP);
  const viewportH = CELL_H * visibleRows + GAP * (visibleRows - 1);
  // A cell inside the resting window is ALWAYS shown, whatever the offset says.
  // Belt and braces after the frozen-handler bug: the float-in is an
  // enhancement for cells arriving from below, and it must never be the reason
  // something already on screen is invisible.
  const alwaysOn = row < visibleRows;
  const floatStyle = useAnimatedStyle(() => {
    if (alwaysOn) return { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };
    // Ascending input range, per Reanimated's contract: as the scroll grows,
    // the cell rises into place.
    const p = interpolate(
      scrollY.value,
      [top - viewportH, top - viewportH + FLOAT_SPAN],
      [0, 1],
      "clamp"
    );
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 18 }, { scale: 0.9 + 0.1 * p }],
    };
  });
  const ink = on ? ACCENT : MUTED;
  return (
    <Animated.View style={floatStyle}>
      <Pressable
        onPress={() => {
          tap();
          onPress(id);
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={label}
        style={[styles.box, styles.genreCell, { width }, on ? styles.boxOn : styles.boxOff]}
      >
        {mark ? (
          <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox={mark.viewBox}>
            {mark.paths.map((p, i) => (
              <Path
                key={i}
                d={p.d}
                fill={p.filled ? ink : "none"}
                stroke={p.filled ? undefined : ink}
                strokeWidth={p.strokeWidth}
                strokeLinecap={p.round ? "round" : undefined}
                strokeLinejoin={p.round ? "round" : undefined}
              />
            ))}
          </Svg>
        ) : null}
        <Text style={[styles.genreText, on ? styles.textAccent : styles.textMuted]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * THE COMMIT BAR — RESET and APPLY, and the rule for when they mean anything:
 * "VERBS SLEEP UNTIL SOMETHING CHANGES" (the board's own caption).
 *
 * ▸ EACH VERB ANSWERS ITS OWN QUESTION, and the first build did not — it woke
 *   both on `isDefault`, and that is a TRAP the moment the sheet remembers what
 *   the page is showing. Bryan found it: sort by AVG RATING, apply, reopen, tap
 *   RELEASE DATE to go back — and the draft is now identical to the defaults,
 *   so APPLY went to sleep over a change that was real and uncommitted. "It
 *   gives off the feeling that we can't go back. That's wrong." He is right,
 *   and the only way out was RESET, which is not what RESET is for.
 *     · APPLY  — is there anything to COMMIT? draft ≠ what the page is showing.
 *     · RESET  — is there anything to CLEAR?  draft ≠ defaults.
 *   The board is untouched by this. Its two frames are "untouched" and "picks
 *   made", where both questions happen to give the same answer; independent
 *   predicates only cover the states it never drew.
 *
 * ▸ ASLEEP IS INERT, not merely dim. A dim button that still fires teaches the
 *   finger that the dimming means nothing. Asleep, a verb does not respond and
 *   does not knock — there is no haptic for an act that did not happen.
 *
 * ▸ APPLY is the heaviest thing in the sheet, so it gets the heaviest knock the
 *   sheet has (see the hierarchy above). RESET is a tap like any other.
 */
export function CommitBar({
  canApply,
  canReset,
  onReset,
  onApply,
}: {
  canApply: boolean;
  canReset: boolean;
  onReset: () => void;
  onApply: () => void;
}) {
  const ink = canApply ? ACCENT : DIM;
  const line = canApply ? ACCENT_LINE : LINE_OFF;
  const resetInk = canReset ? ACCENT : DIM;
  const resetLine = canReset ? ACCENT_LINE : LINE_OFF;
  return (
    <View style={styles.commitRow}>
      <Pressable
        onPress={
          canReset
            ? () => {
                tap();
                onReset();
              }
            : undefined
        }
        disabled={!canReset}
        style={[styles.resetBox, { borderColor: resetLine }]}
        accessibilityRole="button"
        accessibilityLabel="Reset all filters"
        accessibilityState={{ disabled: !canReset }}
      >
        {/* An arrow going back round — drawn as an open circle so the head has
            somewhere to point. Straight off the board. */}
        <Svg width={15} height={15} viewBox="0 0 15 15">
          <Path
            d="M3.2 6 C4 3.8 6 2.6 8.2 3 C10.7 3.5 12.3 5.9 11.8 8.4 C11.3 10.9 8.9 12.5 6.4 12 C4.8 11.7 3.6 10.6 3.1 9.2"
            fill="none"
            stroke={resetInk}
            strokeWidth={1.3}
            strokeLinecap="round"
          />
          <Path
            d="M3 3.2 L3.2 6.1 L6.1 5.9"
            fill="none"
            stroke={resetInk}
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>

      <Pressable
        onPress={
          canApply
            ? () => {
                thud();
                onApply();
              }
            : undefined
        }
        disabled={!canApply}
        style={[styles.applyBox, { borderColor: line }]}
        accessibilityRole="button"
        accessibilityLabel="Apply filters"
        accessibilityState={{ disabled: !canApply }}
      >
        <Text style={[styles.applyLabel, { color: ink }]}>APPLY</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: MUTED,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    letterSpacing: 1.4,
    lineHeight: 12,
  },
  box: {
    height: BOX_H,
    borderRadius: BOX_R,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // Half of the run minus the gutter — the board's 167 on a 350 body.
  boxHalf: { flex: 1 },
  boxCycle: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14 },
  /** Selected, but selected the DEFAULT — ALL decades, RELEASE DATE. Forward of
   *  its neighbours, but not claiming to be a filter. */
  boxOn: { borderColor: LINE_ON },
  boxOff: { borderColor: LINE_OFF },
  /** Selected AND filtering. The board's `#9CCADF80`. */
  boxAccent: { borderColor: ACCENT_LINE },
  // The sort control lays its own zones out, so it takes the box's shell only —
  // no centring, and the 14pt inset belongs to each zone rather than the box, so
  // the rule can run edge to edge between them.
  // `overflow: hidden` is what the direction zone slides out THROUGH — without
  // it the negative margin would let it hang past the box's right edge instead
  // of being put away by it. Nothing overflowed here before, so it is inert on
  // the always-open (entity) path.
  sortBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    overflow: "hidden",
  },
  sortField: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: "100%",
    paddingHorizontal: 14,
  },
  /** Always its natural size — only its FOOTPRINT animates, via a negative right
   *  margin. `flexShrink: 0` so the field's flexGrow can never squeeze it and
   *  reflow the words while the margin is already moving them. */
  sortZone: { flexDirection: "row", alignItems: "center", height: "100%", flexShrink: 0 },
  // 24 of the box's 46 — a mark between two things, not a wall dividing them.
  sortRule: { width: 1, height: 24, backgroundColor: "#2A2521" },
  sortRuleOn: { backgroundColor: "#2A3B42" },
  sortDir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: "100%",
    paddingHorizontal: 14,
  },
  boxText: { fontFamily: "JetBrainsMono_500Medium", fontSize: 12, letterSpacing: 1.2 },
  textOn: { color: INK },
  textOff: { color: DIM },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: GUTTER },
  // The pad CLIPS — that is what rounds the field's ends, and why the knob
  // cannot live inside it.
  ratingPad: {
    height: PAD_H,
    borderRadius: 999,
    backgroundColor: "rgba(242, 237, 228, 0.024)",
    overflow: "hidden",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: KNOB_INSET,
    paddingVertical: 8,
  },
  dotCol: { justifyContent: "space-between" },
  // FULL INK, dimmed by the column's glow rather than baked dim. The first pass
  // painted these at 18% and then dimmed FROM there, so lit-vs-unlit was 18%
  // against 6% — a difference that does not read at 3pt. The brightness has to
  // live in the animation or there is no glow to see.
  ratingDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: INK },
  // No backgroundColor — the LinearGradient inside IS the body, and a solid
  // fill underneath it would be the lid this stopped being.
  knob: {
    position: "absolute",
    left: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: LENS_RIM,
  },
  lensFill: { ...StyleSheet.absoluteFillObject },
  // A THIN LINE down one wall, not a blob on the face — 1.5pt over more than
  // half the length. Percentages so the lift scales it with the body and
  // nothing in here needs an animation of its own.
  lensSpecular: {
    position: "absolute",
    left: 1.5,
    top: "12%",
    width: 1.5,
    height: "56%",
    borderRadius: 1,
  },
  // Fixed size forever; only ever transformed. See the note by HALO_W.
  halo: {
    position: "absolute",
    left: 0,
    width: HALO_W,
    height: HALO_H,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingValue: { width: VALUE_W, alignItems: "flex-end" },
  ratingNumber: {
    fontFamily: "BricolageGrotesque_800ExtraBold",
    fontSize: 28,
    letterSpacing: -0.84,
    lineHeight: 30,
  },
  ratingOutOf: {
    color: DIM,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 9,
    letterSpacing: 0.9,
    lineHeight: 12,
  },
  textDim: { color: DIM },
  fadeBottom: { position: "absolute", left: 0, right: 0, bottom: 0, height: FADE },
  fadeRight: { position: "absolute", top: 0, bottom: 0, right: 0, width: FADE },
  genreGrid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  genreCell: { height: CELL_H, gap: 8 },
  genreText: { fontFamily: "JetBrainsMono_400Regular", fontSize: 8, letterSpacing: 0.4 },
  textAccent: { color: ACCENT },
  textMuted: { color: MUTED },
  chipRow: { flexDirection: "row", gap: GAP },
  /** No width — `flexGrow` divides the run so any chip count spans it exactly. */
  chipCell: { flexGrow: 1, flexBasis: 0, height: BOX_H },
  /** The scroll variant: the WORD sets the width, padding gives it air. */
  chipCellHug: { height: BOX_H, paddingHorizontal: 18 },
  /** Label left, value right — the one control on the sheet that prints both, because
   *  collapsed it has to say what it IS as well as what it is set to. */
  catalogueField: {
    flexGrow: 1,
    flexBasis: 0,
    height: BOX_H,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
  },
  catalogueLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    letterSpacing: 1,
    color: MUTED,
  },
  decadeRow: { flexDirection: "row", gap: GAP },
  decadeStrip: { flexDirection: "row", gap: GAP },
  decadeCell: { height: BOX_H },
  decadeText: { fontFamily: "JetBrainsMono_500Medium", fontSize: 11, letterSpacing: 0.8 },
  /** VERTICAL, on Bryan's ruling after seeing both drawn side by side. I had
   *  argued for horizontal — a stack of three reads as the ⋮ overflow glyph,
   *  and position along a horizontal matches the reading direction of the label
   *  beside it — and he preferred the stack once it was on the board. Noted and
   *  built; the whole sheet uses one axis either way, which was the point. */
  dots: { flexDirection: "column", gap: 4 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotOn: { backgroundColor: INK },
  dotAccent: { backgroundColor: ACCENT },
  dotOff: { backgroundColor: DOT_OFF },
  // Straight off the board: 46 tall, 4pt corners, 12 between them, and RESET a
  // square while APPLY takes the rest of the run.
  commitRow: { flexDirection: "row", gap: 12 },
  resetBox: {
    width: 46,
    height: 46,
    flexShrink: 0,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  applyBox: {
    flex: 1,
    height: 46,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  applyLabel: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 12,
    // The board's 0.18em, resolved against its own 12px.
    letterSpacing: 2.16,
    lineHeight: 16,
  },
});
