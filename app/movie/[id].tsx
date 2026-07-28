import { View, Dimensions, ActivityIndicator, Text, ScrollView, Pressable, TouchableOpacity, StyleSheet, StatusBar, NativeSyntheticEvent, NativeScrollEvent } from 'react-native'
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import ReAnimated, { useSharedValue, useDerivedValue, useAnimatedStyle, useAnimatedReaction, runOnJS, interpolate, Extrapolation, withSpring, withTiming, withSequence, Easing, FadeInDown, FadeOut, type EntryAnimationsValues, type ExitAnimationsValues } from 'react-native-reanimated';
import React, { useState, useRef, useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router';
import useFetch from '@/services/useFetch';
import { fetchMovieDetails, fetchMovieImages, fetchMovieVideos, pickMainTrailer } from '@/services/api';
import { LinearGradient } from 'expo-linear-gradient';
import MovieTabBar from '@/components/moviedetails/MovieTabBar';
import TrailerPlayer from '../../components/TrailerPlayer';
import { MovieVideo, TabType } from '@/interfaces/interfaces';
import { Image } from 'expo-image'; // Changed to expo-image for better performance
import * as Haptics from 'expo-haptics';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useCaptureSession } from '@/hooks/useCaptureSession';
import { ConfettiRain, DING, RAIN_LIFETIME_MS, THUD } from '@/components/moviedetails/CapturePill';
import StubCapturePanel from '@/components/moviedetails/StubCapturePanel';
import { useAudioPlayer } from 'expo-audio';
import CaptureCountdownOverlay from '@/components/moviedetails/CaptureCountdownOverlay';
import CaptureStatusBadge from '@/components/moviedetails/CaptureStatusBadge';
import EntriesStar from '@/components/moviedetails/EntriesStar';
import ShimmerSweep from '@/components/moviedetails/ShimmerSweep';
import MovieEntriesTab from '@/components/moviedetails/MovieEntriesTab';
import { getTakes, type Take } from '@/services/db';
import { onEnrichmentChanged } from '@/services/enrichment';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Path, Line } from 'react-native-svg';
import { TICKET_GLASS_TINT, TICKET_ACCENT, ink, accent } from '@/components/moviedetails/ticketTheme';

// Add new memoized components to prevent unnecessary re-renders
const MemoizedMovieTabBar = React.memo(MovieTabBar);

// Add image placeholder for smooth loading
const PLACEHOLDER_COLOR = '#151312';

// Constants for dimensions
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Sheet chrome tunables ───────────────────────────────────────────────────
// Vertical position of the close button + INFO·ENTRIES toggle, measured from the top of
// the sheet. LOWER number = HIGHER up. This is the one knob to fine-tune that bar.
const TOP_BAR_TOP = 15;

// Hero / sheet parallax layout. The backdrop is a FIXED layer; the content is a rounded
// "sheet" that scrolls up over it while the backdrop drifts slower (parallax) and takes
// on a progressive blur + dim (the glassy focus shift).
const HERO_RATIO = 0.70;      // hero height as a fraction of the screen. Lower = shorter hero.
const LOGO_BOTTOM = 120;      // logo distance from the hero bottom.
const CONTENT_LIFT = 120;     // px the sheet's rounded top overlaps INTO the backdrop at rest.
// Backdrop blur fade — set to 0 to keep the hero sharp (no progressive glass). Independent
// of the ticket expand morph below.
const BLUR_END = 0;
// Sheet expand distance — how far you scroll before the ticket reaches full scale.
// Keep this > 0 even when BLUR_END is 0 so the card still grows on the way up.
const MORPH_END = 0.5;

// ── TMDB rating mark (centered in the stub's action row) ────────────────────
// The brand wordmark SVG ends in a gradient capsule ("the bubble") spanning the
// right ~36% of the artwork (viewBox 273.42×35.52, capsule from x≈174) — the
// score prints INSIDE it. No star, no "/10": the capsule IS the score's home.
const TMDB_LOGO_H = 16;
const TMDB_LOGO_W = Math.round(TMDB_LOGO_H * (273.42 / 35.52));
const TMDB_BUBBLE_LEFT = '63.7%'; // 174.18 / 273.42
const TMDB_NAVY = '#032541'; // TMDB brand navy — reads cleanly on the capsule gradient

// ── Glass ticket (reference silhouette) ──────────────────────────────────────
// One BlurView + slight dark tint, masked to a rounded ticket with true side
// notches. Content is a single flow — no stacked fills — so scroll can't flash
// a seam. Dashed perforations are drawn on top at each notch line.
const TICKET_RADIUS = 28;
const NOTCH_R = 14;

