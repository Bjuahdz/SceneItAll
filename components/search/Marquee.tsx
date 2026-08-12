import React, { useCallback, useRef } from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { Easing, FadeIn, LinearTransition } from "react-native-reanimated";

import EntryStar from "./EntryStar";
import { ChevronRight, ChevronUp } from "./glyphs";
import {
  FONT,
  GRAYSCALE,
  MARQUEE,
  SEARCH_LAYOUT,
  ROW,
  SCRIM,
  SIGNAL,
  TRACK,
  TRACK2,
  groundAlpha,
} from "@/constants/signal";
import type { SearchEntityType } from "@/services/db";

// The expanded item. One component for every board that opens something — the
// recents ledger, a submitted film, a submitted collection, a submitted person.
// Only the image, the scrim stops and the CTA verb change; the 350×219 r16 card
// and every overlay position are identical across all of them.
//
// When there is NO artwork this must not render. Design contract 7: never fabricate
// a poster, an avatar or an empty frame. NoArtworkPanel is the honest fallback.

/**
 * THE CARD SPANS THE CONTENT COLUMN — the same span a collapsed row occupies, so
 * the two share an edge and the list has one left margin and one right margin.
 *
 * Both call sites (DefaultState, SubmittedState) render inside search.tsx's
 * ScrollView, whose content container carries `paddingHorizontal: padH`; this is
 * that column, stated as a number because the touch-derived origin rect needs one
 * (see handlePress). Layout and rect therefore read the SAME value and cannot
 * disagree about how big the card is.
 *
 * See MARQUEE in constants/signal.ts for the board's 350 and why it is gone.
 */
const CARD_W = Dimensions.get("window").width - SEARCH_LAYOUT.padH * 2;

export type MarqueeTone = "default" | "submitted" | "person";

/**
 * The card's verb, per type — DESTINATION, NOT INSTRUCTION.
 *
 * The chevron beside it already says "go", and the whole card is the tap target, so
 * the label's only job is naming where the tap lands. "OPEN FILMOGRAPHY" spent 16
 * characters restating an action nothing was in doubt about, and once the verb moved
 * into the facts lane those characters came straight out of the known-for: Chris
 * Evans read "CAPTAIN AMERICA: CIVIL…", clipped mid-word (Bryan, 2026-08-01).
 * Naming the destination alone costs roughly half the width and keeps every
 * distinction — a person, a collection and a studio each still announce what they
 * are, which is the part worth having. A bare chevron everywhere would have been
 * the cheap version of this fix and says nothing at all.
 *
 * Defined ONCE. Both boards used to carry their own copy of this ladder, which is
 * how two lists start disagreeing about what the same row is called.
 */
export const ctaFor = (entityType: SearchEntityType): string => {
  switch (entityType) {
    case "person":
      return "FILMOGRAPHY";
    case "collection":
      return "COLLECTION";
    case "company":
      return "STUDIO";
    default:
      return "DETAILS";
  }
};

/**
 * The accordion's one clock.
 *
 * Every slot in an accordion list — the one swapping row↔card AND every row it
 * displaces — rides this same transition, which is what makes the open read as the
 * card pushing the list apart rather than several things moving near each other.
 * The mechanism (see the wrappers in DefaultState/SubmittedState): the slot is a
 * persistent clipped view whose FRAME animates between committed layouts on the UI
 * thread, so the full-size card is revealed top-down as the slot grows — an unroll
 * — while its content lays out exactly once. No per-frame Yoga, per the motion law.
 *
 * In-out cubic, never a spring — same family as the entity grow, and the nav's
 * "smooth, non-bouncy" rule. A fresh builder per view, because Reanimated layout
 * builders are configured by mutation and must not be shared.
 */
export const accordionMotion = () =>
  LinearTransition.duration(300).easing(Easing.inOut(Easing.cubic));

/** The card's on-screen rect in window coordinates, so an entity page can grow out of it. */
export type MarqueeRect = { x: number; y: number; width: number; height: number };

/**
 * Re-measures the card WHERE IT IS RIGHT NOW. Null when it cannot say (unmounted,
 * measured 0×0).
 *
 * This exists because a rect captured at tap time goes stale: around a tap the list
 * is often still settling — residual scroll, the keyboard-drop reflow, the accordion
 * promotion — and the card can sit ~200px from where it was measured by the time any
 * animation actually runs. The entity page calls this at the START of every
 * transition (grow, fold, back-swipe) instead of trusting the snapshot. The card
 * stays mounted underneath the overlay for the page's whole lifetime, so the ref
 * stays valid.
 */
