import React, { useEffect, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from "react-native-reanimated";

import { FONT, GRAYSCALE, ROW, SIGNAL, groundAlpha } from "@/constants/signal";
import type { EntityPage } from "@/services/entities";

// ─────────────────────────────────────────────────────────────────────────────
// The entity hero — REBUILT AS ONE CONTINUOUS PAGE (Bryan, 2026-08-09).
//
// The old architecture was two disconnected objects: a fixed hero OVERLAY running
// a 520px scrubbed morph, and a content sheet that had to physically travel that
// same distance to reach the bar's seat. Every mid-scroll rest exposed the seam —
// a collapsed bar hovering over a sheet that was somewhere else, with raw ground
// between them — and five rounds of settle machinery (zones, band rebasing, home
// jumps, knobs) were spent managing a gap that was GEOMETRIC, not behavioural.
//
// The rebuild dissolves the seam instead of managing it. Three pieces:
//
//   · EntityBackdrop — the artwork + open scrim, UNDER the ScrollView. Fades out
//     as you scroll, exactly as before. Nothing interactive, nothing measured.
//   · EntityIdentity — role, name, vitals, biography, counts, AS SCROLL CONTENT:
//     the first child of the ScrollView, seated in a fixed-height slot so the
//     open pose is pixel-identical to the old overlay's. It scrolls away with
//     the page like any other content. There is no travelling morph any more —
//     and therefore no mid-morph pose to ever rest in.
//   · EntityBar — the collapsed bar (same material: clipped portrait, blur,
//     tint, long fade) ABOVE the ScrollView, with a static centred title block.
//     It is a THRESHOLD, not a scrub: the moment the identity's bottom edge
//     passes under the bar's text seat, it fades in over ~180ms; scroll back
//     up and it fades out. Hysteresis keeps the line from flickering.
//
// The threshold is derived per page from the same constants that build the open
// pose, so it is automatically consistent for every entity — full biography,
// vitals only, or nothing at all — with zero per-page tuning. Sparse pages whose
// content never reaches the threshold simply never show the bar, which is
// correct: their identity never left the screen.
//
// ⚠ HISTORY, so nobody re-learns it: the hero was ONCE a flex child of this very
// ScrollView and oscillated — but that version ANIMATED ITS HEIGHT, so the
// contentSize fought the scroll position. The identity slot below is a FIXED
// height that never resizes; there is nothing for the scroll to fight.
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_HEIGHT: Record<EntityPage["kind"], number> = {
  person: 680, // a full-bleed vertical portrait
  collection: 348, // a landscape backdrop
  company: 462, // a poster wall
};

/**
 * How tall the bar's MATERIAL is — image clip, blur and gradient. Bryan tuned this
 * to 450 with BAR_FADE 300, which is what produces the long dissolve. A FIXED box:
 * it fades in over the content rather than growing into place.
 */
export const COLLAPSED_HEIGHT = 450;

/**
 * How far the backdrop's dissolve runs. Inherited from the old collapse distance
 * (open height − the old sheet settle line) so the artwork fades at exactly the
 * rate Bryan already approved on device — only the machinery changed, not the look.
 */
const SETTLE_HEIGHT = 160;
const backdropFadeDistance = (kind: EntityPage["kind"]) =>
  OPEN_HEIGHT[kind] - SETTLE_HEIGHT;

/** The identity stack's flex gap. */
const IDENTITY_GAP = 9;

/** How far the identity stack's bottom edge sits above the artwork's bottom. */
const OPEN_ANCHOR = 22;

// Where the reading overlay's text starts — clears the status bar and the back
// chevron (which lives at top 58, 36 tall).
const READING_TOP = 104;

/** The hero's open height — the identity slot's height, and what the seed-focus
 *  math in EntityScreen positions against. */
export const heroOpenHeight = (kind: EntityPage["kind"]) => OPEN_HEIGHT[kind];

/** Where the BAR's title block bottoms out, from the top of the screen. The same
 *  seat the old morph delivered the identity to. */
const BAR_TEXT_BOTTOM = 142; // COLLAPSED_HEIGHT − BAR_FADE − 8, kept as the tuned number

/**
 * ▸ THE THRESHOLD — the one number the whole collapse now runs on.
 *
 * The bar appears when the identity's bottom edge (a STATIC fact of the layout:
 * the slot puts it at openHeight − OPEN_ANCHOR in content coordinates) scrolls up
 * past the bar's own text seat. "The bottom of the biography is where the header
 * collapses" — Bryan's rule, verbatim, and it derives per kind with no tuning:
 * person 516 · company 298 · collection 184.
 */
export const barThreshold = (kind: EntityPage["kind"]) =>
  OPEN_HEIGHT[kind] - OPEN_ANCHOR - BAR_TEXT_BOTTOM;

// (No hysteresis constant any more — the bar is a SCRUBBED band now, not a
// latch, so there is no line to flicker across. See EntityBar.)

const OPEN_SCRIM: Record<EntityPage["kind"], { a: number; at: number }[]> = {
  person: [
    { a: 0.58, at: 0 },
    { a: 0.1, at: 0.15 },
    { a: 0.22, at: 0.38 },
    { a: 0.74, at: 0.56 },
    { a: 0.93, at: 0.76 },
    { a: 1, at: 1 },
  ],
  collection: [
    { a: 0.74, at: 0 },
    { a: 0.2, at: 0.28 },
    { a: 0.38, at: 0.56 },
    { a: 0.86, at: 0.84 },
    { a: 1, at: 1 },
  ],
  company: [
    { a: 0.8, at: 0 },
    { a: 0.6, at: 0.22 },
    { a: 0.74, at: 0.52 },
    { a: 0.94, at: 0.76 },
    { a: 1, at: 1 },
  ],
};

// ── The collapsed bar's material ─────────────────────────────────────────────
//
// The tint never reaches opaque, and MUST not. An opaque band is what stopped the
// blurred film rows from showing through, and burying the bottom edge under solid
// colour is what produced a visible rim. The mask handles the edge; the tint only
// darkens enough to keep the name legible.
const COLLAPSED_SCRIM = [
  { a: 0.45, at: 0.2 },
  { a: 0.65, at: 0.3 },
  { a: 0.85, at: 0.5 },
  { a: 0.9, at: 0.7 },
  { a: 0.98, at: 0.9 },
  { a: 0.99, at: 1.0 },
];

// How far the bar's material dissolves at its bottom edge. A FIXED pixel band
// rather than a percentage, so the softness is identical at any container height.
const BAR_FADE = 450;

// Portrait opacity inside the collapsed bar. Below 1 on purpose: a BlurView
// samples whatever is behind it, so a semi-transparent portrait lets the blur pick
// up BOTH the face and the film rows scrolling underneath — glass over the page,
// not a lid on top of it.
const BAR_ART_OPACITY = 0.8;

/**
 * Names are set to FIT, not to a fixed size. 28px is right for CHRIS EVANS and
 * wrong for SCARLETT JOHANSSON. Tracking scales with the size so the -0.035em
 * relationship holds. One function feeds the open block, the bar and the
 * no-artwork header, so the three can never disagree.
 */
export const nameType = (name: string) => {
  const n = name.length;
  const size = n <= 15 ? 28 : n <= 21 ? 24 : 21;
  return { fontSize: size, lineHeight: Math.round(size * 1.07), letterSpacing: -0.035 * size };
};

/**
 * How far the OPEN layer's bottom edge dissolves. Derived from the second-to-last
 * scrim stop, past which every kind's ramp is already ≥0.86 opaque — the mask only
 * ever eats artwork that was invisible under the scrim anyway.
 */
const openFadeBand = (kind: EntityPage["kind"]) => {
  const stops = OPEN_SCRIM[kind];
  return Math.round(OPEN_HEIGHT[kind] * (1 - stops[stops.length - 2].at));
};

/**
 * The open hero's scrim and focal point, exposed so the launch overlay can land on
 * the EXACT same ramp and crop — the overlay and the real hero must be the same
 * picture, pixel for pixel, at the moment the route swaps.
 */
export const HERO_FOCUS_Y = 0.16;
export const heroContentPosition = (kind: EntityPage["kind"]) =>
  kind === "person" ? ({ top: `${HERO_FOCUS_Y * 100}%`, left: "50%" } as const) : ("center" as const);

/**
 * The bottom-fade mask, ALWAYS mounted. Swapping a plain View for a MaskedView at
 * settle was the black flash on every open — the mask mounts once and never swaps.
 * (The documented iOS hazard is the BlurView, which still gates on `settled`.)
 */
function FadeMask({ fade, children }: { fade: number; children: React.ReactNode }) {
  return (
    <MaskedView
      style={StyleSheet.absoluteFill}
      maskElement={
        <View style={StyleSheet.absoluteFill}>
          <View style={styles.maskSolid} />
          <LinearGradient colors={["#000", "transparent"]} style={{ height: fade }} />
        </View>
      }
    >
      {children}
    </MaskedView>
  );
}

const grad = (stops: { a: number; at: number }[]) => ({
  colors: stops.map((s) => groundAlpha(s.a)) as unknown as readonly [string, string, ...string[]],
  locations: stops.map((s) => s.at) as unknown as readonly [number, number, ...number[]],
});

/**
 * One partition of the filmography, as it appears BOTH as a count under the name
 * and as a section in the sheet. One list drives both.
 */
export interface EntitySection {
  key: string;
  label: string;
  count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ▸ THE BACKDROP — artwork + open scrim, rendered UNDER the ScrollView.
// ─────────────────────────────────────────────────────────────────────────────
export function EntityBackdrop({
  entity,
  scrollY,
  screenWidth,
  onArtDisplayed,
}: {
  entity: EntityPage;
  scrollY: SharedValue<number>;
  screenWidth: number;
  /** expo-image's onDisplay — the page's paint signal; the grow's clock gates on
   *  it because onLayout proves layout, not pixels. */
  onArtDisplayed?: () => void;
}) {
  const openH = OPEN_HEIGHT[entity.kind];
  const fadeDist = backdropFadeDistance(entity.kind);
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.max(0, scrollY.value / fadeDist)),
  }));
  return (
    <Animated.View
      style={[styles.backdrop, { width: screenWidth, height: openH }, fadeStyle]}
      pointerEvents="none"
    >
      <FadeMask fade={openFadeBand(entity.kind)}>
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w780${entity.imagePath}` }}
          style={[styles.art, { width: screenWidth, height: openH }]}
          contentFit="cover"
          contentPosition={heroContentPosition(entity.kind)}
          transition={200}
          onDisplay={onArtDisplayed}
        />
        <LinearGradient {...grad(OPEN_SCRIM[entity.kind])} style={StyleSheet.absoluteFill} />
      </FadeMask>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ▸ THE IDENTITY — role, name, vitals, biography, counts, AS CONTENT.
//
// Lives inside the ScrollView as its first child. The slot is exactly the
// artwork's height with the stack seated OPEN_ANCHOR off its bottom, so at
// scroll 0 the page is pixel-identical to the old overlay's open pose — and
// then it simply scrolls away with everything else.
// ─────────────────────────────────────────────────────────────────────────────
export function EntityIdentity({
  entity,
  sections,
  entryCount,
  scrollY,
  bioOpen,
  onBioOpenChange,
  loading = false,
}: {
  entity: EntityPage;
  sections: EntitySection[];
  entryCount: number;
  /** For the HANDOFF fade only — the block still scrolls as plain content. */
  scrollY: SharedValue<number>;
  bioOpen: boolean;
  onBioOpenChange: (open: boolean) => void;
  loading?: boolean;
}) {
  // One shared pulse for every skeleton bar — per-bar animators shimmer out of
  // phase and read as noise.
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    if (!loading) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [loading, pulse]);
  const breathe = useAnimatedStyle(() => ({ opacity: pulse.value }));

  /**
   * ▸ THE HANDOFF — the identity DISSOLVES across the bar's crossing band.
   *
   * Without this, the crossing was a double exposure (Bryan's Anya frame,
   * 2026-08-09): the left-aligned identity was still on screen while the bar's
   * centred copy faded in over it — two names, both legible, ghosted across the
   * rows. Same band as the bar's scrub, same finger, opposite direction: as its
   * bottom edge passes the bar seat this fades out, the bar fades in, and at no
   * point are both copies readable at once.
   */
  const threshold = barThreshold(entity.kind);
  const handoffStyle = useAnimatedStyle(() => ({
    opacity:
      1 - Math.min(1, Math.max(0, (scrollY.value - threshold) / BAR_TEXT_BOTTOM)),
  }));

  return (
    // No horizontal padding of its own — the ScrollView's content container
    // already carries the page gutters, and the old overlay's 20 inset lands in
    // exactly the same place through them. Doubling it indented the whole block.
    <View
      style={[styles.identitySlot, { height: OPEN_HEIGHT[entity.kind] }]}
      pointerEvents="box-none"
    >
    <Animated.View style={[styles.identityStack, handoffStyle]} pointerEvents="box-none">
      {/* THE LATE ARRIVAL, HANDLED — still by skeleton slots at the exact
          geometry of what is coming, so the name does not teleport when the
          fetch lands: text replaces bars in place. A page that turns out to
          have NO extras simply lets the block shrink, and LinearTransition
          glides the name down — content reflow, no farewell bookkeeping. */}
      {loading ? (
        <Animated.View style={[styles.slotRole, breathe]}>
          <View style={[styles.bone, { width: 64 }]} />
        </Animated.View>
      ) : entity.role ? (
        <Animated.Text entering={FadeIn.duration(240)} style={styles.role}>
          {entity.role}
        </Animated.Text>
      ) : null}
      <Animated.View layout={LinearTransition.duration(240)}>
        <Text style={[styles.name, nameType(entity.name)]} numberOfLines={2}>
          {entity.name.toUpperCase()}
        </Text>
      </Animated.View>

      {loading && (
        <Animated.View style={[styles.extras, breathe]}>
          <View style={styles.vitals}>
            <View style={styles.vitalLeft}>
              <View style={styles.slotLabel}>
                <View style={[styles.bone, { width: 76 }]} />
              </View>
              <View style={styles.slotValue}>
                <View style={[styles.bone, styles.boneValue, { width: 118 }]} />
              </View>
            </View>
            <View style={[styles.vitalRight, styles.alignEnd]}>
              <View style={styles.slotLabel}>
                <View style={[styles.bone, { width: 62 }]} />
              </View>
              <View style={styles.slotValue}>
                <View style={[styles.bone, styles.boneValue, { width: 96 }]} />
              </View>
            </View>
          </View>
          <View style={styles.bioBlock}>
            <View style={styles.slotLabel}>
              <View style={[styles.bone, { width: 70 }]} />
            </View>
            <View>
              <View style={styles.slotProse}>
                <View style={[styles.bone, styles.boneValue, { width: "94%" }]} />
              </View>
              <View style={styles.slotProse}>
                <View style={[styles.bone, styles.boneValue, { width: "88%" }]} />
              </View>
              <View style={styles.slotProse}>
                <View style={[styles.bone, styles.boneValue, { width: "56%" }]} />
              </View>
            </View>
            <View style={styles.slotLabel}>
              <View style={[styles.bone, { width: 78 }]} />
            </View>
          </View>
        </Animated.View>
      )}
      {!loading && (entity.vitals.length > 0 || Boolean(entity.overview)) && (
        <Animated.View entering={FadeIn.duration(240)} style={styles.extras} pointerEvents="box-none">
          {entity.vitals.length > 0 && (
            <View style={styles.vitals}>
              {entity.vitals.map((v, i) => {
                const right = i === entity.vitals.length - 1 && entity.vitals.length > 1;
                return (
                  <View key={v.label} style={right ? styles.vitalRight : styles.vitalLeft}>
                    <Text style={[styles.vitalLabel, right && styles.alignRight]}>{v.label}</Text>
                    <Text style={[styles.vitalValue, right && styles.alignRight]}>{v.value}</Text>
                  </View>
                );
              })}
            </View>
          )}
          {entity.overview && (
            <View style={styles.bioBlock} pointerEvents="box-none">
              <Text style={styles.bioLabel}>
                {entity.kind === "person" ? "BIOGRAPHY" : "OVERVIEW"}
              </Text>
              {/* Three lines always — the full text lives in the reader. */}
              <Text style={styles.bio} numberOfLines={3}>
                {entity.overview}
              </Text>
              {/* Real content now, not an overlay control — always tappable while
                  visible, and it scrolls away with the page like everything else,
                  so the old "inert past 25% collapse" gate has nothing to guard. */}
              <Pressable
                onPress={() => onBioOpenChange(!bioOpen)}
                hitSlop={{ top: 12, bottom: 16, left: 16, right: 16 }}
                style={styles.readMoreHit}
                accessibilityRole="button"
                accessibilityLabel={bioOpen ? "Show less biography" : "Read the full biography"}
              >
                <Text style={styles.readMore}>{bioOpen ? "READ LESS" : "READ MORE"}</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      )}

      {/* THE PARTITION ROW — inert on purpose; nothing here is a control, so
          nothing wears the accent. Numbers in ink, units in muted. */}
      {loading ? (
        <Animated.View style={[styles.countsRow, breathe]}>
          <View style={[styles.bone, { width: 148 }]} />
        </Animated.View>
      ) : (
        <View style={styles.countsRow} pointerEvents="none">
          {sections.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && <Text style={styles.countsDot}>·</Text>}
              <Text style={styles.countsText}>
                {s.count} <Text style={styles.countsLabel}>{s.label}</Text>
              </Text>
            </React.Fragment>
          ))}
          {entryCount > 0 && (
            <>
              <Text style={styles.countsDot}>·</Text>
              <Text style={styles.countsText}>
                {entryCount}{" "}
                <Text style={styles.countsLabel}>{entryCount === 1 ? "ENTRY" : "ENTRIES"}</Text>
              </Text>
            </>
          )}
        </View>
      )}
    </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ▸ THE BAR — the collapsed header, ABOVE the ScrollView, threshold-triggered.
// ─────────────────────────────────────────────────────────────────────────────
export function EntityBar({
  entity,
  sections,
  entryCount,
  scrollY,
  screenWidth,
  pageInset,
  settled = true,
}: {
  entity: EntityPage;
  sections: EntitySection[];
  entryCount: number;
  scrollY: SharedValue<number>;
  screenWidth: number;
  pageInset: number;
  settled?: boolean;
}) {
  // The bar's full-size portrait mounts only after the first settle — one fewer
  // full-screen Image on the cold mount. Latched true forever after.
  const [barReady, setBarReady] = useState(settled);
  useEffect(() => {
    if (settled) setBarReady(true);
  }, [settled]);

  const threshold = barThreshold(entity.kind);
  /**
   * ▸ A SCRUBBED BAND, NOT A SWITCH (Bryan, 2026-08-09: the plain threshold fade
   * "lost the movement" — it let the identity scroll clean out of view and then
   * popped the bar in after the fact).
   *
   * The bar now materialises ACROSS the crossing, finger-attached and fully
   * reversible: progress runs from the moment the identity's bottom edge passes
   * the bar's text seat (the threshold) to the moment it leaves the screen —
   * which is why the band's length IS the seat height, BAR_TEXT_BOTTOM, not a
   * new knob. The material fades in while the title rises the last stretch into
   * its seat, so the bar visibly takes over FROM the departing identity instead
   * of appearing after it has gone. Below the threshold nothing happens at all —
   * the current logic's rule ("it changes only when the user goes past it")
   * survives untouched; only the crossing itself gained its motion back.
   */
  const barProgressStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (scrollY.value - threshold) / BAR_TEXT_BOTTOM)),
  }));
  const barTitleStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (scrollY.value - threshold) / BAR_TEXT_BOTTOM));
    return {
      // ▸ LEGIBILITY WAITS FOR THE MATERIAL. The title's own ramp starts at 35%
      // of the crossing and stacks on the root's fade, so by the time the name
      // is readable the blur and tint behind it have already dimmed the rows —
      // never text sitting naked on text (the Anya double-exposure frame).
      opacity: Math.min(1, Math.max(0, (p - 0.35) / 0.65)),
      // ▸ AND IT TRAVELS — a full text-block height (role + name + counts ≈ 64)
      // rising into the seat on the same axis the identity is leaving on, in
      // step with the finger. This is the fluid hand-off: old block dissolving
      // upward as scroll content, new block climbing into the bar.
      transform: [{ translateY: (1 - p) * 64 }],
    };
  });

  return (
    <Animated.View
      style={[styles.bar, { width: screenWidth, height: COLLAPSED_HEIGHT }, barProgressStyle]}
      pointerEvents="none"
    >
      <FadeMask fade={BAR_FADE}>
        {barReady && (
          <Image
            source={{ uri: `https://image.tmdb.org/t/p/w780${entity.imagePath}` }}
            style={[
              styles.art,
              { width: screenWidth, height: OPEN_HEIGHT[entity.kind], opacity: BAR_ART_OPACITY },
            ]}
            contentFit="cover"
            contentPosition={heroContentPosition(entity.kind)}
          />
        )}
        {settled && (
          <BlurView
            intensity={90}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        )}
        <LinearGradient {...grad(COLLAPSED_SCRIM)} style={StyleSheet.absoluteFill} />
      </FadeMask>
      {/* The title block — same seat the old morph delivered the identity to
          (bottom edge at BAR_TEXT_BOTTOM), arriving on the scrubbed rise. */}
      <Animated.View
        style={[styles.barTitle, { paddingHorizontal: pageInset }, barTitleStyle]}
        pointerEvents="none"
      >
        {entity.role ? <Text style={styles.role}>{entity.role}</Text> : null}
        <Text
          style={[styles.name, styles.centered, nameType(entity.name)]}
          numberOfLines={2}
        >
          {entity.name.toUpperCase()}
        </Text>
        <View style={[styles.countsRow, styles.countsCentered]}>
          {sections.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && <Text style={styles.countsDot}>·</Text>}
              <Text style={styles.countsText}>
                {s.count} <Text style={styles.countsLabel}>{s.label}</Text>
              </Text>
            </React.Fragment>
          ))}
          {entryCount > 0 && (
            <>
              <Text style={styles.countsDot}>·</Text>
              <Text style={styles.countsText}>
                {entryCount}{" "}
                <Text style={styles.countsLabel}>{entryCount === 1 ? "ENTRY" : "ENTRIES"}</Text>
              </Text>
            </>
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ▸ THE READER — the full biography, a screen-level overlay. Unchanged.
// ─────────────────────────────────────────────────────────────────────────────
export function BioReader({
  entity,
  pageInset,
  bioOpen,
  onBioOpenChange,
  settled = true,
}: {
  entity: EntityPage;
  pageInset: number;
  bioOpen: boolean;
  onBioOpenChange: (open: boolean) => void;
  settled?: boolean;
}) {
  const reading = useSharedValue(0);
  useEffect(() => {
    reading.value = withTiming(bioOpen ? 1 : 0, { duration: 260 });
  }, [bioOpen, reading]);
  const readingStyle = useAnimatedStyle(() => ({ opacity: reading.value }));

  // "Keep scrolling past what's available" closes the reader — overscroll beyond
  // the bottom by this much is unambiguous intent.
  const CLOSE_OVERSCROLL = 80;
  const onReadingScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const maxY = contentSize.height - layoutMeasurement.height;
    if (contentOffset.y > maxY + CLOSE_OVERSCROLL) onBioOpenChange(false);
  };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, readingStyle]}
      pointerEvents={bioOpen ? "auto" : "none"}
    >
      {settled && (
        <BlurView
          intensity={42}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[StyleSheet.absoluteFill, styles.readingWash]} />
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={styles.readingContent}
        onScroll={onReadingScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {/* Tapping ANYWHERE closes it — the Pressable and the content container
            both grow, so the target is the whole overlay. Dragging still scrolls:
            a Pressable cancels its press once the ScrollView claims the touch. */}
        <Pressable
          style={[styles.readingBody, { paddingHorizontal: pageInset }]}
          onPress={() => onBioOpenChange(false)}
          accessibilityRole="button"
          accessibilityLabel="Close the biography"
        >
          <Text style={styles.role}>{entity.role}</Text>
          <Text style={[styles.readingName, nameType(entity.name)]}>
            {entity.name.toUpperCase()}
          </Text>
          <Text style={styles.readingLabel}>
            {entity.kind === "person" ? "BIOGRAPHY" : "OVERVIEW"}
          </Text>
          <Text style={styles.bio}>{entity.overview}</Text>
          <Text style={styles.readingClose}>READ LESS</Text>
        </Pressable>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Pinned under the ScrollView — a sibling rendered BEFORE it, so tree order
  // does the stacking. Nothing interactive in it, ever.
  backdrop: { position: "absolute", top: 0, left: 0, overflow: "hidden" },
  // Pinned over the ScrollView — rendered AFTER it.
  bar: { position: "absolute", top: 0, left: 0, overflow: "hidden" },
  // The dark floor under the artwork — the frames between mount and decode show
  // this instead of the image machinery's white. Third appearance of the
  // filter-needs-dark-pixels rule.
  art: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: SIGNAL.surface,
    filter: [{ grayscale: GRAYSCALE.personHero }],
  },
  /** The content slot: exactly the artwork's height, stack seated at its foot.
   *  FIXED height — it must never resize, see the oscillation note up top. */
  identitySlot: {
    justifyContent: "flex-end",
    paddingBottom: OPEN_ANCHOR,
  },
  /** The stack itself, inside the slot — carries the gap AND the handoff fade.
   *  Separate from the slot so fading it never touches the slot's fixed box. */
  identityStack: { gap: IDENTITY_GAP },
  /** The bar's title block: bottom edge at BAR_TEXT_BOTTOM, centred. */
  barTitle: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: BAR_TEXT_BOTTOM,
    justifyContent: "flex-end",
    alignItems: "center",
    gap: IDENTITY_GAP,
  },
  centered: { textAlign: "center" },
  countsCentered: { justifyContent: "center" },
  extras: { gap: IDENTITY_GAP },
  maskSolid: { flex: 1, backgroundColor: "#000" },
  // ── Skeleton slots — each the exact height of the text it stands in for. ──
  bone: { height: 8, borderRadius: 2, backgroundColor: SIGNAL.surface2 },
  boneValue: { height: 10 },
  slotRole: { height: 12, justifyContent: "center" },
  slotLabel: { height: 12, justifyContent: "center" },
  slotValue: { height: 14, justifyContent: "center" },
  slotProse: { height: 18, justifyContent: "center" },
  alignEnd: { alignItems: "flex-end" },
  readingWash: { backgroundColor: "rgba(10,9,8,0.72)" },
  readingContent: { flexGrow: 1 },
  readingBody: { flexGrow: 1, paddingTop: READING_TOP, paddingBottom: 160 },
  readingName: { color: SIGNAL.ink, fontFamily: FONT.display, marginTop: 9 },
  readingLabel: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.4,
    marginTop: 22,
    marginBottom: 8,
  },
  readingClose: {
    color: SIGNAL.accent,
    fontFamily: FONT.monoMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.8,
    marginTop: 24,
  },
  role: {
    color: SIGNAL.accent,
    fontFamily: FONT.monoMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.8, // 0.18em at 10px
  },
  name: { color: SIGNAL.ink, fontFamily: FONT.display },
  vitals: { flexDirection: "row", gap: 16, paddingTop: 7 },
  vitalLeft: { flex: 1, gap: 5 },
  vitalRight: { width: 132, flexShrink: 0, gap: 5 },
  alignRight: { textAlign: "right" },
  vitalLabel: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.4,
  },
  vitalValue: {
    color: SIGNAL.stock,
    fontFamily: FONT.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.66,
  },
  bioBlock: { gap: 6, paddingTop: 7 },
  bioLabel: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.4,
  },
  bio: { color: "#B5AEA4", fontSize: 12.5, lineHeight: 18 },
  readMoreHit: { alignSelf: "flex-start" },
  readMore: {
    color: SIGNAL.accent,
    fontFamily: FONT.monoMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.8, // 0.18em at 10px
  },
  countsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: 7,
    minHeight: 12,
  },
  countsText: {
    color: SIGNAL.ink,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.4,
  },
  countsLabel: { color: SIGNAL.muted },
  countsDot: { color: ROW.indexDim, fontFamily: FONT.mono, fontSize: 10, lineHeight: 12 },
});