/** White silhouette mask: rounded rect with side notches at each notchY (even-odd). */
const TicketMask = ({
  width,
  height,
  notchYs,
}: {
  width: number;
  height: number;
  notchYs: number[];
}) => {
  const r = TICKET_RADIUS;
  let d =
    `M${r},0 H${width - r} A${r},${r} 0 0 1 ${width},${r} ` +
    `V${height - r} A${r},${r} 0 0 1 ${width - r},${height} ` +
    `H${r} A${r},${r} 0 0 1 0,${height - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
  for (const notchY of notchYs) {
    const cy = Math.min(Math.max(notchY, r + NOTCH_R + 4), height - r - NOTCH_R - 4);
    d +=
      ` M${-NOTCH_R},${cy} a${NOTCH_R},${NOTCH_R} 0 1,0 ${NOTCH_R * 2},0 a${NOTCH_R},${NOTCH_R} 0 1,0 ${-NOTCH_R * 2},0 Z` +
      ` M${width - NOTCH_R},${cy} a${NOTCH_R},${NOTCH_R} 0 1,0 ${NOTCH_R * 2},0 a${NOTCH_R},${NOTCH_R} 0 1,0 ${-NOTCH_R * 2},0 Z`;
  }
  return (
    <Svg width={width} height={height}>
      <Path d={d} fill="#fff" fillRule="evenodd" />
    </Svg>
  );
};

/** Dashed perforation sitting on the notch line (visual only — notches are in the mask). */
const TicketPerforation = ({ width, y }: { width: number; y: number }) => (
  <Svg
    width={width}
    height={NOTCH_R * 2}
    style={{ position: 'absolute', left: 0, top: y - NOTCH_R, zIndex: 3 }}
    pointerEvents="none"
  >
    <Line
      x1={NOTCH_R + 16}
      y1={NOTCH_R}
      x2={width - NOTCH_R - 16}
      y2={NOTCH_R}
      stroke={ink(0.35)}
      strokeWidth={1.25}
      strokeDasharray="4,6"
    />
  </Svg>
);

/** Deterministic barcode seeded by movie id. */
const Barcode = ({ seed }: { seed: number }) => {
  const bars = React.useMemo(() => {
    let s = seed > 0 ? seed : 7;
    const out: number[] = [];
    for (let i = 0; i < 36; i++) {
      s = (s * 9301 + 49297) % 233280;
      out.push(1 + (s % 3));
    }
    return out;
  }, [seed]);
  return (
    <View style={styles.barcode}>
      {bars.map((bw, i) => (
        <View key={i} style={[styles.barcodeBar, { width: bw }]} />
      ))}
    </View>
  );
};

type ActionToastKind = 'favorite' | 'removed' | 'warning';
type ActionToast = {
  id: number;
  kind: ActionToastKind;
  title: string;
  detail: string;
};

interface MovieDetailsViewProps {
  movieId: string;
  // True for a layer pushed from a SIMILAR carousel — it slid in from the right
  // INSIDE the sheet, so the close button reads as "back" instead of "dismiss".
  nested: boolean;
  // True only on the FIRST open of the sheet: the ticket "dispenses" — shoots up from
  // the bottom, overshoots a hair, settles. In-sheet pushes/pops use the slide instead.
  dispense: boolean;
  onOpenMovie: (movieId: number) => void; // push another movie's details onto the in-sheet stack
  onBack: () => void; // pop this layer (nested) or dismiss the whole sheet (root)
  // Arrived via a hero-section TRAILER button: once the ticket lands, run the
  // standard trailer flow automatically (sheet appears → lights dim → trailer).
  autoTrailer?: boolean;
}

const MovieDetailsView = ({ movieId, nested, dispense, onOpenMovie, onBack, autoTrailer }: MovieDetailsViewProps) => {
  const insets = useSafeAreaInsets();
  const [images, setImages] = useState<{
    backdrop: string | null,
    logo: string | null
  }>({
    backdrop: null,
    logo: null
  });
  const { data: movie, loading } = useFetch(() => fetchMovieDetails(movieId));
  const { height } = Dimensions.get('window');
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [view, setView] = useState<'info' | 'entries'>('info');
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  // Full (uncapped) line count of the overview, measured once by an invisible twin —
  // "Show more" only renders when the text genuinely overflows the 2-line collapse.
  const [synopsisLines, setSynopsisLines] = useState<number | null>(null);
  const synopsisOverflows = (synopsisLines ?? 0) > 2;
  const [sheetH, setSheetH] = useState(0);
  const [tearYSynopsis, setTearYSynopsis] = useState(0);
  const [tearYFooter, setTearYFooter] = useState(0);
  const [trailers, setTrailers] = useState<MovieVideo[]>([]);
  const [trailersLoading, setTrailersLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [posterFetched, setPosterFetched] = useState(false);
  const imageTransitionDuration = 0;

  // Scroll-driven animations (Reanimated). `scrollY` is a SharedValue fed by the plain
  // JS onScroll on the ScrollView below. The previous version used a legacy
  // `Animated.Value` + `Animated.event` + `interpolate`, which freezes at its mount value
  // on this stack (Fabric / Expo Go SDK 54) — that's what left the sticky header dead and
  // the hero parallax static. SharedValue + useAnimatedStyle runs on the UI thread and
  // works here (same pattern the Search tab + carousels were migrated to).
  const scrollY = useSharedValue(0);

  // ── Cinema mode ────────────────────────────────────────────────────────────
  // Trailer playback is STAGED, not modal: the whole scroll stage (ticket and
  // all) sinks below the screen, the scroll-glass + top/bottom chrome fade away
  // to reveal the raw backdrop, then the player settles in over the hero logo
  // and autoplays. 0 = normal · 1 = cinema. Closing (or the video ending)
  // reverses everything with a smooth no-bounce spring.
  const cinema = selectedVideo !== null;
  const cinemaSV = useSharedValue(0);
  useEffect(() => {
    cinemaSV.value = cinema
      ? withTiming(1, { duration: 520, easing: Easing.inOut(Easing.cubic) }) // curtain down
      : withSpring(0, { damping: 26, stiffness: 200, mass: 1 }); // ticket returns, settles clean
  }, [cinema, cinemaSV]);

  // The scroll stage sinks one full screen-height — off-stage from ANY scroll position.
  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cinemaSV.value * height }],
  }));
  // Chrome (top bar, header scrim, capture pill/badge) fades out as the stage sinks.
  const chromeFadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - cinemaSV.value,
  }));
  // Lights out: the cinema scrim (blur + dim over the backdrop, under the logo)
  // rises with the stage's exit so the logo + trailer become the lit subjects.
  const cinemaScrimStyle = useAnimatedStyle(() => ({
    opacity: cinemaSV.value,
  }));

  // Top bar "comes alive": shrinks a touch on scroll-down, springs back to full size on
  // scroll-up. Direction is derived from the plain-JS onScroll (useAnimatedScrollHandler
  // doesn't fire reliably on this stack) and written once per direction-change.
  const barShrink = useSharedValue(0); // 0 = full, 1 = minimized

  const lastYRef = useRef(0);
  const collapsedRef = useRef(false);
  // Bounce only at the top (pull-to-zoom). Once the user has scrolled down, lock the
  // bottom — no rubber-band overscroll when they hit the end of the ticket.
  const [bounces, setBounces] = useState(true);
  const bouncesRef = useRef(true);
  // Capture "detach" (Paper 04–05 — "the panel's ACTION ROW detaches and docks"):
  // a continuous, scroll-DRIVEN hand-off, not a state flip. dockProgress rides
  // scrollY over a fixed band; the inline panel's verb row fades/sinks by it
  // while the dock rises/appears by it — a parallax glide the finger can play
  // forwards and backwards. `captureDetached` only gates which copy is TOUCHABLE.
  const [captureDetached, setCaptureDetached] = useState(false);
  const captureDetachedRef = useRef(false);
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollY.value = y;
    const dy = y - lastYRef.current;
    lastYRef.current = y;
    let next = collapsedRef.current;
    if (y <= 6) next = false; // always full near the top
    else if (Math.abs(dy) > 4) next = dy > 0; // down → minimize, up → restore
    if (next !== collapsedRef.current) {
      collapsedRef.current = next;
      barShrink.value = withSpring(next ? 1 : 0, {
        damping: 14,
        stiffness: 190,
        mass: 0.65,
      });
    }
    // Touch ownership flips at the middle of the visual glide (with a small
    // hysteresis band so it can't chatter) — the visuals themselves are driven
    // continuously by dockProgress, never by this flag.
    let detached = captureDetachedRef.current;
    if (y > 210) detached = true;
    else if (y < 180) detached = false;
    if (detached !== captureDetachedRef.current) {
      captureDetachedRef.current = detached;
      setCaptureDetached(detached);
    }
    const allowBounce = y <= 1;
    if (allowBounce !== bouncesRef.current) {
      bouncesRef.current = allowBounce;
      setBounces(allowBounce);
    }
  };

  const heroH = height * HERO_RATIO;

  // 0 → verbs seated in the ticket panel · 1 → verbs docked at the bottom.
  // One value drives BOTH sides of the parallax so they can never disagree.
  const dockProgress = useDerivedValue(() =>
    interpolate(scrollY.value, [120, 260], [0, 1], Extrapolation.CLAMP)
  );
  const dockStyle = useAnimatedStyle(() => ({
    opacity: dockProgress.value,
    transform: [{ translateY: (1 - dockProgress.value) * 44 }],
  }));

  // FIXED backdrop: STATIC by design — no scroll drift. Moving it exposed the layer
  // beneath as a gray band, and the sheet's expand morph is the one parallax gesture
  // this screen needs. The image only zooms on pull-down (overscroll), which can never
  // reveal an edge because it grows, not slides.
  const heroImageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(scrollY.value, [-400, -0.1, 0], [1.8, 1, 1], Extrapolation.CLAMP) },
    ],
  }));

  // Backdrop blur fade — disabled when BLUR_END is 0 (hero stays sharp). Cinema mode
  // lifts it entirely (× (1 − cinema)) so the backdrop shows raw behind the trailer.
  const backdropBlurStyle = useAnimatedStyle(() => ({
    opacity:
      (BLUR_END <= 0
        ? 0
        : interpolate(scrollY.value, [0, heroH * BLUR_END], [0, 1], Extrapolation.CLAMP)) *
      (1 - cinemaSV.value),
  }));

  // Floating logo/title: fully visible at the top, fades before the sheet reaches it.
  // Cinema RE-LIGHTS it — even entering from deep scroll (Extras rail), the logo fades
  // back in above the lights-out scrim as one of the show's three lit subjects.
  const fadeOnScrollStyle = useAnimatedStyle(() => {
    const scrollFade = interpolate(
      scrollY.value,
      [0, heroH * 0.15, heroH * 0.45],
      [1, 1, 0],
      Extrapolation.CLAMP
    );
    return { opacity: scrollFade + (1 - scrollFade) * cinemaSV.value };
  });

  // Top scrim: invisible while the hero logo is up, then fades IN as the logo fades OUT —
  // so the close + INFO/ENTRIES controls stay legible over the glassing backdrop.
  // 0 → bare hero · 1 → the top glass is fully on. ONE value drives the scrim AND
  // the title that sits on it, so the name can never arrive before its backing or
  // outstay it — they are one piece of chrome, not two things that happen to agree.
  const headerProgress = useDerivedValue(() =>
    interpolate(scrollY.value, [heroH * 0.25, heroH * 0.5], [0, 1], Extrapolation.CLAMP)
  );

  const headerScrimStyle = useAnimatedStyle(() => {
    const scrollOpacity = headerProgress.value;

    return {
      opacity:
        scrollOpacity *
        interpolate(barShrink.value, [0, 1], [1, 0.88], Extrapolation.CLAMP) *
        (1 - cinemaSV.value),
      height: interpolate(barShrink.value, [0, 1], [TOP_BAR_TOP + 55, TOP_BAR_TOP + 48], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(barShrink.value, [0, 1], [0, -4], Extrapolation.CLAMP) },
        { scaleY: interpolate(barShrink.value, [0, 1], [1, 0.94], Extrapolation.CLAMP) },
      ],
    };
  });

  // The film's name, on the same band as the glass behind it. It lifts the last few
  // points as it arrives rather than only fading, so it reads as settling onto the
  // scrim instead of being switched on. Cinema mode takes it away with the rest of
  // the chrome — the trailer owns the screen.
  const headerTitleStyle = useAnimatedStyle(() => ({
    opacity: headerProgress.value * (1 - cinemaSV.value),
    transform: [{ translateY: (1 - headerProgress.value) * 6 }],
  }));

  // The top bar's scroll-reactive size: ~12% smaller + a hair up + slightly dimmer when
  // minimized, full and crisp when restored. Subtle — just enough to feel alive.
  const topBarAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(barShrink.value, [0, 1], [1, 0.88], Extrapolation.CLAMP) },
      { translateY: interpolate(barShrink.value, [0, 1], [0, -3], Extrapolation.CLAMP) },
    ],
    opacity: interpolate(barShrink.value, [0, 1], [1, 0.9], Extrapolation.CLAMP),
  }));


  // Dispense-in: on first open the ticket SHOOTS up from below the screen (fast,
  // decisive), overshoots by a hair, then settles back down — a ticket printer spitting
  // the stub. ~580ms total: quick enough to never feel redundant, long enough to read.
  const dispenseSV = useSharedValue(dispense ? 1 : 0);
  useEffect(() => {
    if (!dispense) return;
    dispenseSV.value = 1;
    dispenseSV.value = withSequence(
      withTiming(-0.035, { duration: 600, easing: Easing.out(Easing.cubic) }), // shoot past
      withSpring(0, { damping: 18, stiffness: 240, mass: 0.9 }) // settle down
    );
    // One-shot on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The sheet GROWS as it rises — driven by MORPH_END, not BLUR_END, so turning off
  // backdrop blur (BLUR_END = 0) still keeps the expand.
  const sheetMorphStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dispenseSV.value * height },
      { scale: interpolate(scrollY.value, [0, heroH * MORPH_END], [0.94, 1], Extrapolation.CLAMP) },
    ],
  }));

  // Fetch images in parallel with movie details
  React.useEffect(() => {
    if (movieId) {
      // Start fetching images immediately
      const fetchImageData = async () => {
        try {
          const movieImages = await fetchMovieImages(movieId);

          // Only set images if they're not already set
          if (!posterFetched) {
            setImages({
              backdrop: movieImages.altPoster,
              logo: movieImages.logo
            });
            setPosterFetched(true);
          }
        } catch (error) {
          console.error('Error fetching images:', error);
        }
      };

      fetchImageData();
    }
  }, [movieId]);

  // Use movie backdrop as fallback
  React.useEffect(() => {
    if (movie && !images.backdrop && movie.backdrop_path) {
      setImages(prev => ({
        ...prev,
        backdrop: movie.backdrop_path
      }));
    }
  }, [movie, images.backdrop]);

  // Favorites come from the shared SQLite-backed context. `favorited` reflects the
  // persisted list; saving stores just enough to render the Saved tab's poster card.
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = movie ? isFavorite(movie.id) : false;

  // Ticket-header facts — moved up from the Details bento so the bare minimum a
  // user expects (date, runtime, rating, language, genres) needs zero scrolling.
  const releaseDateShort = movie?.release_date
    ? new Date(movie.release_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'TBA';
  // Not out yet → the DATE column wears a tiny "Expected" tag (the shown date IS
  // the expected one). Trust the date when present; fall back to TMDB's status.
  const isUpcoming = !!movie
    ? movie.release_date
      ? new Date(movie.release_date) > new Date()
      : movie.status !== 'Released'
    : false;
  const language =
    movie?.spoken_languages?.find((l) => l.iso_639_1 === movie.original_language)?.english_name ||
    movie?.original_language?.toUpperCase() ||
    '—';
  const genresLine = (movie?.genres ?? [])
    .map((g) => (g.name === 'Science Fiction' ? 'Sci-Fi' : g.name))
    .join('  ·  ');

  // Lightweight action receipt for the header actions (Save / Trailer).
  const [toast, setToast] = useState<ActionToast | null>(null);
  const toastId = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailerUnavailableTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = React.useCallback((kind: ActionToastKind, title: string, detail: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, kind, title, detail });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2100);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (trailerUnavailableTimer.current) clearTimeout(trailerUnavailableTimer.current);
  }, []);

  const handleToggleFavorite = () => {
    if (!movie) return;
    const adding = !favorited;
    if (adding) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    showToast(
      adding ? 'favorite' : 'removed',
      adding ? 'Added to Favorites' : 'Removed from Favorites',
      adding ? 'Saved to your movie shelf' : 'Removed from your saved list'
    );
    toggleFavorite({
      id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path,
      vote_average: movie.vote_average,
      release_date: movie.release_date,
    });
  };

  // This movie's takes (shown in the ENTRIES tab). `newCount` badges the ENTRIES toggle
  // after a new recording, cleared when the user opens that tab.
  const [takes, setTakes] = useState<Take[]>([]);
  const [newCount, setNewCount] = useState(0);

  const refreshTakes = React.useCallback(() => {
    if (!movie) return;
    getTakes(movie.id).then(setTakes).catch((e) => console.error('Failed to load takes:', e));
  }, [movie]);

  React.useEffect(() => {
    refreshTakes();
  }, [refreshTakes]);

  // No entries → no ENTRIES view: the star stays a sealed cutout until a take
  // exists, and deleting the last take walks you back to INFO.
  React.useEffect(() => {
    if (takes.length === 0 && view === 'entries') setView('info');
  }, [takes.length, view]);

  // Background enrichment (transcription/summary) lands minutes after a save —
  // re-read this movie's takes whenever the pipeline writes, so the ENTRIES tab
  // fills in live instead of on the next visit.
  React.useEffect(() => onEnrichmentChanged(refreshTakes), [refreshTakes]);

  // Save/delete celebration lives at the SCREEN level (not inside a capture
  // surface): the bottom dock unmounts the instant a take resolves, and the
  // confetti/chime/thud must outlive whichever surface fired them.
  const ding = useAudioPlayer(DING);
  const thud = useAudioPlayer(THUD);
  const [confettiBurst, setConfettiBurst] = useState(0);
  const celebrationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => celebrationTimers.current.forEach(clearTimeout), []);

  // Capture session ("What's your take?") — drives the capture module; on save it
  // refreshes the takes, badges the ENTRIES toggle, and runs the celebration.
  const capture = useCaptureSession(
    movie ? { id: movie.id, title: movie.title, poster_path: movie.poster_path } : null,
    {
      onSaved: () => {
        refreshTakes();
        setNewCount((n) => n + 1);
        setConfettiBurst((b) => b + 1);
        celebrationTimers.current.push(
          setTimeout(() => setConfettiBurst(0), RAIN_LIFETIME_MS + 800)
        );
        celebrationTimers.current.push(
          setTimeout(() => {
            try {
              ding.seekTo(0);
              ding.play();
            } catch (e) {
              console.warn('Save chime failed:', e);
            }
          }, 400)
        );
      },
    }
  );

  // Discard wrapper — the delete thud plays here so it survives the dock unmounting.
  const handleDiscardWithThud = () => {
    celebrationTimers.current.push(
      setTimeout(() => {
        try {
          thud.seekTo(0);
          thud.play();
        } catch (e) {
          console.warn('Delete thud failed:', e);
        }
      }, 380)
    );
    capture.discard();
  };

  const handleSelectView = React.useCallback((next: 'info' | 'entries') => {
    Haptics.selectionAsync();
    setView(next);
    if (next === 'entries') setNewCount(0); // opening entries clears the "new" dot
  }, []);

  // Record entry point — lives in the ticket stub now (ported from the Paper flow's
  // action block), same arming path the pill's idle tap used to take.
  const handleRecordPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    capture.start();
  };

  // Tapped play before the trailer list landed → remember it and start the show the
  // moment the fetch resolves (the button + toast show the loading state meanwhile).
  const pendingTrailer = useRef(false);

  const handleTrailerPress = () => {
    if (trailerUnavailableTimer.current) {
      clearTimeout(trailerUnavailableTimer.current);
      trailerUnavailableTimer.current = null;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (trailers.length === 0) {
      if (trailersLoading) {
        pendingTrailer.current = true;
      } else {
        trailerUnavailableTimer.current = setTimeout(() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast('warning', 'No trailer found', 'Nothing playable for this title yet');
          trailerUnavailableTimer.current = null;
        }, 650);
      }
      return;
    }
    const main = pickMainTrailer(trailers);
    if (main) setSelectedVideo(main.key);
  };

  useEffect(() => {
    if (trailersLoading || !pendingTrailer.current) return;
    pendingTrailer.current = false;
    const main = pickMainTrailer(trailers);
    if (main) {
      setSelectedVideo(main.key);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showToast('warning', 'No trailer found', 'Nothing playable for this title yet');
    }
  }, [trailersLoading, trailers, showToast]);

  const handleCloseVideo = () => {
    setSelectedVideo(null);
  };

  // Auto-trailer intent (hero-section TRAILER buttons route here with it): fire the
  // exact same press flow ~950ms in, after the ticket's dispense has landed — so the
  // story is always sheet appears → lights dim → trailer, never a parallel player.
  const autoTrailerFired = useRef(false);
  const trailerPressRef = useRef<() => void>(() => {});
  trailerPressRef.current = handleTrailerPress;
  useEffect(() => {
    if (!autoTrailer || autoTrailerFired.current) return;
    autoTrailerFired.current = true;
    const t = setTimeout(() => trailerPressRef.current(), 950);
    return () => clearTimeout(t);
  }, [autoTrailer]);

  // Optimize image loading
  const imageUri = React.useMemo(() => {
    if (!images.backdrop && !movie?.backdrop_path) return null;
    return `https://image.tmdb.org/t/p/w1280${images.backdrop || movie?.backdrop_path}`;
  }, [images.backdrop, movie?.backdrop_path]);

  // Generate logo URI
  const logoUri = React.useMemo(() => {
    if (!images.logo) return null;
    return `https://image.tmdb.org/t/p/w500${images.logo}`;
  }, [images.logo]);

  useEffect(() => {
    const loadTrailers = async () => {
      setTrailersLoading(true);
      try {
        const fetchedTrailers = await fetchMovieVideos(movieId);
        setTrailers(fetchedTrailers);
      } catch (error) {
        console.error('Error loading trailers:', error);
      } finally {
        setTrailersLoading(false);
      }
    };

    loadTrailers();
  }, [movieId]);

  // Add back the mainScrollViewRef
  const mainScrollViewRef = useRef<ScrollView>(null);

  if (loading && !imageUri) {
    return (
      <View className="bg-primary flex-1 justify-center items-center">
        <ActivityIndicator size="large" color="#9486ab" />
      </View>
    );
  }

  const toastAccent =
    toast?.kind === 'favorite'
      ? '#9ccadf'
      : toast?.kind === 'removed'
        ? '#ff8a8a'
        : '#FFAE42'; // warning
  return (
    <View className="flex-1 bg-black">
      <StatusBar barStyle="light-content" />

      {/* FIXED backdrop layer — the sheet scrolls OVER this. It parallax-drifts, and a
          full-strength blur + dim fades in with scroll (the glassy focus shift). */}
      <View style={[styles.backdropLayer, { height: heroH }]} pointerEvents="none">
        {imageUri ? (
          <ReAnimated.View style={[StyleSheet.absoluteFill, heroImageAnimatedStyle]}>
            <Image
              source={{ uri: imageUri }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              transition={imageTransitionDuration}
              cachePolicy="memory-disk"
            />
            {/* Top dark gradient for logo visibility */}
            <LinearGradient
              colors={['rgba(0,0,0,0.80)', 'rgba(0.6,0.5,0.3,0.2)', 'transparent']}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '30%' }}
            />
            {/* Bottom gradient dissolves the backdrop into TRUE black — no visible edge
                between the image's end and the dark space below it. */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.9)', '#000']}
              locations={[0, 0.9, 1]}
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '35%' }}
            />
          </ReAnimated.View>
        ) : (
          <View style={{ flex: 1, backgroundColor: PLACEHOLDER_COLOR }} />
        )}

        {/* LIGHTS OUT — cinema-only blur + dim over the backdrop, UNDER the logo, so
            the trailer, logo and rating chip are the only lit things on the screen. */}
        <ReAnimated.View style={[StyleSheet.absoluteFill, cinemaScrimStyle]} pointerEvents="none">
          <BlurView
            intensity={35}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.cinemaDim} />
        </ReAnimated.View>

        {/* Floating logo (or text title fallback) — fades before the sheet reaches it.
            Legibility is LOCAL: a soft shadow pool behind the title band plus an
            iOS letterform shadow — never a full backdrop overlay (that sank the
            ticket into the darkness and killed its floating illusion). */}
        {logoUri && (
          <ReAnimated.View style={[styles.logoContainer, fadeOnScrollStyle]}>
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']}
              locations={[0, 0.32, 0.68, 1]}
              style={styles.logoPool}
              pointerEvents="none"
            />
            <View style={styles.logoShadowWrap}>
              <Image
                source={{ uri: logoUri }}
                style={styles.logoImage}
                contentFit="contain"
                transition={0}
                cachePolicy="memory-disk"
              />
            </View>
          </ReAnimated.View>
        )}
        {!logoUri && movie?.title && (
          <ReAnimated.View style={[styles.logoContainer, fadeOnScrollStyle]}>
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']}
              locations={[0, 0.32, 0.68, 1]}
              style={styles.logoPool}
              pointerEvents="none"
            />
            <Text
              numberOfLines={2}
              style={{
                color: 'white',
                fontSize: 28,
                fontWeight: '800',
                textAlign: 'center',
                letterSpacing: 0.5,
                paddingHorizontal: 24,
                textShadowColor: 'rgba(0, 0, 0, 0.75)',
                textShadowOffset: { width: 0, height: 2 },
                textShadowRadius: 4,
              }}
            >
              {movie.title}
            </Text>
          </ReAnimated.View>
        )}

        {/* The progressive glass — opacity rides the scroll. */}
        <ReAnimated.View style={[StyleSheet.absoluteFill, backdropBlurStyle]}>
          <BlurView
            intensity={60}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.backdropDim} />
        </ReAnimated.View>
      </View>

      {/* THE STAGE — everything that scrolls. Cinema mode slides this whole layer a
          screen-height down (transform-only) so the ticket exits without touching
          scroll position, then brings it back exactly where it was. */}
      <ReAnimated.View style={[styles.stage, stageStyle]}>
      <ScrollView
        ref={mainScrollViewRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        bounces={bounces}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        scrollEnabled={!cinema}
      >
        {/* Transparent spacer — reveals the fixed backdrop above the sheet. */}
        <View style={{ height: heroH - CONTENT_LIFT }} />

        {/* THE TICKET — stub · tear under synopsis · body · tear · barcode footer.
            Dual side notches via one MaskedView (no stacked slices → no scroll seams). */}
        <ReAnimated.View
          style={[styles.sheet, sheetMorphStyle]}
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
        >
          {sheetH > 0 && (
            <MaskedView
              style={[styles.sheetGlass, { width: SCREEN_WIDTH, height: sheetH }]}
              maskElement={
                <View style={{ backgroundColor: 'transparent' }}>
                  <TicketMask
                    width={SCREEN_WIDTH}
                    height={sheetH}
                    notchYs={[
                      tearYSynopsis > 0 ? tearYSynopsis : Math.min(120, sheetH * 0.28),
                      tearYFooter > 0 ? tearYFooter : sheetH - 72,
                    ]}
                  />
                </View>
              }
            >
              <View style={{ width: SCREEN_WIDTH, height: sheetH }}>
                <BlurView
                  intensity={42}
                  tint="dark"
                  experimentalBlurMethod="dimezisBlurView"
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.sheetTint} pointerEvents="none" />
              </View>
            </MaskedView>
          )}

          {tearYSynopsis > 0 && <TicketPerforation width={SCREEN_WIDTH} y={tearYSynopsis} />}
          {tearYFooter > 0 && <TicketPerforation width={SCREEN_WIDTH} y={tearYFooter} />}

          {/* STUB — rating row + synopsis */}
          <View style={styles.ticketStub}>
            {movie && (
              <>
                {/* Snapshot — DATE / RUNTIME / RATED / LANGUAGE. No status pill; a
                    film that isn't out yet wears a tiny "expected" tag under DATE. */}
                <View style={styles.ticketStatRow}>
                  <View style={styles.ticketStat}>
                    <Text style={styles.ticketStatLabel}>Date</Text>
                    <Text style={styles.ticketStatValue} numberOfLines={1} adjustsFontSizeToFit>
                      {releaseDateShort}
                    </Text>
                    {isUpcoming && <Text style={styles.ticketStatSub}>Expected</Text>}
                  </View>
                  <View style={styles.ticketStatDivider} />
                  <View style={styles.ticketStat}>
                    <Text style={styles.ticketStatLabel}>Runtime</Text>
                    <Text style={styles.ticketStatValue} numberOfLines={1} adjustsFontSizeToFit>
                      {movie.formattedRuntime || '—'}
                    </Text>
                  </View>
                  <View style={styles.ticketStatDivider} />
                  <View style={styles.ticketStat}>
                    <Text style={styles.ticketStatLabel}>Rated</Text>
                    <Text style={styles.ticketStatValue} numberOfLines={1} adjustsFontSizeToFit>
                      {movie.certification || 'NR'}
                    </Text>
                  </View>
                  <View style={styles.ticketStatDivider} />
                  <View style={styles.ticketStat}>
                    <Text style={styles.ticketStatLabel}>Language</Text>
                    <Text style={styles.ticketStatValue} numberOfLines={1} adjustsFontSizeToFit>
                      {language}
                    </Text>
                  </View>
                </View>

                {genresLine.length > 0 && (
                  <Text style={styles.ticketGenres}>{genresLine}</Text>
                )}
              </>
            )}

            {/* Synopsis — centered like the rest of the ticket's voice (no label, no
                left-anchored block): collapsed to 2 lines, tap to unfold. */}
            {movie?.overview ? (
              <Pressable
                onPress={synopsisOverflows ? () => setSynopsisExpanded((v) => !v) : undefined}
                style={styles.synopsisBlock}
              >
                <Text style={styles.synopsisBody} numberOfLines={synopsisExpanded ? undefined : 2}>
                  {movie.overview}
                </Text>
                {synopsisOverflows && (
                  <Text style={styles.synopsisMore}>{synopsisExpanded ? 'Show less' : 'Show more'}</Text>
                )}
                {/* Invisible uncapped twin — measures how many lines the overview
                    NEEDS (numberOfLines on the visible text caps what onTextLayout
                    reports, so overflow can't be detected from it directly). */}
                {synopsisLines === null && (
                  <Text
                    style={[styles.synopsisBody, styles.synopsisMeasure]}
                    onTextLayout={(e) => setSynopsisLines(e.nativeEvent.lines.length)}
                  >
                    {movie.overview}
                  </Text>
                )}
              </Pressable>
            ) : null}

            {/* ACTION BLOCK — Trailer · TMDB score · Watchlist, seated below the
                synopsis so the verbs read as ONE cohesive block with the record
                module beneath them. Touchables stay BARE wrappers with all visuals
                on inner Views (Fabric landmine — see PROJECT-PLAN). */}
            {movie && (
              <View style={styles.stubActionRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleTrailerPress}
                  style={styles.stubActionTouch}
                  accessibilityRole="button"
                  accessibilityLabel="Watch trailer"
                  accessibilityState={{ busy: trailersLoading }}
                >
                  <View
                    style={[
                      styles.stubGlassBtn,
                      trailers.length === 0 && !trailersLoading && styles.stubGlassBtnDisabled,
                    ]}
                  >
                    <Ionicons name="play" size={14} color={ink(0.95)} />
                    <Text style={styles.stubGlassLabel} numberOfLines={1}>Trailer</Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.tmdbLogoWrap}>
                  <Image
                    source={require('../../assets/images/TMDB LOGO.svg')}
                    style={styles.tmdbLogo}
                    contentFit="contain"
                  />
                  {movie.vote_average !== undefined && (
                    <View style={styles.tmdbScoreBubble} pointerEvents="none">
                      <Text style={styles.tmdbScore}>{movie.vote_average.toFixed(1)}</Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleToggleFavorite}
                  style={styles.stubActionTouch}
                  accessibilityRole="button"
                  accessibilityLabel={favorited ? 'Remove from watchlist' : 'Add to watchlist'}
                >
                  <View style={styles.stubGlassBtn}>
                    <Ionicons
                      name={favorited ? 'bookmark' : 'bookmark-outline'}
                      size={13}
                      color={favorited ? TICKET_ACCENT : ink(0.95)}
                    />
                    <Text
                      style={[styles.stubGlassLabel, favorited && { color: TICKET_ACCENT }]}
                      numberOfLines={1}
                    >
                      {favorited ? 'Saved' : 'Watchlist'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {/* RECORD MODULE — the stub's closer, below the synopsis (its seat down
                here means it exits the viewport right where the bottom dock appears,
                so the detach reads as the module re-docking, not swapping). Idle =
                the RECORD A TAKE verb; live = the capture panel (Paper 02–07). */}
            {movie && (
              <View style={styles.stubRecordTouch}>
                {capture.status === 'idle' ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleRecordPress}
                    accessibilityRole="button"
                    accessibilityLabel="Record a take"
                  >
                    <View style={styles.stubRecordBtn}>
                      <Ionicons name="mic" size={15} color={ink(0.95)} />
                      <Text style={styles.stubRecordLabel}>RECORD A TAKE</Text>
                      {/* The invitation is a passing light, not a color. */}
                      <ShimmerSweep />
                    </View>
                  </TouchableOpacity>
                ) : (
                  /* The panel stays seated — strip and waveform simply scroll
                     with the page. Only its VERB ROW parallaxes away (driven by
                     dockProgress) as the dock materializes below. */
                  <StubCapturePanel
                    status={capture.status}
                    remainingMs={capture.remainingMs}
                    durationMs={capture.durationMs}
                    level={capture.meterLevel}
                    detachProgress={dockProgress}
                    rowsInert={captureDetached}
                    onCancel={capture.cancel}
                    onPause={capture.pause}
                    onResume={capture.resume}
                    onStartOver={capture.startOver}
                    onDone={capture.done}
                    onDiscard={handleDiscardWithThud}
                  />
                )}
              </View>
            )}
          </View>

          {/* Tear right below the synopsis */}
          <View
            style={styles.tearAnchor}
            onLayout={(e) => {
              const { y, height: h } = e.nativeEvent.layout;
              setTearYSynopsis(y + h / 2);
            }}
          />

          {/* BODY — info tabs or entries */}
          <View style={styles.ticketBody}>
            {movie && view === 'info' && (
              <MemoizedMovieTabBar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                movie={movie}
                onTrailerSelect={(videoKey) => setSelectedVideo(videoKey)}
                scrollViewRef={mainScrollViewRef}
                onSimilarMovieSelect={onOpenMovie}
              />
            )}
            {movie && view === 'entries' && (
              <MovieEntriesTab takes={takes} onChanged={refreshTakes} shrink={barShrink} />
            )}
          </View>

          {/* Tear before the barcode stub */}
          <View
            style={styles.tearAnchor}
            onLayout={(e) => {
              const { y, height: h } = e.nativeEvent.layout;
              setTearYFooter(y + h / 2);
            }}
          />

          {/* FOOTER STUB — barcode + title */}
          <View style={styles.ticketFooter}>
            <Barcode seed={movie?.id ?? 7} />
            {/* No numberOfLines cap — long titles wrap to extra centered lines
                instead of truncating with an ellipsis. */}
            <Text style={styles.ticketFooterTitle}>
              {movie?.title?.toUpperCase()}
            </Text>
          </View>
        </ReAnimated.View>

        {/* Clearance below the ticket so its bottom edge rises above the capture pill. */}
        <View style={{ height: 110 }} />
      </ScrollView>
      </ReAnimated.View>


      {/* Capture chrome — detached dock (bottom) + LIVE/PAUSED badge (top-right).
          Wrapped in one full-screen fade layer so cinema mode dims BOTH out without
          unmounting them: any recording keeps running. */}
      <ReAnimated.View
        style={[StyleSheet.absoluteFill, chromeFadeStyle]}
        pointerEvents={cinema ? 'none' : 'box-none'}
      >
        {/* The dock (Paper 04–05) — the verb row's landing seat, rising and fading
            in step with dockProgress as the panel's row vacates. Mounted for the
            whole take so the glide is continuous and reversible; only TOUCH
            ownership flips (captureDetached). */}
        {capture.status !== 'idle' && (
          <ReAnimated.View
            style={[styles.captureDockWrap, { bottom: insets.bottom + 14 }, dockStyle]}
            pointerEvents={captureDetached ? 'box-none' : 'none'}
          >
            <StubCapturePanel
              docked
              status={capture.status}
              remainingMs={capture.remainingMs}
              durationMs={capture.durationMs}
              level={capture.meterLevel}
              onCancel={capture.cancel}
              onPause={capture.pause}
              onResume={capture.resume}
              onStartOver={capture.startOver}
              onDone={capture.done}
              onDiscard={handleDiscardWithThud}
            />
          </ReAnimated.View>
        )}

        {/* Save confetti — screen-owned, so it plays out even as a dock unmounts. */}
        {confettiBurst > 0 && <ConfettiRain key={confettiBurst} />}

        {/* Rides the top bar's scroll-reactive transform so it folds with the chevron. */}
        {(capture.status === 'recording' || capture.status === 'paused') && (
          <CaptureStatusBadge
            paused={capture.status === 'paused'}
            style={[styles.liveBadge, { top: TOP_BAR_TOP + 2 }]}
            animatedStyle={topBarAnimStyle}
          />
        )}
      </ReAnimated.View>

      {/* Watchlist / warning feedback — NO bubble: an accent icon over a letterspaced
          caps line, rising in and out. Modern, quiet, matches the app's type voice. */}
      {toast && (
        <View style={[styles.toastWrap, { top: TOP_BAR_TOP + 58 }]} pointerEvents="none">
          <ReAnimated.View key={toast.id} entering={FadeInDown.duration(240)} exiting={FadeOut.duration(200)} style={styles.toastRow}>
            <Ionicons
              name={
                toast.kind === 'warning'
                  ? 'alert-circle'
                  : toast.kind === 'removed'
                    ? 'bookmark-outline'
                    : 'bookmark'
              }
              size={15}
              color={toastAccent}
            />
            <Text style={styles.toastTitle}>{toast.title.toUpperCase()}</Text>
          </ReAnimated.View>
        </View>
      )}

      {/* Cinematic 3-2-1 countdown while a take is arming (during the hold). */}
      {capture.status === 'arming' && <CaptureCountdownOverlay secondsLeft={capture.armSecondsLeft} />}

      {/* Top scrim — blur + dark fade that appears in step with the logo fading out, so the
          controls below read clearly over the bright backdrop. */}
      <ReAnimated.View style={[styles.headerScrim, headerScrimStyle]} pointerEvents="none">
        <BlurView
          intensity={32}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(0,0,0,0.78)', 'rgba(0,0,0,0.45)', 'transparent']}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
      </ReAnimated.View>

      {/* Top bar over the hero — close (dismiss the sheet) + the INFO / ENTRIES toggle.
          Both shrink on scroll-down and restore on scroll-up via topBarAnimStyle.
          Cinema mode fades the whole bar and mutes its touches. */}
      <ReAnimated.View
        style={[styles.topBar, { top: TOP_BAR_TOP }, chromeFadeStyle]}
        pointerEvents={cinema ? 'none' : 'box-none'}
      >
        <ReAnimated.View style={topBarAnimStyle}>
          <Pressable
            onPress={onBack}
            hitSlop={10}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={nested ? 'Back' : 'Close'}
          >
            {/* Nested detail slid in from the right → back chevron; root sheet → down. */}
            <Ionicons name={nested ? 'chevron-back' : 'chevron-down'} size={26} color="#fff" style={styles.closeChevron} />
          </Pressable>
        </ReAnimated.View>

        {/* The star (Paper's notch model) replaces the INFO/ENTRIES toggle: a hollow
            cutout until this film has an entry, enrichment prints dots around it,
            and once entries exist it becomes the door — tap to cross into ENTRIES,
            tap again to come back. Hidden while a take is live (the LIVE/PAUSED
            badge owns that corner). */}
        {/* The film's name, centred between the two controls. Absolutely positioned
            so it takes no part in the row's space-between — the chevron and the star
            keep their exact places whatever the title's length. Inset past both so a
            long name is ellipsised rather than running under them, and never
            touchable: the star underneath it stays reachable. */}
        <View style={styles.headerTitleWrap} pointerEvents="none">
          {/* Wrapped in topBarAnimStyle, the SAME style the chevron and the star
              wear, so all three shrink, lift and dim together on scroll-down. It
              was the one thing up here on its own clock, which is exactly why it
              stood apart from them. */}
          <ReAnimated.View style={topBarAnimStyle}>
            <ReAnimated.View style={headerTitleStyle}>
              {/* Long titles scale down to fit rather than being cut off — a name
                  the user cannot finish reading is worse than a slightly smaller
                  one. Below the floor it still ellipsises, as a last resort. */}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                style={styles.headerTitle}
              >
                {movie?.title ?? ''}
              </Text>
            </ReAnimated.View>
          </ReAnimated.View>
        </View>

        <ReAnimated.View style={topBarAnimStyle}>
          {capture.status === 'idle' ? (
            <EntriesStar
              takesCount={takes.length}
              status={takes[0]?.enrich_status ?? null}
              insighted={takes[0]?.insighted_at != null}
              active={view === 'entries'}
              hasNew={newCount > 0}
              onToggle={() => handleSelectView(view === 'entries' ? 'info' : 'entries')}
              onNoEntries={() => showToast('warning', 'No entries yet — record a take first', 'Your takes live here once you speak one')}
            />
          ) : (
            <View style={styles.topBarSpacer} />
          )}
        </ReAnimated.View>
      </ReAnimated.View>

      {/* CINEMA — the trailer cluster ABOVE the logo band (logo stays visible, lit,
          beneath the card). It fades in only after the ticket has cleared the stage. */}
      <TrailerPlayer
        videoId={selectedVideo}
        onClose={handleCloseVideo}
        rating={movie?.certification || 'NR'}
        bottomOffset={LOGO_BOTTOM + 200}
        ratingBottom={LOGO_BOTTOM - 64}
      />
    </View>
  );
};

