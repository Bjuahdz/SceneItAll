/**
 * FloatingVerbs — the movie floor's LEFT island: Trailer · Slate.
 *
 *   AT REST     ( ▶ TRAILER │ 🔖 SLATE )   ( ◉ )   ← CaptureWell
 *   SLATED      ( ▶ TRAILER │ 🔖 SLATED )  ( ◉ )
 *   TAKE LIVE                            ( ══ trough ══ )
 *
 * TWO OBJECTS, NOT ONE — the nav's grammar. A pill of things you can do beside a single
 * round thing, and the gap between them is the point. Here the round thing is the mic
 * rather than search, which is why it holds the same seat on the right: crossing from a tab
 * into a movie never moves it.
 *
 * THE LABELS ARE ALWAYS UP. The tab bar can hide a word behind a tap because a tab is a
 * PLACE — you already know where you are, and the label is confirmation. These two are
 * VERBS on a screen you just arrived at, and an unlabelled glyph is a guess. We tried it
 * icon-only and it was unreadable.
 *
 * So the micro-animation had to live on the glyphs, and BOTH use the same one — the fill
 * the Slates tab already had, imported rather than re-drawn (FillGlyph):
 *   · The bookmark fills while a film is slated. State.
 *   · The play mark fills while we are acting on a tap, and drains when the player is up.
 *     A filled play is the universal "this is running".
 *
 * BOTH ARE HOLLOW AT REST, and that is the point of them being hollow. It leaves the mic
 * across the gap as the only coloured thing on the floor, so the one verb this whole app
 * exists for is the one your eye goes to. Colour here is earned by state, never by default.
 *
 * HOW IT GETS OUT OF THE WAY. When a take goes live the island reaches zero WIDTH and gives
 * its margin back at the same time, so the mic island can grow left into exactly the space
 * it vacated. Nothing slides under anything and there is no z-order to get wrong.
 *
 * RENDERING RULES (device-learned):
 *   · `overflow: hidden` IS safe here — the only transformed children are the glyphs' fill
 *     windows, which are themselves clips and stay well inside the glass. The rule it would
 *     break (this stack will not reliably clip a TRANSFORMED child) is why the capture pill
 *     cannot clip at all and has to eat its waveform bar by bar instead.
 *   · TouchableOpacity carries LAYOUT ONLY, with every visual on an inner View. A `style`
 *     function on a touchable silently drops flexDirection and flex in this stack.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';

import { NAV_SPRING } from '@/contexts/NavMorphContext';
import {
  NAV_BAR_H,
  NAV_BLUR_INTENSITY,
  NAV_GLASS_RIM,
  NAV_GLASS_TINT,
  NAV_ISLAND_GAP,
  NAV_SIDE_INSET,
} from '@/constants/navMetrics';
import FillGlyph from '@/components/glyphs/FillGlyph';
import { TICKET_ACCENT, ink } from './ticketTheme';

const RUN_W = Dimensions.get('window').width - NAV_SIDE_INSET * 2;
const ISLAND_H = NAV_BAR_H;
const ISLAND_R = ISLAND_H / 2;
// Whatever the mic island and the gap leave. Derived, so the two can never fail to add up
// to the run — which is what keeps the pair from drifting as they trade width.
const ISLAND_W = RUN_W - ISLAND_H - NAV_ISLAND_GAP;

const SEAM = 'rgba(255, 255, 255, 0.10)';
const INK_OFF = ink(0.88);
// One size for both glyphs so the two seats carry the same visual weight. Close to the nav's
// NAV_ICON: these labels are the same 11px, so the glyph beside them wants the same ratio.
const GLYPH = 19;

/** How long the play mark stays filled after a tap, when there is nothing to wait for. */
const PING_MS = 900;

export interface FloatingVerbsProps {
  /** True while a take is live — the island gives the run back to the capture pill. */
  collapsed: boolean;
  onTrailer: () => void;
  /** No trailer exists for this film. Still loading is NOT disabled — the tap queues. */
  trailerDisabled: boolean;
  /** A tap is waiting on the fetch. Holds the play mark FILLED until the player is up. */
  trailerBusy: boolean;
  favorited: boolean;
  onToggleFavorite: () => void;
}

