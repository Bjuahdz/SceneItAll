import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Dimensions,
} from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { TrendingMovie } from '@/interfaces/interfaces';
import TrendingCard from './TrendingCard';
import Pagination from '../Pagination';
import { fetchMovieImages } from '@/services/api';

interface TrendingSectionProps {
  movies: TrendingMovie[];
  title?: string;
}

// Extended TrendingMovie with logo data
interface ExtendedTrendingMovie extends TrendingMovie {
  logo_path?: string | null;
  clean_poster_url?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.7;
const SPACING = 20;
const ITEM_WIDTH = CARD_WIDTH + SPACING;
const LIST_HEIGHT = CARD_WIDTH * 1.5 + 140;

const HORIZONTAL_PADDING = (SCREEN_WIDTH - CARD_WIDTH) / 2;
const PRIMARY_COLOR = '#9ccadf';

const TrendingSection = ({
  movies,
  title = "Trending Movies"
}: TrendingSectionProps) => {
  if (!movies || movies.length === 0) return null;

  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const [movieAssets, setMovieAssets] = useState<Record<number, Pick<ExtendedTrendingMovie, 'logo_path' | 'clean_poster_url'>>>({});
  const inflightFetchesRef = useRef<Set<number>>(new Set());

  // Cards interpolate their styles from this shared value via useAnimatedStyle.
  // It is fed from the plain JS onScroll event rather than useAnimatedScrollHandler:
  // in this environment (Expo Go SDK 54 + Reanimated 4.1 + nativewind's jsx interop)
  // the worklet scroll handler never received events, freezing every card at its
  // mount-time pose. Writing the SharedValue from JS still drives the worklet styles
  // on the UI thread, and at scrollEventThrottle=16 the parallax stays smooth.
  const scrollX = useSharedValue(0);
  const itemCount = movies.length;

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.x;
    scrollX.value = offset;

    const index = Math.min(itemCount - 1, Math.max(0, Math.round(offset / ITEM_WIDTH)));
    setActiveIndex(prev => (prev === index ? prev : index));
  }, [itemCount, scrollX]);

  const displayMovies = useMemo(
    () => movies.map(movie => ({
      ...movie,
      ...movieAssets[movie.movie_id],
    })),
    [movies, movieAssets]
  );

  useEffect(() => {
    let isMounted = true;

    const fetchMovieAssets = async () => {
      const moviesToFetch = movies.filter(movie =>
        !movieAssets[movie.movie_id] && !inflightFetchesRef.current.has(movie.movie_id)
      );

      if (moviesToFetch.length === 0) return;

      moviesToFetch.forEach(movie => inflightFetchesRef.current.add(movie.movie_id));

      try {
        const assetsByMovieId = await Promise.all(
          moviesToFetch.map(async (movie) => {
            try {
              const imageData = await fetchMovieImages(movie.movie_id.toString());

              return {
                movieId: movie.movie_id,
                logo_path: imageData.logo,
                clean_poster_url: imageData.poster ?
                  `https://image.tmdb.org/t/p/w500${imageData.poster}` :
                  movie.poster_url
              };
            } catch (error) {
              console.error(`Error fetching assets for movie ${movie.movie_id}:`, error);
              return {
                movieId: movie.movie_id,
                logo_path: null,
                clean_poster_url: movie.poster_url,
              };
            }
          })
        );

        if (!isMounted) return;

        setMovieAssets(prev => {
          const next = { ...prev };

          assetsByMovieId.forEach(asset => {
            next[asset.movieId] = {
              logo_path: asset.logo_path,
              clean_poster_url: asset.clean_poster_url,
            };
          });

          return next;
        });
      } catch (error) {
        console.error('Error fetching movie assets:', error);
      } finally {
        moviesToFetch.forEach(movie => inflightFetchesRef.current.delete(movie.movie_id));
      }
    };

    fetchMovieAssets();

    return () => {
      isMounted = false;
    };
  }, [movies]);

  const navigateToPage = (index: number) => {
    if (flatListRef.current && index >= 0 && index < movies.length) {
      flatListRef.current.scrollToOffset({
        offset: index * ITEM_WIDTH,
        animated: true
      });
    }
  };

  // Cards subscribe to scrollX on the UI thread, so swiping never re-renders them.
  const renderTrendingMovie = useCallback(({ item, index }: { item: ExtendedTrendingMovie, index: number }) => (
    <View style={styles.itemContainer}>
      <TrendingCard
        movie={item}
        index={index}
        scrollX={scrollX}
        itemWidth={ITEM_WIDTH}
      />
    </View>
  ), [scrollX]);

  const listContainerStyle = useMemo(() => ({
    paddingLeft: HORIZONTAL_PADDING,
    paddingRight: HORIZONTAL_PADDING,
    paddingVertical: 10,
    paddingTop: 70,
  }), []);

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <View style={styles.headerRow}>
          <View style={styles.titleContainer}>
            <FontAwesome name="line-chart" size={20} color={PRIMARY_COLOR} style={styles.titleIcon} />
            <Text style={styles.title}>{title}</Text>
          </View>
        </View>

        <Text style={styles.description}>
          Most popular movies people are watching right now
        </Text>
      </View>

      <View style={styles.listContainer}>
        <Animated.FlatList
          ref={flatListRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          data={displayMovies}
          renderItem={renderTrendingMovie}
          keyExtractor={(item) => `trending-${item.movie_id}`}
          contentContainerStyle={listContainerStyle}
          snapToInterval={ITEM_WIDTH}
          snapToAlignment="start"
          decelerationRate="fast"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          removeClippedSubviews={false}
          maxToRenderPerBatch={3}
          initialNumToRender={3}
          windowSize={5}
          getItemLayout={(data, index) => ({
            length: ITEM_WIDTH,
            offset: ITEM_WIDTH * index,
            index,
          })}
        />
      </View>

      <Pagination
        currentIndex={activeIndex}
        totalItems={movies.length}
        onPageChange={navigateToPage}
        color={PRIMARY_COLOR}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    position: 'relative',
  },
  headerContainer: {
    zIndex: 1,
  },
  listContainer: {
    zIndex: 2,
    marginTop: -10,
    height: LIST_HEIGHT,
  },
  itemContainer: {
    width: ITEM_WIDTH,
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleIcon: {
    marginRight: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 0.5,
  },
  description: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginHorizontal: 20,
    marginBottom: 15,
  }
});

export default React.memo(TrendingSection);