// Remove unused styles and state
const styles = StyleSheet.create({
  // The fixed backdrop layer the sheet scrolls over. TRUE black base — anything the
  // image doesn't cover blends invisibly with the page behind it.
  backdropLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  backdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,6,10,0.5)',
  },
  // Cinema "lights out" — darker than the scroll glass: the house lights, not a focus shift.
  cinemaDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  // The scroll stage — cinema mode translates this whole layer, so it needs to own
  // the same flex the bare ScrollView had.
  stage: {
    flex: 1,
  },
  // Reference glass ticket — silhouette comes from MaskedView, not stacked fills.
  sheet: {
    transformOrigin: 'top',
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  sheetGlass: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  sheetTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: TICKET_GLASS_TINT,
  },
  ticketStub: {
    paddingTop: 14,
    paddingBottom: 8,
  },
  ticketBody: {
    paddingTop: 4,
    paddingBottom: 18,
  },
  tearAnchor: {
    height: NOTCH_R * 2,
    marginVertical: 2,
  },
  ticketFooter: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 20,
    paddingHorizontal: 28,
    gap: 10,
  },
  ticketFooterTitle: {
    color: ink(0.72),
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.4,
    textAlign: 'center',
    lineHeight: 18,
  },
  barcode: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
  },
  barcodeBar: {
    height: '100%',
    marginRight: 2,
    backgroundColor: ink(0.92),
    borderRadius: 0.5,
  },
  logoContainer: {
    position: 'absolute',
    bottom: LOGO_BOTTOM,
    left: 0,
    right: 0,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  logoImage: {
    width: SCREEN_WIDTH * 0.7,
    height: 100,
  },
  // The local shadow pool — a soft dark band only where the title sits, fading
  // to nothing above and below. The backdrop everywhere else stays untouched.
  logoPool: {
    position: 'absolute',
    top: -34,
    bottom: -34,
    left: 0,
    right: 0,
  },
  // iOS traces the layer's alpha, so this halo follows the LETTERFORMS of the
  // logo PNG — a real drop shadow, not a box. (No elevation: Android would draw
  // a rectangle; the pool carries Android instead.)
  logoShadowWrap: {
    shadowColor: '#000',
    shadowOpacity: 0.85,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  // Rating row (content area): TMDB wordmark + star score (left) · Watchlist / Trailer (right).
  // ── Stub head — primary verb on top, then Trailer · TMDB · Watchlist ───────
  // Record CTA: accent-tinted glass, full-width — the ticket's one loud action.
  stubRecordTouch: {
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 4,
  },
  // Detached dock — bottom-anchored seat for the compact capture panel.
  captureDockWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 850,
  },
  stubRecordBtn: {
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    overflow: 'hidden', // clips the shimmer band
  },
  stubRecordLabel: {
    color: ink(0.95),
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  stubActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 16, // breathing room off the synopsis above
    marginBottom: 2, // the record module's marginTop completes the pair's gap
  },
  // Layout-only on the touchable (Fabric landmine) — visuals live on the inner View.
  stubActionTouch: {
    flex: 1,
  },
  // Liquid glass: translucent white over the ticket — clearly a SUB-CTA, not solid.
  stubGlassBtn: {
    height: 36,
    borderRadius: 12, // rectangle-ish per the Paper flow — squared off from the old full pill

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  stubGlassLabel: {
    color: ink(0.95),
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  stubGlassBtnDisabled: {
    opacity: 0.45,
  },
  tmdbLogoWrap: {
    width: TMDB_LOGO_W,
    height: TMDB_LOGO_H,
  },
  tmdbLogo: {
    width: '100%',
    height: '100%',
  },
  tmdbScoreBubble: {
    position: 'absolute',
    left: TMDB_BUBBLE_LEFT,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tmdbScore: {
    color: TMDB_NAVY,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  // ── Snapshot — the bento voice at the top of the stub ──────────────────────
  ticketStatRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  ticketStat: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  ticketStatLabel: {
    color: ink(0.45),
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  ticketStatValue: {
    color: ink(0.95),
    fontSize: 15,
    fontWeight: '700',
  },
  ticketStatDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 2,
    backgroundColor: ink(0.12),
  },
  // The quiet "not out yet" tag under the DATE column (the shown date = expected).
  ticketStatSub: {
    color: accent(0.9),
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  ticketGenres: {
    color: ink(0.55),
    fontSize: 12,
    textAlign: 'center',
    letterSpacing: 0.3,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  // Recording status readout, top-right (paired with TOP_BAR_TOP).
  liveBadge: {
    position: 'absolute',
    right: 14,
    zIndex: 1001,
  },
  // Action-feedback toast (Save / Trailer) — a small centered glass pill near the top.
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1600,
    elevation: 30,
  },
  // No bubble — a clean icon + letterspaced caps line, legible on its own shadow.
  toastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toastTitle: {
    color: 'rgba(255,255,255,0.94)',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1.6,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  // Scroll-driven scrim behind the top bar — its opacity is animated by headerScrimStyle.
  // Height covers the bar; bump it alongside TOP_BAR_TOP if you move the bar down.
  headerScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: TOP_BAR_TOP + 55,
    zIndex: 999,
  },
  // Top bar over the hero: close button (left) + the INFO / ENTRIES toggle (center).
  topBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Centred on the BAR, not between the buttons, so the title is optically centred
  // on screen even though the chevron and the star are different widths. The insets
  // clear both controls.
  headerTitleWrap: {
    position: 'absolute',
    left: 52,
    right: 52,
    top: 0,
    bottom: 0,
    // Children STRETCH (no alignItems: 'center'). Centring here would shrink them
    // to their content, and the Text would have no width to measure itself against
    // — adjustsFontSizeToFit needs a real box to fit into. Centring is textAlign's
    // job instead.
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
    // Legible for the frames it overlaps the bright backdrop before the scrim is
    // fully in — the same trick the chevron uses.
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  // Bare chevron — no glass bubble; a soft text shadow keeps it legible over posters.
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeChevron: {
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  topBarSpacer: {
    width: 40,
    height: 40,
  },
  glassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  // Segmented INFO / ENTRIES toggle — a glass pill with the active segment highlighted.
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 14,
  },
  toggleItemActive: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  toggleText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  toggleTextActive: {
    color: '#fff',
  },
  toggleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#9ccadf',
  },
  // Semi-collapsed synopsis, just under the hero logo. Horizontal inset matches the meta
  // row + the details card (MovieTabBar) below — everything aligns to a single 20px column.
  // Synopsis — centered, matching the ticket's centered voice (footer title,
  // section headers); no label block, the text speaks for itself.
  synopsisBlock: {
    paddingHorizontal: 20,
    paddingBottom: 6,
    alignItems: 'center',
  },
  synopsisBody: {
    alignSelf: 'stretch',
    color: ink(0.9),
    fontSize: 13.5,
    lineHeight: 20,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  synopsisMore: {
    color: accent(0.85),
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 7,
  },
  // The measuring twin: absolutely positioned at the block's padded width (left/right
  // 20 mirror synopsisBlock's paddingHorizontal) so it wraps identically, invisible
  // and untouchable.
  synopsisMeasure: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 0,
    opacity: 0,
  },
});

const MemoizedMovieDetailsView = React.memo(MovieDetailsView);

const NAV_SLIDE_MS = 280;

/**
 * The route component — a self-contained navigation stack INSIDE the one modal sheet.
 *
 * Only movie IDS are stacked; exactly ONE details view is ever mounted (one hero, one
 * top bar, one capture pill — no stacked layers bleeding through the glass chrome, no
 * idle views burning memory). Tapping a SIMILAR movie swaps the view: the old one
 * slides out left while the new slides in from the right; back reverses both
 * directions and re-mounts the previous id (its data comes back from the API caches).
 * The chevron flips automatically: back arrow while nested, down arrow at the root.
 * A router push can't do this from a modal — it lands BEHIND the sheet — and keeping
 * everything in one sheet means one drag-down still dismisses the whole chain.
 */
const MovieDetailsScreen = () => {
  // `trailer=1` = a hero-section TRAILER button opened this sheet — auto-run the
  // trailer flow on the root layer once the ticket lands.
  const { id, trailer } = useLocalSearchParams();
  const router = useRouter();
  const [movieStack, setMovieStack] = useState<string[]>([String(id)]);

  // +1 = push (new view from the right) · -1 = pop (previous view from the left).
  // A SharedValue so the enter/exit worklets read the CURRENT direction when they
  // fire, not the one captured when the outgoing view was first rendered.
  const navDir = useSharedValue(1);
  // Suppresses the slide on the very first mount (the sheet itself is animating in).
  const hasNavigated = useRef(false);

  const slideEnter = React.useCallback((values: EntryAnimationsValues) => {
    'worklet';
    return {
      initialValues: { originX: values.targetOriginX + navDir.value * SCREEN_WIDTH },
      animations: {
        originX: withTiming(values.targetOriginX, {
          duration: NAV_SLIDE_MS,
          easing: Easing.out(Easing.cubic),
        }),
      },
    };
  }, [navDir]);

  const slideExit = React.useCallback((values: ExitAnimationsValues) => {
    'worklet';
    return {
      initialValues: { originX: values.currentOriginX },
      animations: {
        originX: withTiming(values.currentOriginX - navDir.value * SCREEN_WIDTH, {
          duration: NAV_SLIDE_MS,
          easing: Easing.out(Easing.cubic),
        }),
      },
    };
  }, [navDir]);

  const pushMovie = React.useCallback((movieId: number) => {
    hasNavigated.current = true;
    navDir.value = 1;
    setMovieStack((s) => [...s, String(movieId)]);
  }, [navDir]);

  const popMovie = React.useCallback(() => {
    navDir.value = -1;
    setMovieStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, [navDir]);

  const dismissSheet = React.useCallback(() => {
    router.back();
  }, [router]);

  const depth = movieStack.length;
  const current = movieStack[depth - 1];

  return (
    <View style={{ flex: 1, backgroundColor: 'black', overflow: 'hidden' }}>
      <ReAnimated.View
        // Depth in the key so the same movie can appear twice in one chain; a key
        // change swaps the single mounted view with the directional slide pair.
        key={`level-${depth}-${current}`}
        entering={hasNavigated.current ? slideEnter : undefined}
        exiting={slideExit}
        style={{ flex: 1, backgroundColor: 'black' }}
      >
        <MemoizedMovieDetailsView
          movieId={current}
          nested={depth > 1}
          // Dispense only on the sheet's FIRST open; in-sheet pushes/pops slide instead.
          dispense={depth === 1 && !hasNavigated.current}
          onOpenMovie={pushMovie}
          onBack={depth > 1 ? popMovie : dismissSheet}
          autoTrailer={depth === 1 && !hasNavigated.current && trailer === '1'}
        />
      </ReAnimated.View>
    </View>
  );
};

export default MovieDetailsScreen;
