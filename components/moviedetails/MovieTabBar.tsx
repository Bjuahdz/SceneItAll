/**
 * MovieTabBar Component
 * 
 * A comprehensive tab-based interface for displaying movie details, cast, extras, and similar movies.
 * Features a modern UI with animations, collapsible sections, and media galleries.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type GestureResponderEvent,
} from 'react-native';
// expo-image, not RN's Image: the rails need `cachePolicy="memory-disk"` so leaving
// the tab and coming back doesn't re-download the whole gallery, plus recyclingKey
// so FlatList can reuse card views without flashing the previous movie's art.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchMovieVideos, fetchMovieImages } from '../../services/api';
import { useState, useEffect, useMemo, useCallback } from 'react';
import MovieDetailsTab from './MovieDetailsTab';
import MovieCastTab from './MovieCastTab';
import MovieSimilarTab from './MovieSimilarTab';
import { type ArtworkSource } from './ArtworkViewer';
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  MovieTabBarProps,
  TabType,
  MovieVideo
} from '../../interfaces/interfaces';

// Shared rhythm under the tab strip — every tab starts and spaces the same way.
const TAB_CONTENT_TOP = 16;
const TAB_SECTION_GAP = 24;
const SECTION_TITLE_GAP = 12;

// Downloading + sharing moved into ArtworkViewer along with the tap target. Tapping a
// card used to go STRAIGHT to the OS share sheet, which meant there was no way to
// actually look at the artwork, and saving it took two taps. Now the card expands and
// owns both actions, one tap each.

/**
 * NOTE: These sections live at MODULE scope on purpose. When they were declared
 * inside MovieTabBar's body, every parent re-render minted a brand-new component
 * type, so React unmounted + remounted each section — loading state reset, the
 * fetch effects re-ran, and the whole Extras tab flickered uncontrollably.
 */

// ── Extras rails ────────────────────────────────────────────────────────────
// All three rails are virtualized and paged.
//
// Paging here buys NO API calls: /movie/{id}/images returns every file path in a
// single response, so the full list is already in memory and cached — "load more"
// is a setState, never a request. It exists to bound how many full-size images we
// pull over the network. A big release carries ~200 textless backdrops (Supergirl:
// 197 backdrops + 38 posters ≈ 22 MB) and the old plain ScrollView mounted every
// card the moment the tab opened, firing all of that in one burst.
//
// FlatList does the real work — only cards near the viewport mount, so downloads
// follow the swipe. RAIL_PAGE caps the worst case on top of that.
const RAIL_PAGE = 12;
const RAIL_GAP = 12;       // must match extrasStyles.rail's `gap` — getItemLayout depends on it
const WIDE_CARD_W = 280;   // trailers + backdrops
const WIDE_CARD_H = 160;
const POSTER_CARD_W = 120;
const POSTER_CARD_H = 180;

// The floating viewer expands with a UNIFORM scale, so its card must share the rail
// card's aspect exactly — otherwise the image visibly stretches on the way out and back.
const WIDE_ASPECT = WIDE_CARD_W / WIDE_CARD_H;
const POSTER_ASPECT = POSTER_CARD_W / POSTER_CARD_H;

// Shared FlatList tuning: small batches keep the JS thread free while swiping, and
// removeClippedSubviews lets RN detach off-screen cards from the native view tree.
const railProps = {
  horizontal: true as const,
  showsHorizontalScrollIndicator: false,
  initialNumToRender: 4,
  maxToRenderPerBatch: 4,
  windowSize: 3,
  // Android only. On iOS this detaches card views from the native hierarchy for little
  // benefit, and detached views break anything that needs to read their geometry — it
  // is what silently killed the first version of the artwork tap. Virtualization
  // (windowSize / maxToRenderPerBatch) already does the real work on both platforms.
  removeClippedSubviews: Platform.OS === 'android',
};

// Card widths are fixed, so hand FlatList the geometry instead of making it measure
// every card — no per-card layout pass, and no scroll jitter as views recycle.
const railLayout = (cardWidth: number) => (_data: unknown, index: number) => ({
  length: cardWidth + RAIL_GAP,
  offset: (cardWidth + RAIL_GAP) * index,
  index,
});

