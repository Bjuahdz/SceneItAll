import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
  StyleProp,
  ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import useFetch from "@/services/useFetch";
import {
  fetchMovies,
  fetchNowPlayingMovies,
  fetchMoviesByGenre,
  fetchUpcomingMovies,
  fetchCashCowMovies,
  fetchMoneyPitMovies,
} from "@/services/api";
import { getTrendingMovies, updateSearchCount } from "@/services/appwrite";
import { images } from "@/constants/images";

import HeroPoster from "@/components/homepage/HeroPoster";
import TrendingSection from "@/components/homepage/TrendingSection";
import UpcomingMoviesSection from "@/components/homepage/UpcomingMoviesSection";
import BoxOfficeChart from "@/components/homepage/BoxOfficeChart";
import MinimalMovieSection from "@/components/homepage/MinimalMovieSection";
import { Movie, TrendingMovie } from "@/interfaces/interfaces";

const ACCENT = "#9ccadf";

// Cap the popup result list so the card stays "small" and never runs under the
// keyboard (it's anchored near the top).
const POPUP_LIST_MAX_HEIGHT = 340;

// Scroll distance before the readability blur fades in (keeps controls legible once
// content scrolls under the gradient scrim).
const SCROLL_BLUR_Y = 28;

// Header collapse tuning: keep the media tabs visible near the very top, and ignore
// sub-pixel jitter so the fold only reacts to deliberate scrolls.
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
 * are reserved "Soon" scaffolds) above a tappable search bar. The toggle lives in a
 * collapsible wrapper so it can fold away on scroll, leaving just the search bar.
 * Tapping the bar opens the search popup in place — it never navigates away.
 */
function SearchEntry({
  onOpenSearch,
  tabsStyle,
  onTabsLayout,
}: {
  onOpenSearch: () => void;
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

      <Pressable
        onPress={onOpenSearch}
        accessibilityRole="search"
        accessibilityLabel="Search movies"
        style={styles.searchBar}
      >
        <Ionicons name="search" size={16} color="rgba(255,255,255,0.55)" />
        <Text style={styles.searchBarText}>Search movies</Text>
      </Pressable>
    </View>
  );
}

/**
 * Compact result row for the popup: poster thumb + title + year/rating. Tapping
 * opens the movie detail and dismisses the popup.
 */
function ResultRow({ movie, onPress }: { movie: Movie; onPress: () => void }) {
  const year = movie.release_date ? movie.release_date.split("-")[0] : "—";
  const rating = typeof movie.vote_average === "number" ? movie.vote_average.toFixed(1) : "—";

  return (
    <Pressable onPress={onPress} style={styles.resultRow} accessibilityRole="button">
      <Image
        source={{
          uri: movie.poster_path
            ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
            : "https://placehold.co/120x180/1a1a1a/FFFFFF.png",
        }}
        style={styles.resultThumb}
        resizeMode="cover"
      />
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {movie.title}
        </Text>
        <View style={styles.resultMetaRow}>
          <Ionicons name="star" size={12} color={ACCENT} />
          <Text style={styles.resultMeta}>{rating}</Text>
          <Text style={styles.resultMetaDot}>·</Text>
          <Text style={styles.resultMeta}>{year}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
    </Pressable>
  );
}

/**
 * Trending quick-pick row for the popup's empty state — tap to jump straight to a
 * known title (frictionless retrieval), no typing required. Uses TrendingMovie's
 * shape (movie_id + full poster_url) which differs from the TMDB Movie shape.
 */
function SuggestionRow({ movie, onPress }: { movie: TrendingMovie; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.resultRow} accessibilityRole="button">
      <Image
        source={{ uri: movie.poster_url || "https://placehold.co/120x180/1a1a1a/FFFFFF.png" }}
        style={styles.resultThumb}
        resizeMode="cover"
      />
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {movie.title}
        </Text>
        <View style={styles.resultMetaRow}>
          <Ionicons name="trending-up" size={12} color={ACCENT} />
          <Text style={styles.resultMeta}>Trending</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
    </Pressable>
  );
}

