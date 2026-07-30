import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * TrailerPlayer — the CINEMA overlay: a curved MOVIE-THEATER SCREEN inside the
 * app. The detail screen stages the moment (ticket sinks, lights dim, logo
 * re-lights); this component settles in above the logo band as an edge-to-edge
 * cinemascope screen and powers on with a projector sweep (the picture expands
 * from a thin bright line) when frames actually arrive.
 *
 * THE CURVE is carved, not warped: a WebView can only render rectangular video,
 * so two pure-black SVG "bows" overlay the panel's top and bottom edges
 * (pointer-events off — YouTube's controls still work beneath them). Against the
 * black panel and the blacked-out house they're invisible, so the picture reads
 * as a genuinely curved screen — center tall, corners swept.
 *
 * THE SHOW ORDER: trailer loads → plays with the logo still lit for a short
 * beat → the house goes FULLY dark (a true-black blackout swallows the backdrop
 * AND the logo) → shortly after, the maturity rating assembles in the dark.
 * What remains lit is the screen and its own subtle glow — an auditorium.
 *
 * TILT-TO-FULLSCREEN: while a trailer is open, the app's portrait lock is lifted
 * (expo-screen-orientation). Turning the phone landscape rotates the window and
 * the SAME mounted player — no remount, playback never skips — reshapes to a
 * FITTED 16:9 picture centered in the window (letterboxed by the black root —
 * no cropping/zooming; a cover-fill was tried and cut). For a true edge-to-edge
 * native fullscreen the user taps YouTube's own fullscreen button — triggering
 * it automatically is NOT possible: browsers only allow fullscreen from a real
 * user gesture inside the page, and no iframe API exposes it. The fullscreen
 * rating appears ONCE per trailer (first landscape entry only), delayed like
 * the portrait bug, middle-left. Tilting back restores the theater; closing
 * (✕, tap-out, or the trailer ENDING) re-locks portrait.
 *
 * CONTROLS: YouTube's NATIVE control bar (`controls: true`) so scrubbing feels
 * natural, with branding dialed to the minimum the embed allows.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface TrailerPlayerProps {
  videoId: string | null;
  onClose: () => void;
  rating: string;
  /** Screen-bottom → theater-screen-bottom distance (parks it above the hero logo). */
  bottomOffset?: number;
  /** Screen-bottom → rating-bug distance (parks the bug below the hero logo). */
  ratingBottom?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants — the portrait auditorium
// ─────────────────────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width;

// Edge-to-edge picture: retiring the TV cabinet bought back ~50px of width and
// the whole chin/stand height — this is the portrait real-estate win.
const PANEL_W = SCREEN_W;
const PANEL_H = Math.round(PANEL_W * (9 / 16));

// Gentle cinemascope bow: how deep the corners sweep. The bows nibble only the
// video's top/bottom CORNERS; the scrub bar's ends sit slightly under them but
// stay fully tappable (the bows don't take touches).
const CURVE = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Show schedule (all from the first frame of playback)
// logo lingers lit → house to TRUE BLACK → the rating assembles in the dark.
// ─────────────────────────────────────────────────────────────────────────────

const BLACKOUT_MS = 4500; // how long the logo stays lit once the trailer is rolling
const RATING_IN_MS = BLACKOUT_MS + 2000; // rating rises shortly after the lights die
const RATING_HOLD_MS = 4000; // how long the rating holds before sinking away
// Fullscreen: wait this long after the FIRST landscape entry before the rating
// reveals — mirrors the portrait bug's deliberate delay (not an instant pop).
const FS_RATING_DELAY_MS = 3500;

// ─────────────────────────────────────────────────────────────────────────────
// ScreenBow — one black bow that carves a curved edge into the panel silhouette
// ─────────────────────────────────────────────────────────────────────────────

const ScreenBow = ({ position }: { position: 'top' | 'bottom' }) => {
  const w = PANEL_W;
  const c = CURVE;
  // Top: cover the sliver ABOVE an arc that peaks (y=0) at center and meets the
  // corners at y=c. Bottom: the mirror image. Quadratic control at ±c lands the
  // arc's midpoint exactly on the strip's far edge.
  const d =
    position === 'top'
      ? `M0,${c} Q${w / 2},${-c} ${w},${c} L${w},0 L0,0 Z`
      : `M0,0 Q${w / 2},${c * 2} ${w},0 L${w},${c} L0,${c} Z`;
  return (
    <Svg
      width={w}
      height={c}
      style={[styles.bow, position === 'top' ? { top: 0 } : { bottom: 0 }]}
      pointerEvents="none"
    >
      <Path d={d} fill="#000" />
    </Svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Entrance / exit worklets — transform + opacity only (reliable on this stack)
//
// LETTERBOX REVEAL for the portrait rating bug — the ticket's rule-flanked-label
// device (section headers, timeline dates) at cinema scale: the hairline rules
// DRAW OUTWARD from the certificate while the type rises up through them; the
// kicker and advisory follow on a stagger, like a credits card assembling.
// ─────────────────────────────────────────────────────────────────────────────

const ruleIn = (_: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scaleX: 0 }] },
    animations: {
      opacity: withDelay(160, withTiming(1, { duration: 220 })),
      transform: [
        { scaleX: withDelay(160, withTiming(1, { duration: 680, easing: Easing.out(Easing.cubic) })) },
      ],
    },
  };
};