/**
 * Reveals RAIL_PAGE items at a time from a list that is ALREADY in memory. Resets
 * when the source list changes, so switching movies never inherits the previous
 * movie's expanded state.
 */
const usePagedRail = <T,>(items: T[]) => {
  const [shown, setShown] = useState(RAIL_PAGE);
  useEffect(() => setShown(RAIL_PAGE), [items]);
  const visible = useMemo(() => items.slice(0, shown), [items, shown]);
  const loadMore = useCallback(() => setShown((n) => n + RAIL_PAGE), []);
  return { visible, loadMore, remaining: Math.max(0, items.length - shown) };
};

/**
 * A rail card that reports its on-screen rect when tapped, so the viewer can expand
 * FROM it and collapse back TO it — even after the rail has been scrolled.
 *
 * The rect is derived from the TOUCH, not from measureInWindow. `pageX/pageY` is the
 * touch in window coordinates and `locationX/locationY` is that same point relative to
 * this card, so the difference is the card's top-left corner. Width and height are the
 * constants that also drive the card styles, so the rect is exact.
 *
 * The first version used `measureInWindow` and did nothing when it returned zeros. It
 * returned zeros constantly: FlatList's removeClippedSubviews detaches card views from
 * the native hierarchy, and a detached view measures as 0×0. The guard then swallowed
 * every tap — no error, no viewer, no clue. This way is synchronous, has no failure
 * mode, and cannot silently drop a tap.
 *
 * The press target exactly covers the card, which is what keeps locationX/locationY
 * card-relative rather than relative to some inner image.
 */
const RailCard = ({
  style,
  cardWidth,
  cardHeight,
  onExpand,
  children,
}: {
  style: StyleProp<ViewStyle>;
  cardWidth: number;
  cardHeight: number;
  onExpand: (origin: { x: number; y: number; width: number; height: number }) => void;
  children: React.ReactNode;
}) => {
  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      onExpand({
        x: pageX - locationX,
        y: pageY - locationY,
        width: cardWidth,
        height: cardHeight,
      });
    },
    [cardWidth, cardHeight, onExpand]
  );

  // Structure is deliberately identical to the trailers rail (a sized View wrapping an
  // absoluteFill TouchableOpacity). The touch target exactly covers the card either
  // way, so locationX/locationY stay card-relative — but this is the markup that is
  // known to lay out correctly inside a horizontal FlatList here, and swapping it for a
  // bare Pressable is not worth the risk for a press-opacity nicety.
  return (
    <View style={style}>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.85} style={StyleSheet.absoluteFill}>
        {children}
      </TouchableOpacity>
    </View>
  );
};

/** Tail tile that reveals the next page. Icon AND label — never an icon alone. */
const LoadMoreCard = ({
  remaining,
  onPress,
  style,
}: {
  remaining: number;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
}) => (
  <TouchableOpacity
    onPress={onPress}
    style={[style, extrasStyles.loadMoreCard]}
    accessibilityRole="button"
    accessibilityLabel={`Load ${remaining} more`}
  >
    <Ionicons name="add-circle-outline" size={24} color="rgba(255,255,255,0.75)" />
    <Text style={extrasStyles.loadMoreLabel}>Load more</Text>
    <Text style={extrasStyles.loadMoreCount}>{remaining} left</Text>
  </TouchableOpacity>
);

/**
 * YouTube only guarantees hqdefault — maxresdefault 404s on older and unofficial
 * uploads. Start high (it's the only true 16:9 size; hqdefault is 4:3 letterboxed
 * and would show black bars in a 280×160 card) and step down once if it's missing.
 */
const TrailerThumb = ({ videoKey }: { videoKey: string }) => {
  const [fallback, setFallback] = useState(false);
  return (
    <Image
      source={{
        uri: `https://img.youtube.com/vi/${videoKey}/${fallback ? 'hqdefault' : 'maxresdefault'}.jpg`,
      }}
      style={extrasStyles.cardImage}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      recyclingKey={videoKey}
      onError={() => setFallback(true)}
    />
  );
};