const FloatingVerbs = ({
  collapsed,
  onTrailer,
  trailerDisabled,
  trailerBusy,
  favorited,
  onToggleFavorite,
}: FloatingVerbsProps) => {
  // A tap has just happened and there is nothing to wait for. Separate from trailerBusy so
  // the mark still acknowledges a tap when the video list is already in hand and the player
  // opens on the same tick.
  const [pinged, setPinged] = useState(false);
  const pingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The play mark is filled while we are acting on the tap — a filled play is the universal
  // "this is running", and it drains the moment the trailer is up or the fetch gives out.
  const lit = pinged || trailerBusy;

  const shut = useSharedValue(collapsed ? 1 : 0);
  const saved = useSharedValue(favorited ? 1 : 0);
  const play = useSharedValue(0);

  useEffect(() => {
    shut.value = withSpring(collapsed ? 1 : 0, NAV_SPRING);
  }, [collapsed, shut]);
  useEffect(() => {
    saved.value = withSpring(favorited ? 1 : 0, NAV_SPRING);
  }, [favorited, saved]);
  useEffect(() => {
    play.value = withSpring(lit ? 1 : 0, NAV_SPRING);
  }, [lit, play]);

  // A pending timer outliving the screen would setState on an unmounted tree.
  useEffect(
    () => () => {
      if (pingTimer.current) clearTimeout(pingTimer.current);
    },
    []
  );

  const handleTrailer = useCallback(() => {
    setPinged(true);
    if (pingTimer.current) clearTimeout(pingTimer.current);
    pingTimer.current = setTimeout(() => setPinged(false), PING_MS);
    onTrailer();
  }, [onTrailer]);

  // Width and margin fall to zero together. CLAMPed because NAV_SPRING is slightly
  // underdamped: without it an overshoot would hand back more room than the island ever had
  // and shove the capture pill past the run's edge.
  //
  // THE RIM HAS TO GO BEFORE THE WIDTH DOES. A bordered view's minimum width is its own two
  // borders, so an island at width 0 still draws a 2pt rounded sliver — and a shadow around
  // that sliver — which reads as a faint vertical line welded to the capture pill's left cap
  // for the whole session. (Same trap as the neck bar in CaptureWell, which drew a hairline
  // across the gap for exactly this reason.) Dropping the border over the tail of the close
  // leaves genuinely nothing behind: zero area, no stroke, and no path for iOS to cast a
  // shadow from.
  const islandStyle = useAnimatedStyle(() => {
    const out = interpolate(shut.value, [0, 1], [1, 0], Extrapolation.CLAMP);
    return {
      width: ISLAND_W * out,
      marginRight: NAV_ISLAND_GAP * out,
      borderWidth: interpolate(shut.value, [0.8, 0.97], [1, 0], Extrapolation.CLAMP),
    };
  });

  // The one opacity ramp in this file, and the same exception the nav makes for its tab
  // labels: clipping words letter-by-letter reads as a rendering fault, not as motion, so
  // the content is gone before the island is narrow enough for that to show.
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shut.value, [0, 0.38], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View
      style={[styles.island, islandStyle]}
      pointerEvents={collapsed ? 'none' : 'auto'}
    >
      {/* The blur carries the island's radius as well as being clipped by it. Redundant on
          paper, but an unrounded BlurView with nothing clipping it renders as a full
          rectangle on this stack, and that failure looked like a box behind a pill. */}
      <BlurView
        intensity={NAV_BLUR_INTENSITY}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={[StyleSheet.absoluteFill, styles.blur]}
      />

      {/* Fixed to the island's FULL width rather than 100%, so the labels hold still while
          the island narrows instead of being re-centred into the closing edge every frame. */}
      <Animated.View style={[styles.row, contentStyle]}>
        <TouchableOpacity
          style={styles.seat}
          activeOpacity={0.7}
          onPress={handleTrailer}
          disabled={trailerDisabled}
          accessibilityRole="button"
          accessibilityLabel="Watch trailer"
        >
          <View style={[styles.face, trailerDisabled && styles.faceDisabled]}>
            <FillGlyph
              focus={play}
              outline="play-outline"
              solid="play"
              color={lit ? TICKET_ACCENT : INK_OFF}
              size={GLYPH}
            />
            <Text style={[styles.label, lit && styles.labelOn]} numberOfLines={1}>
              TRAILER
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.seam} pointerEvents="none" />

        <TouchableOpacity
          style={styles.seat}
          activeOpacity={0.7}
          onPress={onToggleFavorite}
          accessibilityRole="button"
          accessibilityState={{ selected: favorited }}
          accessibilityLabel={favorited ? 'Remove from your slate' : 'Add to your slate'}
        >
          <View style={styles.face}>
            <FillGlyph
              focus={saved}
              outline="bookmark-outline"
              solid="bookmark"
              color={favorited ? TICKET_ACCENT : INK_OFF}
              size={GLYPH}
            />
            <Text style={[styles.label, favorited && styles.labelOn]} numberOfLines={1}>
              {favorited ? 'SLATED' : 'SLATE'}
            </Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  island: {
    height: ISLAND_H,
    borderRadius: ISLAND_R,
    // Clips the words as the island closes. Safe: the only transformed children are the
    // glyphs' fill windows, which are themselves clips and never reach the glass.
    overflow: 'hidden',
    backgroundColor: NAV_GLASS_TINT,
    // borderWidth is deliberately NOT set here — islandStyle owns it, so there is exactly
    // one place that decides whether the rim exists. A value here would fight it, and the
    // failure mode is moot anyway: if that animated style ever failed to apply, the island
    // would have no width either.
    borderColor: NAV_GLASS_RIM,
    // Matched to the capture pill's, so the pair sits at one height off the page.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 6,
  },
  blur: {
    borderRadius: ISLAND_R,
    overflow: 'hidden',
  },
  row: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    width: ISLAND_W,
    flexDirection: 'row',
    alignItems: 'center',
  },
  seat: {
    flex: 1,
    height: '100%',
  },
  face: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  faceDisabled: {
    opacity: 0.4,
  },
  seam: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: SEAM,
  },
  label: {
    color: ink(0.92),
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    includeFontPadding: false,
  },
  labelOn: {
    color: TICKET_ACCENT,
  },
});

export default FloatingVerbs;