/**
 * Search popup: a small frosted card that floats over discovery (no navigation).
 * The backdrop blurs/dims the page; tap outside or "Cancel" to dismiss. Holds the
 * live search field + compact results.
 */
function SearchPopup({
  visible,
  query,
  onChangeQuery,
  results,
  trending,
  loading,
  error,
  onClose,
}: {
  visible: boolean;
  query: string;
  onChangeQuery: (text: string) => void;
  results: Movie[];
  trending: TrendingMovie[];
  loading: boolean;
  error: unknown;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);

  const hasQuery = query.trim().length > 0;

  const openMovie = useCallback(
    (id: number) => {
      onClose();
      router.push(`/movie/${id}`);
    },
    [onClose, router]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={() => inputRef.current?.focus()}
    >
      {/* Backdrop — blurs + dims discovery; tap anywhere outside the card closes. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <BlurView
          intensity={24}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.popupDim} />
      </Pressable>

      {/* Card wrapper is box-none so empty space passes taps through to the backdrop. */}
      <View style={[styles.popupWrap, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <BlurView
          intensity={80}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.popupCard}
        >
          <View style={styles.popupInputRow}>
            <Ionicons name="search" size={18} color="rgba(255,255,255,0.55)" />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={onChangeQuery}
              placeholder="Search movies"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.popupInput}
              autoFocus
              returnKeyType="search"
              autoCorrect={false}
            />
            {hasQuery && (
              <Pressable onPress={() => onChangeQuery("")} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={8} style={styles.popupCancelBtn}>
              <Text style={styles.popupCancel}>Cancel</Text>
            </Pressable>
          </View>

          <View style={styles.popupDivider} />

          {loading ? (
            <View style={styles.popupState}>
              <ActivityIndicator size="small" color={ACCENT} />
            </View>
          ) : error ? (
            <View style={styles.popupState}>
              <Text style={styles.popupError}>Something went wrong</Text>
            </View>
          ) : !hasQuery ? (
            trending.length > 0 ? (
              <FlatList
                data={trending}
                keyExtractor={(item) => `trend-${item.movie_id}`}
                renderItem={({ item }) => (
                  <SuggestionRow movie={item} onPress={() => openMovie(item.movie_id)} />
                )}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                style={{ maxHeight: POPUP_LIST_MAX_HEIGHT }}
                contentContainerStyle={{ paddingBottom: 4 }}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={<Text style={styles.popupSectionLabel}>Trending</Text>}
              />
            ) : (
              <View style={styles.popupState}>
                <Text style={styles.popupHint}>Search movies by title</Text>
              </View>
            )
          ) : results.length === 0 ? (
            <View style={styles.popupState}>
              <Text style={styles.popupHint}>No movies found for “{query.trim()}”</Text>
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => `search-${item.id}`}
              renderItem={({ item }) => <ResultRow movie={item} onPress={() => openMovie(item.id)} />}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={{ maxHeight: POPUP_LIST_MAX_HEIGHT }}
              contentContainerStyle={{ paddingVertical: 4 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </BlurView>
      </View>
    </Modal>
  );
}

/**
 * Search tab = the former home discovery layout (kept full-bleed) under a subtle
 * blurred header. The header slides in once on load; tapping its search bar opens
 * an in-place frosted popup (no navigation) for live search + results.
 */
const Search = () => {
  const insets = useSafeAreaInsets();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // --- Search (manual fetch, debounced below) ---
  const {
    data: searchResults = [],
    loading: searchLoading,
    error: searchError,
    refetch: loadMovies,
    reset,
  } = useFetch(() => fetchMovies({ query: searchQuery }), false);

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

  // Debounce the query; keep feeding the trending counter on results.
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (searchQuery.trim()) {
        await loadMovies();
      } else {
        reset();
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    if (searchResults?.length! > 0 && searchResults?.[0]) {
      updateSearchCount(searchQuery, searchResults[0]);
    }
  }, [searchResults]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    reset();
  }, [reset]);

  // Two scroll-driven effects, both fed by one plain JS onScroll (useAnimatedScrollHandler
  // doesn't fire in this env). Each only writes a SharedValue when its state actually
  // changes — no per-frame work, no React re-renders; the animations run on the UI thread.
  //
  // 1) Readability blur: fade the frosted layer in once content scrolls under the scrim.
  const headerBlur = useSharedValue(0);
  const scrolledRef = useRef(false);
  const headerBlurStyle = useAnimatedStyle(() => ({ opacity: headerBlur.value }));

  // 2) Collapsing tabs: fold the media toggle away on scroll-down, reveal on scroll-up.
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
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastScrollYRef.current;
      lastScrollYRef.current = y;

      // Blur in/out across a fixed threshold.
      const blurred = y > SCROLL_BLUR_Y;
      if (blurred !== scrolledRef.current) {
        scrolledRef.current = blurred;
        headerBlur.value = withTiming(blurred ? 1 : 0, { duration: 200 });
      }

      // Tabs: always shown near the top, otherwise fold by scroll direction (with a
      // small dead-zone so tiny jitters don't toggle it).
      if (y <= TABS_ALWAYS_SHOWN_Y) {
        setTabsHidden(false);
      } else if (Math.abs(dy) >= SCROLL_DEAD_ZONE) {
        setTabsHidden(dy > 0);
      }
    },
    [headerBlur, setTabsHidden]
  );

  // Measure the tabs' natural height once so the fold can interpolate it → 0 without a
  // hardcoded magic number (stays correct across font scales / devices).
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
        {/* Hero Poster Section */}
        <View className="-mx-5" style={{ marginTop: -20 }}>
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

      {/* Seamless header: pinned full-bleed to the top, revealed on load with a slide-down.
          A top-down gradient scrim (dark → transparent, no hard edge) melts it into the
          hero behind it; a blur fades in on scroll for readability. Its media tabs fold
          away as you scroll down (search bar stays). It never overlaps the bottom nav. */}
      <Animated.View
        entering={FadeInDown.duration(220)}
        style={[styles.stickyHeader, { paddingTop: insets.top + 4 }]}
        pointerEvents="box-none"
      >
        {/* Frosted layer — invisible at the top (hero blends through the scrim), fades in
            once you scroll so the controls stay readable over content. */}
        <Animated.View style={[StyleSheet.absoluteFill, headerBlurStyle]} pointerEvents="none">
          <BlurView
            intensity={30}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <LinearGradient
          colors={["rgba(0,0,0,0.82)", "rgba(0,0,0,0.2)", "rgba(0,0,0,0.0)", "rgba(0,0,0,0)"]}
          locations={[0, 0.65, 0.8, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <SearchEntry onOpenSearch={openSearch} tabsStyle={tabsStyle} onTabsLayout={onTabsLayout} />
      </Animated.View>

      <SearchPopup
        visible={searchOpen}
        query={searchQuery}
        onChangeQuery={setSearchQuery}
        results={(searchResults as Movie[]) ?? []}
        trending={(trendingMovies as TrendingMovie[]) ?? []}
        loading={searchLoading}
        error={searchError}
        onClose={closeSearch}
      />
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  searchBarText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
  },
  stickyHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    overflow: "hidden",
    // Round ONLY the bottom corners — the top + sides stay flush to the screen so it
    // reads as a header that melts into the hero, not a detached card. Full-width +
    // fixed radius = the same look on every screen width.
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },

  // --- Search popup ---
  popupDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  popupWrap: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 12,
  },
  popupCard: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(18,18,24,0.6)",
  },
  popupInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  popupInput: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    padding: 0,
  },
  popupCancelBtn: {
    marginLeft: 2,
  },
  popupCancel: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: "600",
  },
  popupDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  popupState: {
    paddingVertical: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  popupHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 14,
  },
  popupSectionLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  popupError: {
    color: "#ff6b6b",
    fontSize: 14,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  resultThumb: {
    width: 42,
    height: 63,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  resultInfo: {
    flex: 1,
  },
  resultTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  resultMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  resultMeta: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
  },
  resultMetaDot: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 12,
  },
});