/**
 * TrailersSection Component
 * Fetches and displays movie trailers with YouTube thumbnails
 */
const TrailersSection = ({
  movieId,
  onTrailerSelect,
}: { movieId: string; onTrailerSelect: (videoKey: string) => void }) => {
  const [videos, setVideos] = useState<MovieVideo[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch trailers on component mount.
  // `cancelled` is defensive rather than a fix for an observed bug: today the detail
  // layer is keyed by movie id, so this remounts per movie and `movieId` never changes
  // under a request in flight. The guard keeps that true if the keying ever changes,
  // and stops a response landing after the sheet is dismissed.
  useEffect(() => {
    let cancelled = false;

    const loadVideos = async () => {
      try {
        const fetchedVideos = await fetchMovieVideos(movieId);
        if (!cancelled) setVideos(fetchedVideos);
      } catch (error) {
        console.error('Error loading videos:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadVideos();
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  // Above the early returns — hook order has to be identical on every render.
  const { visible, loadMore, remaining } = usePagedRail(videos);

  if (loading) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>Loading trailers...</Text>
      </View>
    );
  }

  if (videos.length === 0) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>No trailers available</Text>
      </View>
    );
  }

  return (
    <FlatList
      {...railProps}
      data={visible}
      keyExtractor={(item) => item.id}
      getItemLayout={railLayout(WIDE_CARD_W)}
      contentContainerStyle={extrasStyles.rail}
      ListFooterComponent={
        remaining > 0 ? (
          <LoadMoreCard remaining={remaining} onPress={loadMore} style={extrasStyles.wideCard} />
        ) : null
      }
      renderItem={({ item: video }) => (
        <TouchableOpacity onPress={() => onTrailerSelect(video.key)} style={extrasStyles.wideCard}>
          <TrailerThumb videoKey={video.key} />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={extrasStyles.trailerScrim}
          >
            <Text style={extrasStyles.trailerName}>{video.name}</Text>
            <Text style={extrasStyles.trailerMeta}>
              {video.type} • {new Date(video.published_at).toLocaleDateString()}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      )}
    />
  );
};

/**
 * BackdropsSection Component
 * Displays movie backdrop images — tap shares the full-res image directly.
 */
const BackdropsSection = ({
  movieId,
  onExpand,
}: {
  movieId: string;
  onExpand: (item: ArtworkSource) => void;
}) => {
  const [backdrops, setBackdrops] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false; // see the note on TrailersSection's effect

    const loadBackdrops = async () => {
      try {
        // Shared artwork call — the hero and the detail backdrop already made it for
        // this movie, so opening Extras hits the 30-minute cache instead of the network.
        const { backdrops: textless } = await fetchMovieImages(movieId);
        if (!cancelled) setBackdrops(textless);
      } catch (error) {
        console.error('Error loading backdrops:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadBackdrops();
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  // Above the early returns — hook order has to be identical on every render.
  const { visible, loadMore, remaining } = usePagedRail(backdrops);

  if (loading) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>Loading backdrops...</Text>
      </View>
    );
  }

  if (backdrops.length === 0) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>No backdrops available</Text>
      </View>
    );
  }

  return (
    <FlatList
      {...railProps}
      data={visible}
      keyExtractor={(item) => item}
      getItemLayout={railLayout(WIDE_CARD_W)}
      contentContainerStyle={extrasStyles.rail}
      ListFooterComponent={
        remaining > 0 ? (
          <LoadMoreCard remaining={remaining} onPress={loadMore} style={extrasStyles.wideCard} />
        ) : null
      }
      renderItem={({ item: backdrop }) => (
        <RailCard
          style={extrasStyles.wideCard}
          cardWidth={WIDE_CARD_W}
          cardHeight={WIDE_CARD_H}
          onExpand={(origin) =>
            onExpand({
              // w1280 for viewing: big enough to actually study on a phone, far short
              // of `original`, which runs several MB. Original is fetched only if the
              // user downloads or shares.
              viewUri: `https://image.tmdb.org/t/p/w1280${backdrop}`,
              originalUri: `https://image.tmdb.org/t/p/original${backdrop}`,
              aspect: WIDE_ASPECT,
              fileName: 'backdrop_image.jpg',
              label: 'Backdrop',
              origin,
            })
          }
        >
          {/* w780 is deliberate, not lazy: the card is 280pt wide, which is 840px on
              a 3× screen. Anything smaller would visibly soften. */}
          <Image
            source={{ uri: `https://image.tmdb.org/t/p/w780${backdrop}` }}
            style={extrasStyles.cardImage}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={backdrop}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.3)']}
            style={extrasStyles.hintScrim}
          >
            <Text style={extrasStyles.hintText}>View</Text>
          </LinearGradient>
        </RailCard>
      )}
    />
  );
};