export type MarqueeRemeasure = (cb: (rect: MarqueeRect | null) => void) => void;

interface Props {
  /** Full image URL. Callers that have none must render NoArtworkPanel instead. */
  imageUrl: string;
  index: number;
  /** FILM / COLLECTION / DIRECTOR — shown beside the index on submitted results. */
  typeTag?: string;
  title: string;
  /** `2017 · VILLENEUVE`, or `12 FILMS · 4 WITH ENTRIES`. */
  facts: string;
  /** This film is in the vault. The entry star leads the facts lane — the card was
   *  the ONE place the mark vanished when a starred row unrolled (Bryan,
   *  2026-08-12: "there is no star badge anymore"), and the star lives beside the
   *  year everywhere else, which on this card means the front of the facts. */
  hasEntry?: boolean;
  /** Aggregate take count on a person or collection: renders star + "9 TAKES". */
  takesLabel?: string;
  ctaLabel: string;
  tone?: MarqueeTone;
  /** A portrait cropped to landscape needs its focal point high — portraits have
   *  headroom, so 50% 16% lands the eyes in the upper third. */
  focusY?: number;
  onPressCollapse: () => void;
  /** Receives the card's on-screen rect, derived from the touch itself (exact by
   *  pointer-transparency — see the remeasure block), and a way to re-measure
   *  fresh at every animation start. */
  onPressCta: (rect: MarqueeRect, remeasure: MarqueeRemeasure) => void;
}

