import React, { memo, useState, useRef } from 'react';
import { 
  View, 
  Text, 
  Dimensions, 
  StyleSheet, 
  TouchableOpacity, 
  FlatList,
  Animated
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
const HERO_HEIGHT = 440;

// Create animated FlatList
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);

const UpcomingMoviesSection = ({ 
  movies, 
  title = "Upcoming Movies" 
}: UpcomingMoviesSectionProps) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  
  if (!movies || movies.length === 0) return null;
  
  // Filter to only include upcoming movies
  const upcomingMovies = movies.filter(movie => {
    const releaseDate = new Date(movie.release_date);
    const today = new Date();
    return releaseDate > today;
  });
  
  if (upcomingMovies.length === 0) return null;
  
  const handleNotify = (movieId: number) => {
    // This will be implemented later
    console.log(`Notification requested for movie ${movieId}`);
  };
  
  const navigateToPage = (index: number) => {
    if (flatListRef.current && index >= 0 && index < upcomingMovies.length) {
      flatListRef.current.scrollToOffset({
        offset: index * SCREEN_WIDTH,
        animated: true
      });
    }
  };
  
  // Handle scroll event to update active index
  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { 
      useNativeDriver: true,
      listener: (event: any) => {
        const offset = event.nativeEvent.contentOffset.x;
        const newIndex = Math.round(offset / SCREEN_WIDTH);
        if (newIndex !== activeIndex && newIndex >= 0 && newIndex < upcomingMovies.length) {
          setActiveIndex(newIndex);
        }
      }
    }
  );
  
  const renderUpcomingMovie = ({ item }: { item: Movie }) => (
    <UpcomingHero 
      movie={item} 
      onNotify={handleNotify}
    />
  );
  
  return (
    <View style={styles.container}>
      <View style={styles.headerContent}>
        <View style={styles.titleRow}>
          <FontAwesome5 name="calendar-alt" size={20} color="#9ccadf" style={styles.titleIcon} />
          <Text style={styles.title}>{title}</Text>
        </View>
      </View>
      
      <AnimatedFlatList
        ref={flatListRef}
        data={upcomingMovies}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={true}
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
        scrollX={scrollX}
        primaryColor="#9ccadf"
        dotsStyle="round"
        itemWidth={SCREEN_WIDTH}
        itemSpacing={0}
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