import React, { memo, useState, useRef } from 'react';
import {
  View,
  Text,
  Dimensions,
  StyleSheet,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { Movie } from '@/interfaces/interfaces';
import UpcomingHero from './UpcomingHero';
import Pagination from '../Pagination';

interface UpcomingMoviesSectionProps {
  movies: Movie[];
  title?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PRIMARY_COLOR = '#9ccadf';

const UpcomingMoviesSection = ({ movies, title = 'Upcoming Movies' }: UpcomingMoviesSectionProps) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<Movie>>(null);

  if (!movies || movies.length === 0) return null;

  // Only future releases.
  const upcomingMovies = movies.filter((movie) => new Date(movie.release_date) > new Date());
  if (upcomingMovies.length === 0) return null;

  const handleNotify = (movieId: number) => {
    // This will be implemented later
    console.log(`Notification requested for movie ${movieId}`);
  };

  const navigateToPage = (index: number) => {
    if (flatListRef.current && index >= 0 && index < upcomingMovies.length) {
      flatListRef.current.scrollToOffset({ offset: index * SCREEN_WIDTH, animated: true });
    }
  };

  // Plain JS onScroll → index state. Reliable on the new architecture, unlike a
  // native-driven Animated.event whose JS listener can stall on Fabric (which is what
  // left the pagination frozen).
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.x;
    const newIndex = Math.min(upcomingMovies.length - 1, Math.max(0, Math.round(offset / SCREEN_WIDTH)));
    setActiveIndex((prev) => (prev === newIndex ? prev : newIndex));
  };

  const renderUpcomingMovie = ({ item }: { item: Movie }) => (
    <UpcomingHero movie={item} onNotify={handleNotify} />
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerContent}>
        <View style={styles.titleRow}>
          <FontAwesome5 name="calendar-alt" size={20} color={PRIMARY_COLOR} style={styles.titleIcon} />
          <Text style={styles.title}>{title}</Text>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={upcomingMovies}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={renderUpcomingMovie}
        keyExtractor={(item) => `upcoming-${item.id}`}
        decelerationRate="fast"
        snapToInterval={SCREEN_WIDTH}
        snapToAlignment="center"
        contentContainerStyle={styles.flatListContent}
        maxToRenderPerBatch={3}
        windowSize={3}
        initialNumToRender={1}
      />

      <Pagination
        currentIndex={activeIndex}
        totalItems={upcomingMovies.length}
        onPageChange={navigateToPage}
        color={PRIMARY_COLOR}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 30,
    marginBottom: 30,
    width: '100%',
    paddingTop: 40,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleIcon: {
    marginRight: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 0.5,
  },
  flatListContent: {
    paddingVertical: 10,
  },
});

export default memo(UpcomingMoviesSection);