export default function Marquee({
  imageUrl,
  index,
  typeTag,
  title,
  facts,
  hasEntry,
  takesLabel,
  ctaLabel,
  tone = "default",
  focusY = 0.5,
  onPressCollapse,
  onPressCta,
}: Props) {
  const stops = SCRIM[tone];
  // Height is derived from the tone rather than taking its own prop, because
  // `tone === "person"` IS "this entity is a person" at every call site — a separate
  // flag would be one more thing that could fall out of sync with the scrim.
  const isPerson = tone === "person";
  const cardHeight = isPerson ? MARQUEE.heightPerson : MARQUEE.height;
  const cardRef = useRef<View>(null);

  /**
   * The card's rect COMES FROM THE TOUCH, made exact by pointer-transparency.
   *
   * `pageY − locationY` gives a view's top-left because `locationY` is the touch
   * relative to THE VIEW THAT WAS HIT. RailCard (MovieTabBar) relies on that with an
   * explicit condition: "the press target exactly covers the card, which is what
   * keeps locationX/locationY card-relative rather than relative to some inner
   * image."
   *
   * That condition is ENFORCED here rather than assumed: every non-interactive child
   * of the card is pointerEvents="none" (see the render tree), so the view that gets
   * hit is always the card Pressable itself — never the title plate, whose origin
   * sits ~286pt below the card's and produced exactly the intermittent "grows from
   * below the marquee" runs (frame analysis, video round 1: same scroll, different
   * fingertip, different outcome). The one interactive child, the collapse latch,
   * never reaches this handler at all — its own onPress claims the touch.
   */
  /**
   * The living measurement — see MarqueeRemeasure — WITH RETRIES.
   *
   * Zero-measurements are a transient (Fabric returns 0×0 around scrolls, sometimes
   * for several consecutive frames) and are RETRIED next frame — the page sits
   * invisible at p = 0 through the pre-flight, so waiting a few frames is free. If
   * they never succeed the answer is NULL, and the caller KEEPS the tap-time rect:
   * that rect is touch-derived and exact at the moment of the tap, so a fossil is
   * off by at most whatever the list moved AFTER the tap — tens of pixels around a
   * settling fling, nothing at rest. Flying from it is a near-miss at worst;
   * refusing to fly (a page that just appears) is the pop this whole pipeline
   * exists to prevent. An earlier draft promised "opens plainly" on null — written
   * when the tap rect could be child-poisoned by ~286pt, obsolete now that it
   * cannot be.
   */
  const remeasure = useCallback<MarqueeRemeasure>((cb) => {
    const attempt = (retriesLeft: number) => {
      const node = cardRef.current;
      if (!node) {
        cb(null);
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) cb({ x, y, width, height });
        else if (retriesLeft > 0) requestAnimationFrame(() => attempt(retriesLeft - 1));
        else cb(null);
      });
    };
    attempt(8);
  }, []);

  /**
   * The tap answers IMMEDIATELY and from the TOUCH, never from a measurement.
   *
   * With the children pointer-transparent, `pageX − locationX / pageY − locationY`
   * IS the card's on-glass origin — the touch system reports where pixels actually
   * are. `measureInWindow` cannot say better at this moment: on Fabric it reads the
   * committed ShadowTree, whose contentOffset lags the glass while a scroll
   * settles — so around exactly the taps that matter it can return a rect that is
   * nonzero, plausible and displaced by the undelivered scroll. The old code
   * preferred that over the exact touch rect. RailCard reached the same verdict
   * and dropped tap-time measureInWindow entirely.
   *
   * Measurement still exists — in `remeasure`, which the page calls during its
   * invisible pre-flight beat and before folds: by then the list is frozen and
   * committed, which is when the shadow tree is trustworthy again.
   */
  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      onPressCta(
        { x: pageX - locationX, y: pageY - locationY, width: CARD_W, height: cardHeight },
        remeasure
      );
    },
    [onPressCta, remeasure, cardHeight]
  );

  return (
    // The card ARRIVES rather than snapping in. The accordion swap mounts this a frame
    // or two before its artwork has decoded, and an instant swap put that gap on
    // stage — a card-sized flash, then the image. A 240ms fade over the dark base
    // below covers the decode entirely, and it is what makes the open read as motion
    // instead of a cut. Entering animations run on the UI thread (movie/[id].tsx has
    // used them since the ticket work), so nothing renders mid-fade.
    <Animated.View
      style={styles.wrap}
      entering={FadeIn.duration(240).easing(Easing.out(Easing.cubic))}
    >
      {/* THE WHOLE CARD IS THE TAP TARGET. Making a 350×380 image inert and routing
          the user through a 9px label in one corner was the wrong affordance — the
          artwork is plainly the thing you want to touch. The CTA row survives as a
          LABEL rather than a button, because it still tells you where the tap goes;
          it just is not the only way to get there any more.

          The collapse latch stays its own nested Pressable, and RN gives the child
          the touch responder, so tapping the chevron closes the card instead of
          navigating away from it.

          EVERY OTHER CHILD IS pointerEvents="none". Not a tidiness choice: the
          touch-derived origin fallback in handlePress needs locationX/locationY to
          be relative to THE CARD, and RN computes them relative to whichever view
          claims the touch. With the children transparent, that view is always the
          card itself — so the fallback rect is exact even when measureInWindow
          fails outright, which is the failure the fallback exists for. */}
      <Pressable
        ref={cardRef}
        style={[styles.card, isPerson && styles.cardPerson]}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${facts}. ${ctaLabel}`}
      >
        <Image
          source={{ uri: imageUrl }}
          style={styles.art}
          contentFit="cover"
          contentPosition={{ top: `${focusY * 100}%`, left: "50%" }}
          transition={180}
          pointerEvents="none"
        />

        {/* Every stop is the ground colour at a different alpha — that is what
            makes the artwork dissolve into the page instead of ending on a seam. */}
        <LinearGradient
          colors={stops.map((s) => groundAlpha(s.a)) as unknown as readonly [string, string, ...string[]]}
          locations={stops.map((s) => s.at) as unknown as readonly [number, number, ...number[]]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={styles.topRow} pointerEvents="none">
          <Text style={styles.index}>{String(index).padStart(2, "0")}</Text>
          {typeTag ? <Text style={styles.typeTag}>{typeTag}</Text> : null}
        </View>

        {/* Chevron-UP: closes the open item. Never an × — that means erase. */}
        <Pressable
          style={styles.latch}
          onPress={onPressCollapse}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Collapse ${title}`}
        >
          <ChevronUp />
        </Pressable>

        {/* Left-aligned and bottom-anchored — text on artwork is never centered.
            Centered is reserved for text sitting on bare ground.

            TWO LINES, NOT THREE: the title, then one lane carrying the facts on the
            left and the verb on the right. It was three stacked left-aligned lines
            (title / facts / verb), which crowded that corner and put the one element
            reading as "tap here" furthest from the thumb that would do it. Moving
            the verb to the corner alone just left a hole where it had been, because
            the plate still sat 44 up making room for a line that was no longer
            under it — so the plate came down to the bottom inset and the two share a
            lane (Bryan, 2026-08-01, in two passes).

            The lane is FLEXBOX, deliberately: facts flex and truncate, the verb
            never does, so nothing can be pushed off the card and no width has to be
            guessed against a label that changes per type. */}
        <View style={styles.plate} pointerEvents="none">
          <Text style={[styles.title, tone === "person" && styles.titlePerson]} numberOfLines={2}>
            {title.toUpperCase()}
          </Text>
          <View style={styles.lane}>
            {/* The facts group yields first. It is the only part of the card that
                can afford to: a truncated known-for still names a film, whereas a
                truncated verb names nothing. */}
            <View style={styles.factsRow}>
              {/* The vault mark leads the lane — star, then year, the rows' grammar. */}
              {hasEntry ? <EntryStar size={12} /> : null}
              {/* Hard-clamped to ONE line. The length budget upstream should keep it
                  inside, but a title nobody anticipated must truncate rather than
                  wrap and shove the lane taller. */}
              {facts ? (
                <Text style={styles.facts} numberOfLines={1}>
                  {facts}
                </Text>
              ) : null}
              {takesLabel ? (
                <>
                  <EntryStar size={12} />
                  <Text style={styles.takes}>{takesLabel}</Text>
                </>
              ) : null}
            </View>

            {/* A label, not a button — the card handles the press. Kept visible
                because it names the destination, and `importantForAccessibility="no"`
                so a screen reader does not announce the same action twice. (No
                pointerEvents of its own: the plate above is already inert, which is
                what keeps the touch card-relative.) */}
            <View style={styles.cta} importantForAccessibility="no">
              <Text style={styles.ctaLabel}>{ctaLabel}</Text>
              <ChevronRight />
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: MARQUEE.padTop, paddingBottom: MARQUEE.padBottom },
  card: {
    width: CARD_W,
    height: MARQUEE.height,
    borderRadius: MARQUEE.radius,
    overflow: "hidden",
    position: "relative",
    // THE DARK FLOOR. Neither the card nor the image had any background, so for the
    // frames between mount and the artwork's decode the box was WHITE — the scrim's
    // dark alpha stops painted over it produced exactly the light-to-grey ramp in
    // Bryan's screenshot. expo-image's `transition` cross-fade on iOS is a known
    // white-flash source on precisely this setup, and the fix is a dark base under
    // it. Invisible at rest: the cover-fit artwork occludes every pixel of it.
    backgroundColor: SIGNAL.surface,
  },
  // Only people. See MARQUEE.heightPerson — a portrait in a landscape box slices
  // the face; everything else opens into artwork that is already landscape.
  cardPerson: { height: MARQUEE.heightPerson },
  // `filter` is a real RN style prop from 0.76 onward (this project is on 0.81),
  // so the desaturation is native rather than a fake grey wash over the image.
  // The backgroundColor doubles the dark floor on the image view ITSELF, in case the
  // white is painted by the image machinery rather than showing through from behind.
  art: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SIGNAL.surface,
    filter: [{ grayscale: GRAYSCALE.backdrop }],
  },
  topRow: {
    position: "absolute",
    top: MARQUEE.insetTop,
    left: MARQUEE.inset,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  index: {
    color: "#D6CFC5",
    fontFamily: FONT.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK2.marqueeIndex,
  },
  typeTag: {
    color: "#A9A19A",
    fontFamily: FONT.monoMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: TRACK2.tag9,
  },
  latch: {
    position: "absolute",
    top: MARQUEE.insetTop,
    right: MARQUEE.inset,
  },
  plate: {
    position: "absolute",
    left: MARQUEE.inset,
    bottom: MARQUEE.plateBottom,
    right: MARQUEE.inset,
    gap: 5,
  },
  title: {
    color: ROW.titleOpen,
    fontFamily: FONT.display,
    fontSize: 25,
    lineHeight: 26,
    letterSpacing: TRACK2.marquee25,
  },
  titlePerson: { letterSpacing: TRACK2.marquee25Person },
  // The bottom lane: facts left, verb right, one baseline. `gap` guarantees they
  // can never touch even when the facts run to the truncation.
  lane: { flexDirection: "row", alignItems: "center", gap: 14 },
  // `flex: 1` — it takes the leftover width and gives it back under pressure, which
  // is what lets the verb keep its full label whatever the facts say. Still a row
  // in its own right, because the takes count travels with the facts.
  factsRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  facts: {
    flexShrink: 1, // let the takes count keep its space when the lane is long
    color: "#C4BDB3",
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: TRACK.micro10,
  },
  takes: {
    color: SIGNAL.accent,
    fontFamily: FONT.monoMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: TRACK.micro10,
  },
  // IN FLOW, at the right end of the lane — not absolutely positioned any more.
  // `flexShrink: 0` is the rule that matters: the verb is the one thing on this card
  // that must never be clipped or wrapped, so it takes its width first and the facts
  // live on what is left.
  cta: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  ctaLabel: {
    color: SIGNAL.ink,
    fontFamily: FONT.monoMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: TRACK2.tag9,
  },
});