/**
 * PostersSection Component
 * Displays movie poster images — tap shares the full-res image directly.
 */
const PostersSection = ({
  movieId,
  onExpand,
}: {
  movieId: string;
  onExpand: (item: ArtworkSource) => void;
}) => {
  const [posters, setPosters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false; // see the note on TrailersSection's effect

    const loadPosters = async () => {
      try {
        // Same shared, cached call as the hero — so the gallery leads with the same
        // well-vetted art the cover uses instead of TMDB's raw single-vote-first order.
        const { posters: textless } = await fetchMovieImages(movieId);
        if (!cancelled) setPosters(textless);
      } catch (error) {
        console.error('Error loading posters:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPosters();
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  // Above the early returns — hook order has to be identical on every render.
  const { visible, loadMore, remaining } = usePagedRail(posters);

  if (loading) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>Loading posters...</Text>
      </View>
    );
  }

  if (posters.length === 0) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>No posters available</Text>
      </View>
    );
  }

  return (
    <FlatList
      {...railProps}
      data={visible}
      keyExtractor={(item) => item}
      getItemLayout={railLayout(POSTER_CARD_W)}
      contentContainerStyle={extrasStyles.rail}
      ListFooterComponent={
        remaining > 0 ? (
          <LoadMoreCard remaining={remaining} onPress={loadMore} style={extrasStyles.posterCard} />
        ) : null
      }
      renderItem={({ item: poster }) => (
        <RailCard
          style={extrasStyles.posterCard}
          cardWidth={POSTER_CARD_W}
          cardHeight={POSTER_CARD_H}
          onExpand={(origin) =>
            onExpand({
              viewUri: `https://image.tmdb.org/t/p/w780${poster}`,
              originalUri: `https://image.tmdb.org/t/p/original${poster}`,
              aspect: POSTER_ASPECT,
              fileName: 'poster_image.jpg',
              label: 'Poster',
              origin,
            })
          }
        >
          {/* w342 ≈ the 120pt card at 3× — right-sized, not downscaled waste. */}
          <Image
            source={{ uri: `https://image.tmdb.org/t/p/w342${poster}` }}
            style={extrasStyles.cardImage}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={poster}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.3)']}
            style={extrasStyles.hintScrim}
          >
            <Text style={extrasStyles.hintText}>View</Text>
          </LinearGradient>
        </RailCard>
      )}
    />
  );
};

// Shared look for the three extras rails — one definition instead of three
// copies of the same inline objects.
const extrasStyles = StyleSheet.create({
  stateBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    height: 180,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  rail: {
    gap: 12,
    paddingRight: 20,
  },
  wideCard: {
    // Shared with railLayout AND with WIDE_ASPECT (the viewer's expand geometry) —
    // one value, never three.
    width: WIDE_CARD_W,
    height: WIDE_CARD_H,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  posterCard: {
    // Shared with railLayout AND with POSTER_ASPECT — one value, never three.
    width: POSTER_CARD_W,
    height: POSTER_CARD_H,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  // No resizeMode here — expo-image takes `contentFit` as a prop instead.
  cardImage: {
    width: '100%',
    height: '100%',
  },
  loadMoreCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  loadMoreLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
  },
  loadMoreCount: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
  trailerScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    height: '50%',
  },
  trailerName: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  trailerMeta: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4,
  },
  hintScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '500',
  },
});

