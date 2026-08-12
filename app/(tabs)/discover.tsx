import React, { useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
  StyleProp,
  ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Animated, {
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import useFetch from "@/services/useFetch";
import {
  fetchMovies,
  fetchNowPlayingMovies,
  fetchMoviesByGenre,
  fetchUpcomingMovies,
  fetchCashCowMovies,
  fetchMoneyPitMovies,
} from "@/services/api";
import { getTrendingMovies } from "@/services/appwrite";
import { useNavMorph } from "@/contexts/NavMorphContext";
import { groundAlpha } from "@/constants/signal";
import { images } from "@/constants/images";

import HeroPoster from "@/components/homepage/HeroPoster";
import TrendingSection from "@/components/homepage/TrendingSection";
import UpcomingMoviesSection from "@/components/homepage/UpcomingMoviesSection";
import BoxOfficeChart from "@/components/homepage/BoxOfficeChart";
import MinimalMovieSection from "@/components/homepage/MinimalMovieSection";
import { Movie, TrendingMovie } from "@/interfaces/interfaces";

const ACCENT = "#9ccadf";

// ── The top-edge glass (replaced the old header card, Bryan 2026-08-12) ──────
// The matte's SOLID band runs the status bar plus this much — through the media
// tabs' block (paddingTop 4 + label-to-underline ~34), and no further. The first
// cut carried the header's air too (56) and read as a wall over the hero; with
// the air trimmed and the ramp tightened the band is ~20% shorter end to end.
const EDGE_SOLID_PAST_INSET = 40;
// The ramp's fixed length below the solid band — same rule as the recents band:
// a fixed distance, not a percentage, so the softness never changes.
const EDGE_FADE = 28;
// How much scroll it takes the band to materialize once the hero's tail nears
// the chrome — a fade distance, not a switch, so it arrives as weather.
const EDGE_APPEAR_RAMP = 60;

// ▸ THE COLLAPSED POSE (Bryan, 2026-08-12: the folded band should be
// "significantly smaller — or just give me configuration knobs"). This is the
// TOTAL height of glass left on screen while the tabs are folded, measured from
// the very top of the screen — status bar included, so it is an absolute pose,
// not an offset from the tab math. The band slides between full and this on the
// fold's own 220ms clock (a translation — a mounted BlurView must never resize).
// 48 is ~45% shorter than the previous folded pose on a Dynamic-Island phone.
// Values smaller than the status-bar inset pull the ramp up under the clock
// itself; bigger values leave more frosted headroom.
const EDGE_FOLDED_H = 75;

// Header collapse tuning (deleted 2026-08-12, restored the same day by Bryan's
// reversal): keep the media tabs visible near the very top, and ignore sub-pixel
// jitter so the fold only reacts to deliberate scrolls.
const TABS_ALWAYS_SHOWN_Y = 16;
const SCROLL_DEAD_ZONE = 6;

// Memoized discovery components (moved here from the old home page)
const MemoizedHeroPoster = React.memo(HeroPoster);
const MemoizedTrendingSection = React.memo(TrendingSection);
const MemoizedUpcomingMoviesSection = React.memo(UpcomingMoviesSection);
const MemoizedBoxOfficeChart = React.memo(BoxOfficeChart);
const MemoizedMinimalMovieSection = React.memo(MinimalMovieSection);

// Genre IDs from TMDB
const DRAMA_GENRE_ID = 18;
const ACTION_GENRE_ID = 28;
const THRILLER_GENRE_ID = 53;
const SCIFI_GENRE_ID = 878;
const COMEDY_GENRE_ID = 35;
const HORROR_GENRE_ID = 27;
const ROMANCE_GENRE_ID = 10749;
const ADVENTURE_GENRE_ID = 12;
const FAMILY_GENRE_ID = 10751;

// Discovery/search scope. Only movies are wired today; shows + books are
// scaffolded as "Soon" so the multi-media structure has a home without faking
// flows that don't exist yet.
const MEDIA_TYPES = [
  { key: "movies", label: "Movies", enabled: true },
  { key: "shows", label: "Shows", enabled: false },
  { key: "books", label: "Books", enabled: false },
] as const;

/**
 * Header content: a centered Movies / Shows / Books toggle (Movies active; Shows/Books
 * are reserved "Soon" scaffolds). The toggle lives in a collapsible wrapper: it folds
 * away on scroll-down and returns on scroll-up. (Deleted 2026-08-12, restored the same
 * day on Bryan's reversal — and the glass band now rides the SAME fold value, so tabs
 * and glass leave and return as one thing.) Search lives in the nav's island.
 */
function SearchEntry({
  tabsStyle,
  onTabsLayout,
}: {
  tabsStyle: StyleProp<ViewStyle>;
  onTabsLayout: (e: LayoutChangeEvent) => void;
}) {
  return (
    <View style={styles.searchEntry}>
      <Animated.View style={[styles.tabsCollapse, tabsStyle]}>
        <View style={styles.mediaToggle} onLayout={onTabsLayout}>
          {MEDIA_TYPES.map((t) => (
            <View key={t.key} style={styles.mediaTab}>
              <Text style={[styles.mediaTabLabel, t.enabled ? styles.mediaTabActive : styles.mediaTabDisabled]}>
                {t.label}
              </Text>
              {t.enabled ? <View style={styles.mediaTabUnderline} /> : <Text style={styles.soonTag}>Soon</Text>}
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * The Discover tab = the former home discovery layout (kept full-bleed) under the
 * masked-glass header. Search left this page entirely — it lives in the nav's
 * island now, and the in-place popup this file used to carry (state, debounce,
 * its own fetchMovies call, a screen of styles) was deleted 2026-08-12 as part
 * of the pre-publish dead-end sweep: none of it had rendered since the popup's
 * Modal was removed.
 */
const Search = () => {
  const insets = useSafeAreaInsets();

  // Nav pill morph: this screen's scroll drives the collapse/expand of the floating nav.
  const { makeScrollHandler } = useNavMorph();
  const navScroll = useMemo(() => makeScrollHandler(), [makeScrollHandler]);

  // --- Discovery data ---
  const { data: trendingMovies, loading: trendingLoading, error: trendingError } = useFetch(getTrendingMovies);
  const { data: nowPlayingMovies, loading: nowPlayingLoading, error: nowPlayingError } = useFetch(fetchNowPlayingMovies);
  const { data: upcomingMovies, loading: upcomingLoading, error: upcomingError } = useFetch(() => fetchUpcomingMovies(10));
  const { data: cashCowMovies, loading: cashCowLoading, error: cashCowError } = useFetch(() => fetchCashCowMovies(6));
  const { data: moneyPitMovies, loading: moneyPitLoading, error: moneyPitError } = useFetch(() => fetchMoneyPitMovies(6));
  const { data: justAddedMovies, loading: justAddedLoading, error: justAddedError } = useFetch(() => fetchMovies({ query: "" }));
  const { data: dramaMovies, loading: dramaLoading, error: dramaError } = useFetch(() => fetchMoviesByGenre(DRAMA_GENRE_ID));
  const { data: actionMovies, loading: actionLoading, error: actionError } = useFetch(() => fetchMoviesByGenre(ACTION_GENRE_ID));
  const { data: thrillerMovies, loading: thrillerLoading, error: thrillerError } = useFetch(() => fetchMoviesByGenre(THRILLER_GENRE_ID));
  const { data: scifiMovies, loading: scifiLoading, error: scifiError } = useFetch(() => fetchMoviesByGenre(SCIFI_GENRE_ID));
  const { data: comedyMovies, loading: comedyLoading, error: comedyError } = useFetch(() => fetchMoviesByGenre(COMEDY_GENRE_ID));
  const { data: horrorMovies, loading: horrorLoading, error: horrorError } = useFetch(() => fetchMoviesByGenre(HORROR_GENRE_ID));
  const { data: romanceMovies, loading: romanceLoading, error: romanceError } = useFetch(() => fetchMoviesByGenre(ROMANCE_GENRE_ID));
  const { data: adventureMovies, loading: adventureLoading, error: adventureError } = useFetch(() => fetchMoviesByGenre(ADVENTURE_GENRE_ID));
  const { data: familyMovies, loading: familyLoading, error: familyError } = useFetch(() => fetchMoviesByGenre(FAMILY_GENRE_ID));

  const boxOfficeLoading = cashCowLoading || moneyPitLoading;
  const boxOfficeError = cashCowError || moneyPitError;
  const minimalSectionsLoading =
    justAddedLoading || dramaLoading || actionLoading || thrillerLoading || scifiLoading ||
    comedyLoading || horrorLoading || romanceLoading || adventureLoading || familyLoading;
  const minimalSectionsError =
    justAddedError || dramaError || actionError || thrillerError || scifiError ||
    comedyError || horrorError || romanceError || adventureError || familyError;

  const discoveryLoading =
    nowPlayingLoading || trendingLoading || upcomingLoading || boxOfficeLoading || minimalSectionsLoading;
  const discoveryError =
    nowPlayingError || trendingError || upcomingError || boxOfficeError || minimalSectionsError;

  // (This tab used to write the most-searched ledger here — the top result at
  // type-time, a guess. The ledger went click-recorded 2026-08-10 (see
  // services/appwrite.ts) and this legacy tab lost its pen: it still READS the
  // trending row, it just no longer pollutes it.)

  // The scroll drives the header from one plain JS onScroll. Two facts come out
  // of it, each written only when it changes or per-frame into a shared value —
  // no React re-renders mid-scroll:
  //
  // ▸ THE BAND IS GATED PAST THE HERO (Bryan, 2026-08-12, second round: constant
  // glass over the hero was "way too obstructive... it should only really appear
  // when we get past this section"). The hero wrapper MEASURES itself, so "past
  // this section" is the same moment on every device — no hardcoded hero height.
  // The band fades in over EDGE_APPEAR_RAMP of scroll, finishing exactly when the
  // hero's tail passes the band's own bottom — the frame non-hero content starts
  // sliding under the chrome and the tabs first need the help.
  //
  // ▸ THE FOLD (deleted, then restored by Bryan's reversal the same day): the
  // media tabs fold away on scroll-down and return on scroll-up — and the glass
  // band rides the SAME `tabsHidden` value, translating up by exactly the room
  // the folded tabs give back. One clock, so the tabs and their glass leave and
  // return as one thing. A TRANSLATION, never a resize: a mounted BlurView must
  // keep its size (resizing re-samples every frame — the recents band's scar),
  // and sliding the band up shortens what's on screen just the same.
  const scrollY = useSharedValue(0);
  const heroBottom = useSharedValue(0); // hero section's bottom edge, content coords

  const tabsHidden = useSharedValue(0);
  const tabsHiddenRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const setTabsHidden = useCallback(
    (hide: boolean) => {
      if (hide === tabsHiddenRef.current) return;
      tabsHiddenRef.current = hide;
      tabsHidden.value = withTiming(hide ? 1 : 0, { duration: 220 });
    },
    [tabsHidden]
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      navScroll(e); // the nav pill's morph keeps its own intent thresholds

      const y = e.nativeEvent.contentOffset.y;
      scrollY.value = y;
      const dy = y - lastScrollYRef.current;
      lastScrollYRef.current = y;

      // Tabs: always shown near the top, otherwise fold by scroll direction (with
      // a small dead-zone so tiny jitters don't toggle it).
      if (y <= TABS_ALWAYS_SHOWN_Y) {
        setTabsHidden(false);
      } else if (Math.abs(dy) >= SCROLL_DEAD_ZONE) {
        setTabsHidden(dy > 0);
      }
    },
    [navScroll, scrollY, setTabsHidden]
  );
  const onHeroLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { y, height } = e.nativeEvent.layout;
      if (height > 0) heroBottom.value = y + height;
    },
    [heroBottom]
  );

  // Measure the tabs' natural height once so the fold can interpolate it → 0 (and
  // the band can translate by the same room) without a hardcoded magic number.
  const tabsNatHeight = useSharedValue(0);
  const onTabsLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) tabsNatHeight.value = h;
    },
    [tabsNatHeight]
  );
  const tabsStyle = useAnimatedStyle(() => {
    // Before the first measure, stay at natural height (no clamp) to avoid a flash.
    if (tabsNatHeight.value === 0) return { opacity: 1 };
    return {
      height: interpolate(tabsHidden.value, [0, 1], [tabsNatHeight.value, 0]),
      opacity: interpolate(tabsHidden.value, [0, 1], [1, 0]),
      marginBottom: interpolate(tabsHidden.value, [0, 1], [8, 0]),
    };
  });

  // Plain numbers for the worklet: the band's full height on this device, and
  // how far it must slide up so exactly EDGE_FOLDED_H of it stays on screen.
  const bandH = insets.top + EDGE_SOLID_PAST_INSET + EDGE_FADE;
  const foldedLift = EDGE_FOLDED_H - bandH; // negative — upward
  const edgeStyle = useAnimatedStyle(() => {
    if (heroBottom.value === 0) return { opacity: 0 }; // unmeasured → hero is up → hidden
    const fullAt = heroBottom.value - bandH;
    return {
      opacity: interpolate(scrollY.value, [fullAt - EDGE_APPEAR_RAMP, fullAt], [0, 1], "clamp"),
      // Slides between the full pose and the configured collapsed pose on the
      // fold's own value — tabs and glass still leave and return as one thing.
      transform: [{ translateY: foldedLift * tabsHidden.value }],
    };
  });

  // The home discovery layout, preserved full-bleed (no in-flow search chrome).
  const DiscoveryContent = useCallback(
    () => (
      <ScrollView
        className="px-5"
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {/* Hero Poster Section — measures itself so the glass band knows where
            "past the hero" begins on this device. */}
        <View className="-mx-5" style={{ marginTop: -20 }} onLayout={onHeroLayout}>
          {nowPlayingMovies && <MemoizedHeroPoster movies={nowPlayingMovies} />}
        </View>

        {dramaMovies && (
          <View style={{ marginTop: 15 }}>
            <MemoizedMinimalMovieSection title="Emotional Powerhouses" movies={dramaMovies} icon="heartbeat" accent="#e57373" />
          </View>
        )}

        {comedyMovies && (
          <View style={{ marginTop: 10 }}>
            <MemoizedMinimalMovieSection title="Laugh-Out-Loud Gems" movies={comedyMovies} icon="smile-o" accent="#4fc3f7" />
          </View>
        )}

        {horrorMovies && (
          <View style={{ marginTop: 10 }}>
            <MemoizedMinimalMovieSection title="Spine-Chilling Nightmares" movies={horrorMovies} icon="warning" accent="#ff5252" />
          </View>
        )}

        {cashCowMovies && moneyPitMovies && (cashCowMovies.length > 0 || moneyPitMovies.length > 0) && (
          <View style={{ marginTop: 16 }}>
            <MemoizedBoxOfficeChart cashCowMovies={cashCowMovies} moneyPitMovies={moneyPitMovies} title="Box Office" />
          </View>
        )}

        {justAddedMovies && (
          <View style={{ marginTop: 15 }}>
            <MemoizedMinimalMovieSection title="Fresh Off The Reel" movies={justAddedMovies} icon="plus-circle" />
          </View>
        )}

        {familyMovies && (
          <View style={{ marginTop: 10 }}>
            <MemoizedMinimalMovieSection title="Fun For Everyone" movies={familyMovies} icon="users" accent="#ba68c8" />
          </View>
        )}

        {romanceMovies && (
          <View style={{ marginTop: 10 }}>
            <MemoizedMinimalMovieSection title="Heart-Stirring Tales" movies={romanceMovies} icon="heart" accent="#f48fb1" />
          </View>
        )}

        {trendingMovies && (
          <View style={{ marginLeft: -20, marginRight: -20, marginTop: 10 }}>
            <MemoizedTrendingSection movies={trendingMovies} title="Trending Movies" />
          </View>
        )}

        {scifiMovies && (
          <View style={{ marginTop: 15 }}>
            <MemoizedMinimalMovieSection title="Mind-Bending Futures" movies={scifiMovies} icon="space-shuttle" accent="#64b5f6" />
          </View>
        )}

        {actionMovies && (
          <View style={{ marginTop: 10 }}>
            <MemoizedMinimalMovieSection title="Adrenaline Rushes" movies={actionMovies} icon="rocket" accent="#81c784" />
          </View>
        )}

        {upcomingMovies && upcomingMovies.length > 0 && (
          <View style={{ marginLeft: -20, marginRight: -20, marginTop: 10 }}>
            <MemoizedUpcomingMoviesSection movies={upcomingMovies} title="Coming Soon" />
          </View>
        )}

        {adventureMovies && (
          <View style={{ marginTop: 15 }}>
            <MemoizedMinimalMovieSection title="Globe-Trotting Quests" movies={adventureMovies} icon="compass" accent="#ffb74d" />
          </View>
        )}

        {thrillerMovies && (
          <View style={{ marginTop: 10 }}>
            <MemoizedMinimalMovieSection title="White-Knuckle Suspense" movies={thrillerMovies} icon="bolt" accent="#ffd54f" />
          </View>
        )}

        <View style={{ marginBottom: 20 }} />
      </ScrollView>
    ),
    [
      nowPlayingMovies,
      trendingMovies,
      upcomingMovies,
      cashCowMovies,
      moneyPitMovies,
      justAddedMovies,
      dramaMovies,
      actionMovies,
      thrillerMovies,
      scifiMovies,
      comedyMovies,
      horrorMovies,
      romanceMovies,
      adventureMovies,
      familyMovies,
      handleScroll,
      onHeroLayout,
    ]
  );

  return (
    <View className="flex-1 bg-primary">
      <Image source={images.bg1} className="absolute w-full z-0" resizeMode="cover" />

      {discoveryLoading ? (
        <View className="flex-1 bg-primary justify-center items-center">
          <ActivityIndicator size="large" color="#9486ab" className="mt-10" />
        </View>
      ) : discoveryError ? (
        <View className="flex-1 justify-center items-center px-8">
          <Text className="text-red-500 text-center">Error: An error occurred while loading content</Text>
        </View>
      ) : (
        <DiscoveryContent />
      )}

      {/* ▸ THE TOP EDGE — the app's standard alpha-masked glass (the recents
          masthead's construction, see search.tsx; EntityHero carries the same),
          replacing this page's original chrome: a rounded card with a hard-cut
          BlurView and a dark gradient band whose bottom edge was always findable.
          A MaskedView whose matte is solid across the status bar + tabs and then
          ramps to transparent wraps a fixed-intensity blur and a ground tint, so
          the blur and the tint dissolve TOGETHER — no edge where the treatment
          stops, nothing to round off or hide.

          GATED PAST THE HERO — see edgeStyle above: invisible while the hero owns
          the screen (the tabs read fine over the poster's own dark top), fading
          in as the hero's tail reaches the chrome, full once ordinary content is
          what slides beneath the tabs. Fixed size, mounted once, only OPACITY
          animates — the BlurView scars (zero-size birth, per-frame resize) still
          cannot apply. */}
      <Animated.View
        style={[styles.edge, { height: insets.top + EDGE_SOLID_PAST_INSET + EDGE_FADE }, edgeStyle]}
        pointerEvents="none"
      >
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <View style={StyleSheet.absoluteFill}>
              <View style={{ height: insets.top + EDGE_SOLID_PAST_INSET, backgroundColor: "#000" }} />
              <LinearGradient colors={["#000", "transparent"]} style={{ flex: 1 }} />
            </View>
          }
        >
          <BlurView
            intensity={22}
            tint="systemUltraThinMaterialDark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          {/* The blur alone leaves bright artwork bright. The tint is what makes the
              band read as the page's own ground closing over the content. */}
          <LinearGradient
            colors={[groundAlpha(0.22), groundAlpha(0.4), groundAlpha(0)]}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      </Animated.View>

      {/* Header content: pinned full-bleed, revealed on load with a slide-down.
          Its media tabs fold away on scroll-down and return on scroll-up, and the
          glass band above follows the same fold. */}
      <Animated.View
        entering={FadeInDown.duration(220)}
        style={[styles.stickyHeader, { paddingTop: insets.top + 4 }]}
        pointerEvents="box-none"
      >
        <SearchEntry tabsStyle={tabsStyle} onTabsLayout={onTabsLayout} />
      </Animated.View>

    </View>
  );
};

export default React.memo(Search);

const styles = StyleSheet.create({
  searchEntry: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 10,
  },
  tabsCollapse: {
    overflow: "hidden",
    marginBottom: 8,
  },
  mediaToggle: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-start",
    gap: 28,
  },
  mediaTab: {
    alignItems: "center",
  },
  mediaTabLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  mediaTabActive: {
    color: "#fff",
  },
  mediaTabDisabled: {
    color: "rgba(255,255,255,0.32)",
    fontWeight: "600",
  },
  mediaTabUnderline: {
    marginTop: 6,
    height: 2,
    width: 22,
    borderRadius: 1,
    backgroundColor: ACCENT,
  },
  soonTag: {
    marginTop: 6,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: "rgba(156,202,223,0.45)",
  },
  // The masked glass band. OUTSIDE the header's own box so its ramp can run past
  // the content without an overflow game; under the header in z so the tabs are
  // never blurred by their own bar. Its height is inline (it needs insets.top).
  edge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 39,
  },
  stickyHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    // No rounded corners, no overflow clipping — the old card silhouette existed
    // to give the hard-edged treatment somewhere to end. The mask has no edge.
  },

});
