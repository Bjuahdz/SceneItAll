import { View, Dimensions, ActivityIndicator, Text, ScrollView, Pressable, StyleSheet, StatusBar, NativeSyntheticEvent, NativeScrollEvent } from 'react-native'
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import ReAnimated, { useSharedValue, useDerivedValue, useAnimatedStyle, interpolate, Extrapolation, withSpring, withTiming, withSequence, Easing, FadeInDown, FadeOut, runOnJS, type EntryAnimationsValues, type ExitAnimationsValues, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router';
import useFetch from '@/services/useFetch';
import { fetchMovieDetails, fetchMovieImages, fetchMovieVideos, pickMainTrailer } from '@/services/api';
import { LinearGradient } from 'expo-linear-gradient';
import MovieTabBar from '@/components/moviedetails/MovieTabBar';
import ArtworkViewer, { type ArtworkSource } from '@/components/moviedetails/ArtworkViewer';
import TrailerPlayer from '../../components/TrailerPlayer';
import { MovieVideo, TabType } from '@/interfaces/interfaces';
import { Image } from 'expo-image'; // Changed to expo-image for better performance
import * as Haptics from 'expo-haptics';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useCaptureSession } from '@/hooks/useCaptureSession';
import { ConfettiRain, DING, RAIN_LIFETIME_MS, THUD } from '@/components/moviedetails/CapturePill';
import CaptureWell, { isCaptureLive } from '@/components/moviedetails/CaptureWell';
import FloatingVerbs from '@/components/moviedetails/FloatingVerbs';
import { useAudioPlayer } from 'expo-audio';
import CaptureCountdownOverlay from '@/components/moviedetails/CaptureCountdownOverlay';
import CaptureStatusBadge from '@/components/moviedetails/CaptureStatusBadge';
import EntriesStar from '@/components/moviedetails/EntriesStar';
import MovieEntriesTab from '@/components/moviedetails/MovieEntriesTab';
import { getTakes, type Take } from '@/services/db';
import { onEnrichmentChanged } from '@/services/enrichment';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Path, Line } from 'react-native-svg';

import { TICKET_GLASS_TINT, TICKET_ACCENT, ink, accent } from '@/components/moviedetails/ticketTheme';
import { NAV_BOTTOM, NAV_SIDE_INSET } from '@/constants/navMetrics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMovieSheet, SHEET_TOP_GAP, SHEET_RADIUS } from '@/contexts/MovieSheetContext';

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
const HERO_RATIO = 0.650;      // hero height as a fraction of the screen. Lower = shorter hero.
const LOGO_BOTTOM = 60;      // logo distance from the hero bottom.
const CONTENT_LIFT = 35;     // px the sheet's rounded top overlaps INTO the backdrop at rest.
// Backdrop blur fade — set to 0 to keep the hero sharp (no progressive glass). Independent
// of the ticket expand morph below.
const BLUR_END = 0;
// Sheet expand distance — how far you scroll before the ticket reaches full scale.
// Keep this > 0 even when BLUR_END is 0 so the card still grows on the way up.
const MORPH_END = 0.5;

// The floating floor's run — same margins as the tab bar's, because the two occupy the
// same footprint. FloatingVerbs and CaptureWell divide exactly this between them.
const FLOOR_RUN_W = Dimensions.get('window').width - NAV_SIDE_INSET * 2;

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
  // Which tab this layer opens on. Only ever SEEDS the local state — the view keeps
  // owning its tab from then on, and reports moves back up via onTabChange. See the
  // stack owner at the foot of this file for why the memory cannot live in here.
  initialTab?: TabType;
  onTabChange?: (tab: TabType) => void;
  // ── Drag-to-dismiss plumbing (the pan itself lives in the stack owner) ──
  // The card's pan. Each level declares ITS OWN Native gesture simultaneous with
  // it — declared from this side because two levels coexist for the 280ms of a
  // push/pop slide, and one shared Native gesture object cannot be attached to
  // two ScrollViews at once.
  sheetPan: PanGesture;
  // Live scroll offset of THIS level's ScrollView — the pan engages only at ≤ top.
  sheetScrollY: SharedValue<number>;
  // 1 while cinema mode or the artwork viewer owns the screen: the sheet must not
  // be draggable out from under a playing trailer or an expanded artwork.
  dragLockSV: SharedValue<number>;
  // True while a drag is displacing the sheet: the inner scroll is disabled so a
  // reversing finger moves the SHEET back up rather than scrolling the content
  // under it. Re-enabled on release (mid-gesture re-enable needs scrollTo, which
  // is dead in Expo Go — lifting the finger is the reset).
  scrollLocked: boolean;
}