/**
 * MovieTabBar Component
 * Main component for displaying movie information in a tabbed interface
 * 
 * @param activeTab - Currently selected tab
 * @param setActiveTab - Function to change the active tab
 * @param movie - Movie data object
 * @param onTrailerSelect - Handler for when a trailer is selected (the detail
 *        screen owns the single cinema player — no player renders here)
 */
const MovieTabBar = ({
  activeTab, setActiveTab, movie, onTrailerSelect, onSimilarMovieSelect,
  onExpandArtwork,
}: MovieTabBarProps) => {
  // Available tabs configuration
  const tabs: { id: TabType; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'cast', label: 'Cast' },
    { id: 'extras', label: 'Extras' },
    { id: 'similar', label: 'Similar' },
  ];

  // The viewer itself is NOT rendered here. MovieTabBar sits deep inside the detail
  // page's ScrollView, so a full-screen overlay mounted at this depth would be clipped
  // by the scroll container. Both galleries just hand the tapped artwork upward and
  // MovieDetailsView renders the single viewer at its root.

  return (
    // Vertical rhythm is owned here: identical top inset + section gap for every tab.
    <View>
      {/* Tab Navigation Bar */}
      <View style={tabStyles.tabBar}>
        <View style={tabStyles.tabRow}>
          {tabs.map((tab) => (
            // activeOpacity={1} is REQUIRED, not a preference. Left at the default (0.2)
            // the whole tab dims on press and then animates back — and because the press
            // swaps the tab's entire content (a cast grid, a poster rail), that restore
            // gets starved and the tab sits there translucent instead of going blue.
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={tabStyles.tabHit}
              activeOpacity={1}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.id }}
            >
              <Text style={[
                tabStyles.tabLabel,
                activeTab === tab.id && tabStyles.tabLabelActive,
              ]}>
                {tab.label}
              </Text>
              {activeTab === tab.id && <View style={tabStyles.tabIndicator} />}
            </TouchableOpacity>
          ))}
        </View>
        <View style={tabStyles.tabRule} />
      </View>

      {/* Tab Content — same top pad for Details / Cast / Extras / Similar */}
      <View style={tabStyles.content}>
        {activeTab === 'details' && <MovieDetailsTab movie={movie} />}

        {activeTab === 'cast' && <MovieCastTab movie={movie} />}

        {activeTab === 'extras' && (
          <View style={tabStyles.sections}>
            <View style={tabStyles.section}>
              <Text style={tabStyles.sectionTitle}>Trailers</Text>
              <TrailersSection movieId={movie.id.toString()} onTrailerSelect={onTrailerSelect} />
            </View>
            <View style={tabStyles.section}>
              <Text style={tabStyles.sectionTitle}>Backdrops</Text>
              <BackdropsSection movieId={movie.id.toString()} onExpand={onExpandArtwork} />
            </View>
            <View style={tabStyles.section}>
              <Text style={tabStyles.sectionTitle}>Posters</Text>
              <PostersSection movieId={movie.id.toString()} onExpand={onExpandArtwork} />
            </View>
          </View>
        )}

        {activeTab === 'similar' && (
          <MovieSimilarTab movieId={movie.id.toString()} onMovieSelect={onSimilarMovieSelect} />
        )}
      </View>
    </View>
  );
};

const tabStyles = StyleSheet.create({
  tabBar: {
    paddingHorizontal: 20,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  tabHit: {
    paddingVertical: 12,
  },
  tabLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  // COLOUR ONLY — the weight must not change. The row is space-between, so a label that
  // gets wider when it goes bold redistributes every gap in the row, and the other three
  // tabs visibly shift on each switch. The accent plus the indicator under it already say
  // "active" without touching the metrics.
  tabLabelActive: {
    color: '#9ccadf',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: '#9ccadf',
    borderRadius: 1.25,
  },
  tabRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  content: {
    paddingTop: TAB_CONTENT_TOP,
    paddingHorizontal: 20,
  },
  sections: {
    gap: TAB_SECTION_GAP,
  },
  section: {
    gap: SECTION_TITLE_GAP,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default MovieTabBar;