const certIn = (_: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 18 }] },
    animations: {
      opacity: withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) }),
      transform: [{ translateY: withTiming(0, { duration: 720, easing: Easing.out(Easing.cubic) }) }],
    },
  };
};

const kickerIn = (_: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -10 }] },
    animations: {
      opacity: withDelay(260, withTiming(1, { duration: 420 })),
      transform: [
        { translateY: withDelay(260, withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) })) },
      ],
    },
  };
};

const advisoryIn = (_: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
    animations: {
      opacity: withDelay(460, withTiming(1, { duration: 420 })),
      transform: [
        { translateY: withDelay(460, withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) })) },
      ],
    },
  };
};

// Exit sinks the whole card as one.
const bugExit = (_: ExitAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, { duration: 500, easing: Easing.in(Easing.quad) }),
      transform: [{ translateY: withTiming(10, { duration: 550, easing: Easing.in(Easing.cubic) }) }],
    },
  };
};

// The fullscreen rating's underline — draws out from the left under the
// certificate, the landscape echo of the portrait bug's flanking rules.
const fsUnderlineIn = (_: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scaleX: 0 }] },
    animations: {
      opacity: withDelay(220, withTiming(1, { duration: 200 })),
      transform: [
        { scaleX: withDelay(220, withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) })) },
      ],
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const TrailerPlayer: React.FC<TrailerPlayerProps> = ({
  videoId,
  onClose,
  rating,
  bottomOffset = 340,
  ratingBottom = 136,
}) => {
  // ── Window / orientation geometry ──────────────────────────────────────────
  const insets = useSafeAreaInsets();

  // Landscape = the window is wider than it is tall. Derived from live window
  // dimensions, so it updates the instant the OS rotates the trailer.
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;

  // Fullscreen picture: a 16:9 box FITTED into the landscape window, centered and
  // letterboxed by the black root — the whole picture stays visible (no crop/zoom;
  // a cover-fill was tried and cut). True edge-to-edge is YouTube's own fullscreen
  // button, one tap away.
  const fit = Math.min(winW / 16, winH / 9);
  const playerW = landscape ? Math.round(16 * fit) : PANEL_W;
  const playerH = landscape ? Math.round(9 * fit) : PANEL_H;
  // The fitted picture's top-left within the window — so landscape overlays sit
  // OVER the video, not floating in the letterbox void.
  const panelLeft = (winW - playerW) / 2;
  const panelTop = (winH - playerH) / 2;

  // While a trailer is open, lift the app's portrait lock so the phone's own
  // auto-rotate can turn the player landscape (and back). Closing — for ANY
  // reason, including the video ending — re-locks portrait, so the app always
  // returns upright. Keys off videoId so it also covers a parent that simply
  // stops passing one.
  useEffect(() => {
    if (!videoId) return;
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [videoId]);

  // ── Playback state ──────────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(true); // drives the play prop; synced from events
  // Flips true on the first frame of playback — the rotate hint lives only during
  // the load/warm-up window and clears the instant the picture starts.
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);

  // ── Show state (blackout + ratings) ────────────────────────────────────────
  const [blackout, setBlackout] = useState(false);
  const [showRating, setShowRating] = useState(false); // portrait screening bug
  const [fsRatingShown, setFsRatingShown] = useState(false); // fullscreen mark
  // The fullscreen rating shows ONCE per trailer — first landscape entry only.
  // Re-entering fullscreen later doesn't repeat it (redundant info).
  const fsRatingSeenRef = useRef(false);
  const showTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => {
    showTimers.current.forEach(clearTimeout);
    showTimers.current = [];
  };

  // First landscape entry → schedule the one-time fullscreen rating reveal
  // (delayed like the portrait bug — not an instant pop on rotation).
  useEffect(() => {
    if (!landscape) {
      setFsRatingShown(false);
      return;
    }
    if (fsRatingSeenRef.current) return;
    fsRatingSeenRef.current = true;
    const showT = setTimeout(() => setFsRatingShown(true), FS_RATING_DELAY_MS);
    const hideT = setTimeout(() => setFsRatingShown(false), FS_RATING_DELAY_MS + RATING_HOLD_MS);
    return () => {
      clearTimeout(showT);
      clearTimeout(hideT);
    };
  }, [landscape]);

  // ── Animations ──────────────────────────────────────────────────────────────
  // Projector strike: the picture expands from a thin bright line once frames arrive.
  const powerSV = useSharedValue(0);
  const panelOnStyle = useAnimatedStyle(() => ({
    opacity: 0.12 + powerSV.value * 0.88,
    transform: [
      { scaleY: 0.015 + powerSV.value * 0.985 },
      { scaleX: 0.72 + powerSV.value * 0.28 },
    ],
  }));

  // Rotate-hint icon wiggle: a gentle looping tilt demonstrating the gesture.
  // Lives ONLY during the load/warm-up window; hidden in landscape.
  const hintActive = !landscape && !started;
  const hintTilt = useSharedValue(0);
  useEffect(() => {
    if (!hintActive) {
      cancelAnimation(hintTilt);
      hintTilt.value = withTiming(0, { duration: 200 });
      return;
    }
    hintTilt.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }),
        withDelay(200, withTiming(1, { duration: 0 })),
        withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        withDelay(900, withTiming(0, { duration: 0 }))
      ),
      -1
    );
    return () => cancelAnimation(hintTilt);
  }, [hintActive, hintTilt]);
  const hintIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${hintTilt.value * -90}deg` }],
  }));

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  // New video → full reset (the component stays mounted between plays).
  useEffect(() => {
    setPlaying(true);
    setStarted(false);
    setBlackout(false);
    setShowRating(false);
    setFsRatingShown(false);
    startedRef.current = false;
    fsRatingSeenRef.current = false;
    powerSV.value = 0;
    clearTimers();
    return clearTimers;
  }, [videoId, powerSV]);

  const handleStateChange = (event: string) => {
    if (event === 'ended') {
      onClose();
      return;
    }
    // Keep the play prop in sync with YouTube's own controls (scrub/pause/play).
    if (event === 'paused') setPlaying(false);
    if (event === 'playing') {
      setPlaying(true);
      setStarted(true); // picture is live → dismiss the rotate hint
      // First real playback → strike the projector, then run the show schedule:
      // logo lingers → house to black → the rating assembles in the dark → sinks.
      if (!startedRef.current) {
        startedRef.current = true;
        powerSV.value = withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) });
        showTimers.current.push(setTimeout(() => setBlackout(true), BLACKOUT_MS));
        showTimers.current.push(setTimeout(() => setShowRating(true), RATING_IN_MS));
        showTimers.current.push(
          setTimeout(() => setShowRating(false), RATING_IN_MS + RATING_HOLD_MS)
        );
      }
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!videoId) return null;

  const isR = rating === 'R' || rating === 'NC-17';

  return (
    <View style={[StyleSheet.absoluteFill, landscape && styles.rootLandscape]} pointerEvents="box-none">
      {/* Landscape fullscreen hides the notch/status bar for a true edge-to-edge frame. */}
      <StatusBar hidden={landscape} animated />

      {/* HOUSE TO BLACK — swallows the backdrop AND the logo a while into playback;
          everything after this line (✕, the screen, the bug) stays lit. Portrait
          only: landscape already fills the window with a black root. */}
      {blackout && !landscape && (
        <Animated.View
          entering={FadeIn.duration(1800)}
          exiting={FadeOut.duration(300)}
          style={styles.blackout}
          pointerEvents="none"
        />
      )}

      {/* Tap anywhere outside the screen to end the show. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close trailer" />

      {/* ✕ — screen top-right, clear of the whole composition. */}
      <Animated.View
        entering={FadeIn.duration(300).delay(240)}
        exiting={FadeOut.duration(140)}
        style={[styles.closeWrap, { top: Math.max(insets.top, 14), right: Math.max(insets.right, 16) }]}
      >
        <Pressable
          onPress={onClose}
          hitSlop={16}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Close trailer"
        >
          <Ionicons name="close" size={26} color="rgba(255,255,255,0.92)" />
        </Pressable>
      </Animated.View>

      {/* THE SCREEN — the theater composition in portrait; a fitted, centered
          fullscreen picture in landscape. The player element stays put across the
          switch, so rotating only RESIZES it — playback never reloads or skips. */}
      <Animated.View
        entering={FadeInDown.duration(340).delay(240)}
        exiting={FadeOut.duration(160)}
        style={landscape ? styles.stackFull : [styles.stack, { bottom: bottomOffset }]}
        pointerEvents="box-none"
      >
        <View style={landscape ? { width: playerW, height: playerH } : styles.panel}>
          {/* The picture — collapsed to a faint warming line until frames arrive,
              then the projector sweep opens it to full. */}
          <Animated.View style={[styles.picture, panelOnStyle]}>
            <YoutubePlayer
              width={playerW}
              height={playerH}
              videoId={videoId}
              play={playing}
              onChangeState={handleStateChange}
              webViewProps={{
                androidLayerType: 'hardware',
                scrollEnabled: false,
              }}
              initialPlayerParams={{
                controls: true, // native controls → natural scrubbing
                modestbranding: true, // least YouTube branding the embed allows
                rel: false,
                iv_load_policy: 3, // no annotations
              }}
            />
          </Animated.View>

          {/* ROTATE HINT — centered in the panel where the loading indicator sat:
              fills the load/warm-up wait, clears QUICKLY (250ms) the instant playback
              starts, crossing under the 460ms projector sweep. No bubble. Outer owns
              the fade; inner owns the looping tilt. */}
          {hintActive && (
            <Animated.View
              entering={FadeIn.duration(360).delay(220)}
              exiting={FadeOut.duration(250)}
              style={styles.rotateHint}
              pointerEvents="none"
            >
              <Animated.View style={hintIconStyle}>
                <MaterialCommunityIcons name="phone-rotate-landscape" size={26} color="rgba(255,255,255,0.85)" />
              </Animated.View>
              <Text style={styles.rotateHintText}>ROTATE FOR FULLSCREEN</Text>
            </Animated.View>
          )}

          {/* The cinemascope carve — portrait only (a fullscreen picture is flat). */}
          {!landscape && (
            <>
              <ScreenBow position="top" />
              <ScreenBow position="bottom" />
            </>
          )}
        </View>
      </Animated.View>

      {/* FULLSCREEN RATING — the landscape echo of the portrait screening bug: a
          left-aligned typographic mark, vertically centered on the VIDEO's left
          edge (middle-left, clear of YouTube's top controls). ONCE per trailer. */}
      {landscape && fsRatingShown && (
        <Animated.View
          entering={FadeIn.duration(450)}
          exiting={FadeOut.duration(600)}
          style={[styles.fsRating, { top: panelTop, height: playerH, left: Math.max(panelLeft + 22, insets.left + 14) }]}
          pointerEvents="none"
        >
          <Text style={styles.fsKicker}>RATED</Text>
          <Text style={styles.fsCert}>{rating}</Text>
          <Animated.View entering={fsUnderlineIn} style={styles.fsRule} />
          {isR && <Text style={styles.fsAdvisory}>VIEWER DISCRETION ADVISED</Text>}
        </Animated.View>
      )}

      {/* THE SCREENING BUG — huge typographic rating below the logo, assembling as
          a letterbox reveal in the dark: rules draw outward, the certificate rises
          through them, kicker + advisory follow. ONE color for every certificate. */}
      {showRating && !landscape && (
        <Animated.View
          exiting={bugExit}
          style={[styles.ratingFloat, { bottom: ratingBottom }]}
          pointerEvents="none"
        >
          <Animated.View entering={kickerIn}>
            <Text style={styles.ratingKicker}>RATED</Text>
          </Animated.View>
          <View style={styles.ratingRow}>
            <Animated.View entering={ruleIn} style={styles.ratingRule} />
            <Animated.View entering={certIn}>
              <Text style={styles.ratingBig}>{rating}</Text>
            </Animated.View>
            <Animated.View entering={ruleIn} style={styles.ratingRule} />
          </View>
          {isR && (
            <Animated.View entering={advisoryIn}>
              <Text style={styles.ratingAdvisory}>VIEWER DISCRETION ADVISED</Text>
            </Animated.View>
          )}
        </Animated.View>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Stage layers ────────────────────────────────────────────────────────────
  blackout: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  // Landscape fullscreen: black fills the window, letterboxing the fitted picture.
  rootLandscape: {
    backgroundColor: '#000',
  },

  // ── The screen (portrait theater / landscape fullscreen) ───────────────────
  stack: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // Fullscreen: dead-center the fitted picture in the landscape window.
  stackFull: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: PANEL_W,
    height: PANEL_H,
    backgroundColor: '#000',
    // The screen's own VERY subtle glow — all the ambience it needs once the
    // house goes black.
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
  },
  picture: {
    ...StyleSheet.absoluteFillObject,
  },
  bow: {
    position: 'absolute',
    left: 0,
  },

  // ── Rotate hint (portrait, load window only) ────────────────────────────────
  rotateHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
  },
  rotateHintText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 2.5,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },

  // ── Close button ────────────────────────────────────────────────────────────
  closeWrap: {
    position: 'absolute',
    zIndex: 4,
  },
  closeBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  closeBtnPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.94 }],
  },

  // ── Fullscreen rating (landscape, once per trailer, middle-left) ───────────
  fsRating: {
    position: 'absolute',
    zIndex: 4,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  fsKicker: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 3.5,
    marginBottom: 1,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  fsCert: {
    color: 'rgba(255,255,255,0.96)',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 3,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  fsRule: {
    width: 40,
    height: 1.5,
    borderRadius: 1,
    marginTop: 7,
    backgroundColor: 'rgba(255,255,255,0.55)',
    transformOrigin: 'left',
  },
  fsAdvisory: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 8,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // ── Portrait screening bug (below the logo, in the dark) ───────────────────
  ratingFloat: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 2,
  },
  ratingRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 30,
  },
  ratingRule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  ratingKicker: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 4,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  ratingBig: {
    color: 'rgba(255,255,255,0.96)',
    fontSize: 62,
    fontWeight: '900',
    letterSpacing: 5,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 14,
  },
  ratingAdvisory: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 2.6,
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});

export default TrailerPlayer;