/**
 * Hero artwork for one movie, STAMPED with the id it was fetched for.
 *
 * The stamp is what keeps the hero race-free. `artwork.movieId === movieId` doubles
 * as the "we have an answer for THIS movie" signal, so a slow response belonging to
 * a previous movie can never be mistaken for the current one's, and there is no
 * separate settled flag that could drift out of sync with the data.
 *
 * On failure we still store a stamped, all-null record — that flips "settled" so the
 * fallback ladder engages, instead of leaving the hero blank forever.
 */
type HeroArtwork = {
  movieId: string;
  poster: string | null;   // best-ranked textless poster — the full-bleed hero
  backdrop: string | null; // best textless backdrop — used only if there's no poster
  logo: string | null;     // title logo laid over the hero
};

const MovieDetailsView = ({
  movieId,
  nested,
  dispense,
  onOpenMovie,
  onBack,
  autoTrailer,
  initialTab,
  onTabChange,
  sheetPan,
  sheetScrollY,
  dragLockSV,
  scrollLocked,
}: MovieDetailsViewProps) => {
  const [artwork, setArtwork] = useState<HeroArtwork | null>(null);
  // /images has answered for THIS movie — successfully or not. Nothing paints before it.
  const artworkSettled = artwork?.movieId === movieId;
  const { data: movie, loading } = useFetch(() => fetchMovieDetails(movieId));
  const { height } = Dimensions.get('window');
  // Seeded from the stack, then owned here. Every tab move is reported upward so the layer
  // is still on this tab if the user pushes a similar movie and comes back.
  const [activeTab, setActiveTab] = useState<TabType>(initialTab ?? 'details');
  const selectTab = useCallback(
    (tab: TabType) => {
      setActiveTab(tab);
      onTabChange?.(tab);
    },
    [onTabChange]
  );
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
  // Extras artwork the user tapped, if any. Owned here rather than in MovieTabBar
  // because the viewer is a full-screen layer and has to mount OUTSIDE the ScrollView.
  const [expandedArtwork, setExpandedArtwork] = useState<ArtworkSource | null>(null);
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

  // Artwork viewer open → the page's chrome steps aside, same as cinema mode. Declared
  // ABOVE chromeFadeStyle on purpose: a worklet captures its closure when the hook runs,
  // so a shared value declared below would be captured as undefined (see check-worklets).
  const artworkSV = useSharedValue(0);
  useEffect(() => {
    artworkSV.value = withTiming(expandedArtwork ? 1 : 0, {
      // Matches the viewer's own open/close timings so the chrome leaves and returns
      // in step with the card rather than trailing it.
      duration: expandedArtwork ? 320 : 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [expandedArtwork, artworkSV]);

  // A fresh level starts at its own top — the drag gate must not inherit the
  // previous level's scroll depth for the frames before this view's first scroll.
  useEffect(() => {
    sheetScrollY.value = 0;
    // One-shot on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cinema and the artwork viewer own the screen — the sheet must not be
  // draggable out from underneath either. A flag, not an animation.
  useEffect(() => {
    dragLockSV.value = cinema || expandedArtwork !== null ? 1 : 0;
  }, [cinema, expandedArtwork, dragLockSV]);

  // THIS level's half of the drag handshake: its ScrollView's native gesture is
  // declared simultaneous with the card's pan, so at the top of the content a
  // downward pull can feed the pan (which drives the sheet) while the scroll —
  // bounces off, offset clamped at 0 — has nothing to do. Declared per level,
  // from this side; see the sheetPan prop note.
  const scrollNative = React.useMemo(
    () => Gesture.Native().simultaneousWithExternalGesture(sheetPan),
    [sheetPan]
  );

  // The scroll stage sinks one full screen-height — off-stage from ANY scroll position.
  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cinemaSV.value * height }],
  }));
  // Chrome (top bar, header scrim, capture pill/badge) fades out as the stage sinks —
  // and equally when the artwork viewer takes over the screen. Multiplied, so whichever
  // is active hides it and BOTH have to be clear before it comes back.
  const chromeFadeStyle = useAnimatedStyle(() => ({
    opacity: (1 - cinemaSV.value) * (1 - artworkSV.value),
  }));
  // Lights out: the cinema scrim (blur + dim over the backdrop, under the logo)
  // rises with the stage's exit so the logo + trailer become the lit subjects.
  const cinemaScrimStyle = useAnimatedStyle(() => ({
    opacity: cinemaSV.value,
  }));

  // The top bar used to shrink on scroll-down and spring back on scroll-up. It is fixed at
  // full size now: with the title up there permanently, a bar that changes size is a bar
  // whose longest titles change size too — and a name you are mid-way through reading
  // should not move. What the header still does on scroll is FADE IN, which is the part
  // that carries information (the hero's own logo is going away).
  //
  // The scroll DIRECTION is still tracked, because the entries list uses it to close an
  // inline rename when you scroll away from it. Nothing visual reads this any more — if the
  // rename ever moves to its own dismissal, this and its two refs go with it.
  const scrollFold = useSharedValue(0); // 0 = at rest / scrolling up · 1 = scrolling down
  const lastYRef = useRef(0);
  const foldedRef = useRef(false);
  // The scroll no longer bounces AT ALL. The top bounce existed for the hero
  // pull-to-zoom, and that gesture slot now belongs to drag-to-dismiss: with
  // bounces off, a downward pull at offset 0 moves NOTHING inside the sheet, so
  // the card's pan can take the very same finger travel and move the sheet
  // itself — no rubber-banded content fighting the sheet's slide. The zoom (and
  // the bounces state machinery that gated it) retired with the trade.
  // The capture module used to be SEATED in the ticket and hand its verb row off to a
  // bottom dock as it scrolled away — a scroll-driven parallax between two copies of the
  // same row, with a flag deciding which copy was touchable (Paper 04–05). That whole
  // mechanism existed only because the module could leave the viewport. It floats now,
  // so there is nothing to hand off: dockProgress, captureDetached, detachProgress and
  // rowsInert are all gone rather than reimplemented.
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollY.value = y;
    sheetScrollY.value = y; // the drag gate: the card's pan engages only at ≤ top
    const dy = y - lastYRef.current;
    lastYRef.current = y;
    let folded = foldedRef.current;
    if (y <= 6) folded = false;
    else if (Math.abs(dy) > 4) folded = dy > 0;
    if (folded !== foldedRef.current) {
      foldedRef.current = folded;
      scrollFold.value = folded ? 1 : 0; // a flag, not an animation — nothing renders off it
    }
  };

  const heroH = height * HERO_RATIO;

  // FIXED backdrop: STATIC by design — no scroll drift. Moving it exposed the layer
  // beneath as a gray band, and the sheet's expand morph is the one parallax gesture
  // this screen needs. (The pull-down hero ZOOM that used to live here rode the top
  // bounce, and retired with it — pull-down at the top is drag-to-dismiss now.)

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

  // Opacity only. The scrim used to also shrink, lift and scale with the bar; with the bar
  // fixed there is nothing for it to follow, and a header whose height moves is a header
  // whose soft bottom edge moves — which is the one thing that would make the edge visible
  // again.
  const headerScrimStyle = useAnimatedStyle(() => ({
    opacity: headerProgress.value * (1 - cinemaSV.value),
  }));

  // The film's name, on the same band as the glass behind it. It lifts the last few
  // points as it arrives rather than only fading, so it reads as settling onto the
  // scrim instead of being switched on. Cinema mode takes it away with the rest of
  // the chrome — the trailer owns the screen.
  const headerTitleStyle = useAnimatedStyle(() => ({
    opacity: headerProgress.value * (1 - cinemaSV.value),
    transform: [{ translateY: (1 - headerProgress.value) * 6 }],
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

  // Hero artwork. This is the ONLY writer of `artwork` — deliberately.
  //
  // There used to be a second effect that set movie.backdrop_path the moment details
  // arrived, "as a fallback". Because /images returns a far bigger payload than
  // /movie/{id} (a popular film ships 100+ backdrops plus every poster and logo), it
  // normally LOST that race: TMDB's landscape backdrop painted first and then visibly
  // swapped to the poster once /images landed. Coming from Discover the swap was
  // invisible — the hero had already warmed the 30-minute cache — which is why it only
  // showed up on movies reached by search.
  //
  // The fallback now lives in the backdropUri memo, gated behind `artworkSettled`, so
  // there is exactly one decision and nothing paints before it's made.
  React.useEffect(() => {
    if (!movieId) return;
    // Guards against applying a response after this layer has been dismissed.
    let cancelled = false;

    (async () => {
      // Stamped up front so the error path still marks this movie as settled.
      let next: HeroArtwork = { movieId, poster: null, backdrop: null, logo: null };
      try {
        const images = await fetchMovieImages(movieId);
        next = {
          movieId,
          // Prefer a DIFFERENT poster from the one the Discover hero / Trending rail
          // shows, so the detail page has its own face — but only when that runner-up
          // has been independently vetted. `variantPoster` is null whenever it hasn't
          // (see MIN_VETTED_VOTES), and then we reuse the cover rather than reach for
          // a worse image. That null is the entire fix for the old `altPoster` bug.
          poster: images.variantPoster ?? images.poster,
          backdrop: images.backdrops[0] ?? null,
          logo: images.logo,
        };
      } catch (error) {
        console.error(`Error fetching images for movie ${movieId}:`, error);
        // `next` stays all-null but stamped — settled flips, the ladder falls through.
      }
      if (!cancelled) setArtwork(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [movieId]);

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
      adding ? 'Slated' : 'Removed',
      adding ? 'Added to your slate' : 'Off your slate'
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

  // Record entry point — the CaptureWell disc on the floating floor. Same arming path
  // the old pill's idle tap took; only the thing you press has moved.
  const handleRecordPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    capture.start();
  };

  // Tapped play before the trailer list landed → remember it and start the show the
  // moment the fetch resolves (the button + toast show the loading state meanwhile).
  const pendingTrailer = useRef(false);
  // Is a tap still waiting on something? Holds the trailer glyph FILLED until it clears.
  // Set only when there is a REAL wait — when the video list is already in hand the player
  // opens on the same tick and FloatingVerbs' own ping is what acknowledges the press.
  const [trailerBusy, setTrailerBusy] = useState(false);

  const handleTrailerPress = () => {
    if (trailerUnavailableTimer.current) {
      clearTimeout(trailerUnavailableTimer.current);
      trailerUnavailableTimer.current = null;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (trailers.length === 0) {
      setTrailerBusy(true);
      if (trailersLoading) {
        pendingTrailer.current = true;
      } else {
        trailerUnavailableTimer.current = setTimeout(() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast('warning', 'No trailer found', 'Nothing playable for this title yet');
          trailerUnavailableTimer.current = null;
          setTrailerBusy(false);
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
    setTrailerBusy(false);
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

  // The hero image, resolved in ONE place.
  //
  // Nothing paints until /images has answered (`artworkSettled`). That single gate is
  // what removes the double-load: the old code rendered whichever source resolved
  // first and then swapped. A brief empty hero is correct here — a wrong hero that
  // visibly replaces itself is not.
  //
  // Fallback ladder, best first:
  //   1. top-ranked TEXTLESS poster — the approved full-bleed hero
  //   2. top TEXTLESS backdrop      — still language-filtered, just landscape
  //   3. movie.backdrop_path        — TMDB's PRIMARY backdrop, which is NOT
  //                                   language-filtered and can carry a title.
  //                                   Genuinely last resort.
  const imageUri = React.useMemo(() => {
    if (!artworkSettled) return null;
    const path = artwork?.poster ?? artwork?.backdrop ?? movie?.backdrop_path ?? null;
    return path ? `https://image.tmdb.org/t/p/w1280${path}` : null;
  }, [artworkSettled, artwork, movie?.backdrop_path]);

  // Generate logo URI
  const logoUri = React.useMemo(() => {
    if (!artwork?.logo) return null;
    return `https://image.tmdb.org/t/p/w500${artwork.logo}`;
  }, [artwork?.logo]);

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
          <View style={StyleSheet.absoluteFill}>
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
          </View>
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
      <GestureDetector gesture={scrollNative}>
      <ScrollView
        onScroll={handleScroll}
        scrollEventThrottle={16}
        bounces={false}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        scrollEnabled={!cinema && !scrollLocked}
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

            {/* Trailer, Slate and the TMDB score all used to sit here, in a row of
                glass plates below the synopsis. The two verbs now float on their own
                island beside the capture pill (FloatingVerbs), and the score moved into
                the Details tab's bento where the rest of the film's facts live. The stub
                ends at the synopsis on purpose — nothing tappable rides the sheet. */}
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
                setActiveTab={selectTab}
                movie={movie}
                onTrailerSelect={(videoKey) => setSelectedVideo(videoKey)}
                onSimilarMovieSelect={onOpenMovie}
                onExpandArtwork={setExpandedArtwork}
              />
            )}
            {movie && view === 'entries' && (
              <MovieEntriesTab takes={takes} onChanged={refreshTakes} shrink={scrollFold} />
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
      </GestureDetector>
      </ReAnimated.View>


      {/* Capture chrome — detached dock (bottom) + LIVE/PAUSED badge (top-right).
          Wrapped in one full-screen fade layer so cinema mode dims BOTH out without
          unmounting them: any recording keeps running. */}
      <ReAnimated.View
        style={[StyleSheet.absoluteFill, chromeFadeStyle]}
        pointerEvents={cinema || expandedArtwork ? 'none' : 'box-none'}
      >
        {/* THE FLOOR — two islands, the nav's own grammar. Trailer and Slate share a
            pill on the left; the mic is a single glass disc on the right, holding the same
            seat the nav's search satellite does. Tapping the mic grows its recess leftward
            across the island's footprint until the two holes touch, neck and merge into one
            trough holding save / delete / restart / resume.

            The row is a FIXED width and the two islands trade it between them (one reaches
            zero width as the other grows), so the run's total is identical at every frame
            and nothing can drift sideways. `flex-end` bottom-aligns them, which matters
            because the capture pill is taller than the island — it stacks the elapsed clock
            above itself.

            It lives inside the chrome-fade layer so cinema mode and the artwork viewer dim
            it out without unmounting it — a recording in progress must survive both. */}
        {movie && (
          <View style={styles.captureBarWrap} pointerEvents="box-none">
            <View style={styles.floorRow} pointerEvents="box-none">
              <FloatingVerbs
                collapsed={isCaptureLive(capture.status, capture.remainingMs, capture.durationMs)}
                onTrailer={handleTrailerPress}
                trailerDisabled={trailers.length === 0 && !trailersLoading}
                trailerBusy={trailerBusy}
                favorited={favorited}
                onToggleFavorite={handleToggleFavorite}
              />
              <CaptureWell
                status={capture.status}
                remainingMs={capture.remainingMs}
                durationMs={capture.durationMs}
                level={capture.meterLevel}
                onStart={handleRecordPress}
                onCancel={capture.cancel}
                onPause={capture.pause}
                onResume={capture.resume}
                onStartOver={capture.startOver}
                onDone={capture.done}
                onDiscard={handleDiscardWithThud}
              />
            </View>
          </View>
        )}

        {/* Save confetti — screen-owned, so it plays out even as the bar changes pose. */}
        {confettiBurst > 0 && <ConfettiRain key={confettiBurst} />}

        {/* The LIVE / PAUSED readout moved INTO the top bar's own row (it takes the
            star's slot while a take is live). As a floating overlay out here it sat
            under the header scrim and got blurred on scroll, reading as a separate
            thing stuck to the screen rather than part of the bar. */}
      </ReAnimated.View>

      {/* Slate / warning feedback — NO bubble: an accent icon over a letterspaced
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
        {/* THE BLUR IS MASKED, NOT CUT.
            A BlurView simply ends where its box ends, and that edge is a hard switch from
            blurred to sharp — the line that used to run across the poster. MaskedView clips
            by ALPHA, so a vertical gradient mask makes the blur genuinely weaken to nothing
            and there is no boundary to find.

            WHERE THE FADE ENDS IS THE WHOLE BALANCE. Fading it over the scrim's full height
            left a long stretch of WEAK blur, and weak blur over text is not blur — it is
            fog. So the blur is strong and SHORT: full behind the bar, gone by 72% of the
            scrim, and the bottom quarter carries no blur at all, only the tint's tail. The
            fade is still ~40pt long, which is far more than enough to hide the edge. */}
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={['#000', '#000', 'transparent']}
              locations={[0, 0.3, 0.72]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView
            intensity={44}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>

        {/* The darkening dies out on a curve — a straight ramp reads as a band with an end.
            Lighter than it was: with the blur doing more work the tint does not have to,
            and the tint is what greys whatever scrolls under it. */}
        <LinearGradient
          colors={[
            'rgba(0,0,0,0.52)',
            'rgba(0,0,0,0.36)',
            'rgba(0,0,0,0.17)',
            'rgba(0,0,0,0.05)',
            'transparent',
          ]}
          locations={[0, 0.34, 0.58, 0.8, 1]}
          style={StyleSheet.absoluteFill}
        />
      </ReAnimated.View>

      {/* Top bar over the hero — close (dismiss the sheet) + the INFO / ENTRIES toggle.
          Both shrink on scroll-down and restore on scroll-up via topBarAnimStyle.
          Cinema mode fades the whole bar and mutes its touches. */}
      <ReAnimated.View
        style={[styles.topBar, { top: TOP_BAR_TOP }, chromeFadeStyle]}
        // Faded chrome must also stop taking touches — topBar sits at zIndex 1000 and
        // would otherwise keep swallowing taps meant for the viewer beneath it.
        pointerEvents={cinema || expandedArtwork ? 'none' : 'box-none'}
      >
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
          <ReAnimated.View style={headerTitleStyle}>
            {/* Long titles scale down to fit rather than being cut off — a name the user
                cannot finish reading is worse than a slightly smaller one. Below the floor
                it still ellipsises, as a last resort. This is why the bar no longer
                shrinks on scroll: a smaller bar re-runs this fit, so a long name would
                resize under the reader's eye every time the direction changed. */}
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.62}
              style={styles.headerTitle}
            >
              {movie?.title ?? ''}
            </Text>
          </ReAnimated.View>
        </View>

        <View>
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
            /* The take's state takes the star's SLOT while one is live — it is not a
               separately-positioned overlay any more. Sitting in the row means it keeps the
               chevron and the title's exact places and renders above the header scrim
               instead of being blurred by it. */
            <CaptureStatusBadge
              paused={capture.status === 'paused'}
              // State only. The 3·2·1 itself belongs to the full-screen overlay in the
              // middle of the page — counting down here as well read as a second timer.
              arming={capture.status === 'arming'}
            />
          )}
        </View>
      </ReAnimated.View>

      {/* CINEMA — the trailer cluster ABOVE the logo band (logo stays visible, lit,
          beneath the card). It fades in only after the ticket has cleared the stage. */}
      <TrailerPlayer
        videoId={selectedVideo}
        onClose={handleCloseVideo}
        rating={movie?.certification || 'NR'}
        bottomOffset={LOGO_BOTTOM + 350}
        ratingBottom={LOGO_BOTTOM - 64}
      />

      {/* Extras artwork viewer — LAST sibling on purpose, so it stacks above the ticket,
          the capture chrome and the cinema player. It is a plain absoluteFill layer, not
          a Modal: Reanimated shared-value styles don't reach a Modal's separate native
          root on iOS (see ArtworkViewer's header). It also has to live out here rather
          than inside MovieTabBar, which renders within the ScrollView and would clip it. */}
      <ArtworkViewer item={expandedArtwork} onClose={() => setExpandedArtwork(null)} />
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
  // Identical to the tab bar's own wrapper: full width, centred, a fixed NAV_BOTTOM off
  // the hardware edge. It used to be `insets.bottom + 14`, which on a home-indicator
  // phone parked it 28pt ABOVE where the nav sits — the pill was in a different place
  // on the movie screen than on every tab. The pill's margins come from its own PILL_W,
  // so nothing here needs a side inset.
  captureBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: NAV_BOTTOM,
    alignItems: 'center',
    zIndex: 850,
  },
  // The floor's run. `flex-end` twice over, and both matter:
  //   · horizontally, the capture pill is pinned to the right edge no matter how wide the
  //     verbs island happens to be, so opening a label pushes the island LEFT rather than
  //     shoving the mic off the run;
  //   · vertically, the two islands share a baseline — the pill is the taller of the pair
  //     because it stacks the elapsed clock above itself.
  floorRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    width: FLOOR_RUN_W,
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
  // The scrim behind the top bar — its opacity is animated by headerScrimStyle.
  //
  // TALLER THAN THE BAR, BUT ONLY JUST. A fade needs distance — the original 70pt scrim had
  // to go from opaque to nothing in the space the bar itself occupies, which is why it read
  // as a band with a bottom edge. 150 fixed that and overcorrected: everything scrolling
  // under it picked up a haze. 110 is the middle — enough room for the blur to die
  // gracefully, little enough that the stub's stat row stays clear of it.
  headerScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: TOP_BAR_TOP + 95,
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

// ── The sheet's own travel (MovieSheetContext is the clock, these are its ──
//    curves). In: a non-bouncy spring — decisive arrival, no visible wobble,
//    the same family as NAV_SPRING. Out: eased-in timing, so the card
//    accelerates away like a thing released rather than a thing pushed.
const SHEET_IN_SPRING = { damping: 30, stiffness: 280, mass: 1 };
const SHEET_OUT_TIMING = { duration: 300, easing: Easing.in(Easing.cubic) };

// ── The drag grammar (increment 2) ──────────────────────────────────────────
// Pull down at the TOP of the sheet's content and the sheet follows the finger
// — progress becomes a pure function of finger travel, so the background's
// recede, corners and dim reverse in step by construction. Release decides.
const DRAG_ACTIVATE_Y = 10; //  downward travel before the pan claims the touch
const DRAG_FAIL_X = 16; //      sideways travel that hands the touch to a rail
const FLICK_DISMISS_V = 700; // px/s down — a flick dismisses from any depth
const DISMISS_BELOW_P = 0.6; // released beyond 40% of the travel → it leaves…
const REVERSE_RESCUE_V = 60; // …unless the finger was moving back UP this fast
const RELEASE_MIN_V = 900; //   px/s floor when turning release speed into time

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

  // ── THE SHEET PRESENTATION (increment 1 of the card-stack look) ─────────────
  // The route is a TRANSPARENT modal now — the OS mounts it with no animation and
  // this component draws the whole presentation: a rounded card that slides up
  // from below while the screen underneath (still live behind us) recedes. Both
  // movements are pure functions of ONE shared value, `progress`, owned by
  // MovieSheetContext — the recede stage in (tabs) reads the same value, so the
  // sheet and the background cannot disagree on any frame.
  const insets = useSafeAreaInsets();
  const { progress } = useMovieSheet();
  const screenH = Dimensions.get('window').height;
  // The card's top edge: below the status bar, leaving SHEET_TOP_GAP of the
  // receded screen in view — the sliver that says "your place is kept".
  const sheetTop = insets.top + SHEET_TOP_GAP;
  const travel = screenH - sheetTop;

  useEffect(() => {
    progress.value = withSpring(1, SHEET_IN_SPRING);
    return () => {
      // Safety net for any unmount that skipped the animated dismissal (a
      // deep-link replace, a dev reload): never leave the card behind receded.
      progress.value = 0;
    };
    // One-shot on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheetSlideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * travel }],
  }));

  // ── Drag-to-dismiss state (all UI-thread; the pan reads/writes these) ──────
  const sheetScrollY = useSharedValue(0); // current level's scroll offset (the gate)
  const dragLockSV = useSharedValue(0); //   1 while cinema / artwork own the screen
  const dismissingSV = useSharedValue(0); // 1 once an exit is committed — pan goes inert
  const engaged = useSharedValue(0); //      1 while a finger is driving the sheet
  const engageTy = useSharedValue(0); //     pan translationY at the engage frame
  const engageP = useSharedValue(1); //      progress at the engage frame
  // While engaged, the inner scroll is disabled so a reversing finger moves the
  // SHEET back up instead of scrolling content under a displaced card. One
  // render at engage and one at release — the drag itself never touches React.
  const [scrollLocked, setScrollLocked] = useState(false);

  // +1 = push (new view from the right) · -1 = pop (previous view from the left).
  // A SharedValue so the enter/exit worklets read the CURRENT direction when they
  // fire, not the one captured when the outgoing view was first rendered.
  const navDir = useSharedValue(1);
  // Suppresses the slide on the very first mount (the sheet itself is animating in).
  const hasNavigated = useRef(false);

  // Which tab each level of the chain was left on, parallel to movieStack.
  //
  // This HAS to live up here. Only one details view is mounted, and its key changes on
  // every push and pop, so the view unmounts and its own tab state dies with it — going
  // back from a similar movie dumped you on Details even though you left from Similar. The
  // stack owner already holds the ids; it holds the tabs the same way.
  //
  // A ref, not state: nothing here should cause a render, and the value is only ever read
  // while rendering a level that has just changed for another reason.
  const tabStack = useRef<TabType[]>(['details']);
  // The live depth, so the callbacks below can stay referentially stable — a new identity
  // each render would defeat the memo on the details view.
  const depthRef = useRef(1);

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

  const rememberTab = React.useCallback((tab: TabType) => {
    tabStack.current[depthRef.current - 1] = tab;
  }, []);

  const pushMovie = React.useCallback((movieId: number) => {
    hasNavigated.current = true;
    navDir.value = 1;
    // A new movie always opens on Details — remembering a tab is about returning to a
    // layer you left, not about carrying your last choice onto a film you have not seen.
    tabStack.current[depthRef.current] = 'details';
    setMovieStack((s) => [...s, String(movieId)]);
  }, [navDir]);

  const popMovie = React.useCallback(() => {
    navDir.value = -1;
    setMovieStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    // Drop the level being left so a later visit to the same movie starts on Details
    // rather than inheriting a tab from a trip the user has already backed out of.
    // Outside the updater on purpose: a state updater must stay pure.
    if (depthRef.current > 1) tabStack.current.length = depthRef.current - 1;
  }, [navDir]);

  // Dismissal animates the sheet home FIRST, then pops the route — the route
  // itself unmounts with no OS animation, so by the time it goes there must be
  // nothing left on screen to vanish. Guarded against a double chevron tap:
  // two `router.back()`s would pop the screen under this one too.
  const dismissing = useRef(false);
  const finishDismiss = React.useCallback(() => {
    router.back();
  }, [router]);
  const markDismissing = React.useCallback(() => {
    dismissing.current = true;
  }, []);
  const resetDismissing = React.useCallback(() => {
    dismissing.current = false;
    dismissingSV.value = 0;
  }, [dismissingSV]);
  const dismissSheet = React.useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    dismissingSV.value = 1; // the pan must not catch a sheet the chevron sent home
    progress.value = withTiming(0, SHEET_OUT_TIMING, (finished) => {
      if (finished) {
        runOnJS(finishDismiss)();
      } else {
        // Interrupted (nothing else writes this value today, but a stuck guard
        // would make the sheet undismissable — cheap insurance).
        runOnJS(resetDismissing)();
      }
    });
  }, [progress, dismissingSV, finishDismiss, resetDismissing]);

  // ── THE PAN — the sheet's drag grammar, one gesture on the whole card. ─────
  //
  // It activates on DRAG_ACTIVATE_Y of downward travel (upward drags never wake
  // it; DRAG_FAIL_X of sideways travel hands the touch to the Similar rail /
  // extras / swipeable take cards) and runs SIMULTANEOUS with each level's
  // ScrollView. Activation is not engagement: the pan drives nothing until the
  // frame where the content sits at its top AND the finger is moving down — so
  // a long upward-scroll that reaches the top mid-stroke hands its remaining
  // travel straight to the sheet, with the translation at that frame as the
  // baseline. From engagement on, progress = engageP − drag/travel: the sheet,
  // the recede, the corners and the dim all track the finger because they are
  // all already functions of progress.
  //
  // Release: a downward flick (FLICK_DISMISS_V) or resting past DISMISS_BELOW_P
  // commits the exit at the finger's own speed (never slower than RELEASE_MIN_V,
  // clamped 140–300ms); anything else — including a deep drag flicked back UP —
  // snaps home on the seating spring, inheriting the release velocity.
  //
  // Built once (useMemo, all deps stable): the scrollLocked render at engage
  // must not rebuild a gesture that is mid-touch.
  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(DRAG_ACTIVATE_Y)
        .failOffsetX([-DRAG_FAIL_X, DRAG_FAIL_X])
        .onUpdate((e) => {
          if (dismissingSV.value === 1 || dragLockSV.value === 1) return;
          if (engaged.value === 0) {
            if (sheetScrollY.value <= 1 && e.velocityY > 0) {
              engaged.value = 1;
              engageTy.value = e.translationY;
              engageP.value = progress.value;
              runOnJS(setScrollLocked)(true);
            }
            return;
          }
          const drag = e.translationY - engageTy.value;
          const next = engageP.value - drag / travel;
          progress.value = Math.min(1, Math.max(0, next));
        })
        .onEnd((e) => {
          if (engaged.value === 0) return;
          engaged.value = 0;
          runOnJS(setScrollLocked)(false);
          if (dismissingSV.value === 1 || dragLockSV.value === 1) return;
          const p = progress.value;
          const flung = e.velocityY > FLICK_DISMISS_V;
          const past = p < DISMISS_BELOW_P && e.velocityY > -REVERSE_RESCUE_V;
          if (flung || past) {
            dismissingSV.value = 1;
            runOnJS(markDismissing)();
            // Finish at the finger's speed: remaining distance over release
            // velocity, floored so a rest-release still leaves decisively.
            const vEff = Math.max(e.velocityY, RELEASE_MIN_V);
            const ms = Math.min(300, Math.max(140, ((p * travel) / vEff) * 1000));
            progress.value = withTiming(
              0,
              { duration: ms, easing: Easing.out(Easing.quad) },
              (finished) => {
                if (finished) runOnJS(finishDismiss)();
              }
            );
          } else {
            // Home, inheriting the finger's velocity (px/s → progress/s, sign
            // flipped because up-finger = rising progress).
            progress.value = withSpring(1, { ...SHEET_IN_SPRING, velocity: -e.velocityY / travel });
          }
        })
        .onFinalize(() => {
          // Touch cancelled without onEnd (a system gesture stole it): release
          // the lock and re-seat — never leave the sheet parked mid-air.
          if (engaged.value === 1) {
            engaged.value = 0;
            runOnJS(setScrollLocked)(false);
            if (dismissingSV.value === 0) progress.value = withSpring(1, SHEET_IN_SPRING);
          }
        }),
    [
      travel,
      progress,
      sheetScrollY,
      dragLockSV,
      dismissingSV,
      engaged,
      engageTy,
      engageP,
      finishDismiss,
      markDismissing,
    ]
  );

  const depth = movieStack.length;
  const current = movieStack[depth - 1];
  depthRef.current = depth;

  return (
    // The stage is TRANSPARENT — the receded card (the screen we came from) shows
    // through everywhere the sheet isn't.
    <View style={{ flex: 1 }}>
      {/* The sliver of the old screen above the sheet is DEAD ground, like the
          native card stack's: this swallows those taps so nothing on the receded
          card can be pressed through the gap. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => {}} accessible={false} />

      {/* THE SHEET CARD — rounded top corners, clipped, parked below the status
          bar. Its slide and the background's recede read the same shared value;
          the pan on this card is what lets a finger drive that value directly. */}
      <GestureDetector gesture={pan}>
      <ReAnimated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: sheetTop,
            height: travel,
            borderTopLeftRadius: SHEET_RADIUS,
            borderTopRightRadius: SHEET_RADIUS,
            overflow: 'hidden',
            backgroundColor: 'black',
          },
          sheetSlideStyle,
        ]}
      >
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
            // Read at mount, and the view is remounted on every level change — which is
            // exactly what makes coming back land on the tab that was left.
            initialTab={tabStack.current[depth - 1] ?? 'details'}
            onTabChange={rememberTab}
            sheetPan={pan}
            sheetScrollY={sheetScrollY}
            dragLockSV={dragLockSV}
            scrollLocked={scrollLocked}
          />
        </ReAnimated.View>
      </ReAnimated.View>
      </GestureDetector>
    </View>
  );
};

export default MovieDetailsScreen;
