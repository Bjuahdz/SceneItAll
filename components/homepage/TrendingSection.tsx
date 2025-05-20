import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet,
  Dimensions,
  Animated,
  Platform
} from 'react-native';
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

// Adjusted padding values to correct the centering
const LEFT_PADDING = (SCREEN_WIDTH - CARD_WIDTH) / 2;
const RIGHT_PADDING = (SCREEN_WIDTH - CARD_WIDTH) / 2 + 40; // Add extra padding on right

// App's primary color theme
const PRIMARY_COLOR = '#9ccadf';

const TrendingSection = ({ 
  movies, 
  title = "Trending Movies" 
}: TrendingSectionProps) => {
  if (!movies || movies.length === 0) return null;
  
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  const [enhancedMovies, setEnhancedMovies] = useState<ExtendedTrendingMovie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Fetch movie logos and clean posters for each trending movie
  useEffect(() => {
    const fetchMovieAssets = async () => {
      try {
        const moviesWithAssets = await Promise.all(
          movies.map(async (movie) => {
            try {
              // Fetch logo and clean poster for each movie
              const imageData = await fetchMovieImages(movie.movie_id.toString());
              
              return {
                ...movie,
                logo_path: imageData.logo,
                // Use clean poster as priority for the card layout
                clean_poster_url: imageData.poster ? 
                  `https://image.tmdb.org/t/p/w500${imageData.poster}` : 
                  movie.poster_url
              };
            } catch (error) {
              console.error(`Error fetching assets for movie ${movie.movie_id}:`, error);
              return movie;
            }
          })
        );
        setEnhancedMovies(moviesWithAssets);
      } catch (error) {
        console.error('Error fetching movie assets:', error);
        setEnhancedMovies(movies);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchMovieAssets();
  }, [movies]);
  
  // Handle scroll event to update active index
  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { 
      useNativeDriver: true,
      listener: (event: any) => {
        const offset = event.nativeEvent.contentOffset.x;
        // Adjust activeIndex calculation to account for padding
        const newIndex = Math.round((offset - LEFT_PADDING + (ITEM_WIDTH / 2)) / ITEM_WIDTH);
        if (newIndex !== activeIndex && newIndex >= 0 && newIndex < movies.length) {
          setActiveIndex(newIndex);
        }
      }
    }
  );
  
  const navigateToPage = (index: number) => {
    if (flatListRef.current && index >= 0 && index < movies.length) {
      // Adjust offset calculation to account for padding
      flatListRef.current.scrollToOffset({
        offset: index * ITEM_WIDTH + LEFT_PADDING,
        animated: true
      });
    }
  };
  
  const renderTrendingMovie = ({ item, index }: { item: ExtendedTrendingMovie, index: number }) => (
    <TrendingCard 
      movie={item} 
      index={index}
      scrollX={scrollX}
      itemIndex={index}
      itemWidth={ITEM_WIDTH}
    />
  );
  
  // Create the custom container style with asymmetric padding
  const listContainerStyle = {
    paddingLeft: LEFT_PADDING,
    paddingRight: RIGHT_PADDING,
    paddingVertical: 10,
    paddingTop: 50, // Reduced padding top to give more space for logos
  };
  
  return (
    <View style={styles.container}>
      {/* Header container with lower zIndex */}
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
      
      {/* FlatList with higher zIndex to overlap the header */}
      <View style={styles.listContainer}>
        <Animated.FlatList
          ref={flatListRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          data={isLoading ? movies : enhancedMovies}
          renderItem={renderTrendingMovie}
          keyExtractor={(item, index) => `trending-${item.movie_id}-${index}`}
          contentContainerStyle={listContainerStyle}
          snapToInterval={ITEM_WIDTH}
          snapToAlignment="start"
          decelerationRate="fast"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          removeClippedSubviews={false} // Important: set to false to allow overlapping
          maxToRenderPerBatch={3}
          initialNumToRender={3}
          windowSize={5}
          getItemLayout={(data, index) => ({
            length: ITEM_WIDTH,
            offset: ITEM_WIDTH * index + LEFT_PADDING,
            index,
          })}
        />
      </View>
      
      {/* Pagination component */}
      <Pagination
        currentIndex={activeIndex}
        totalItems={movies.length}
        onPageChange={navigateToPage}
        scrollX={scrollX}
        primaryColor={PRIMARY_COLOR}
        dotsStyle="round"
        itemWidth={CARD_WIDTH}
        itemSpacing={SPACING}
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
    zIndex: 1, // Lower zIndex for header
  },
  listContainer: {
    zIndex: 2, // Higher zIndex for list to overlap header
    marginTop: -10, // Negative margin to pull the list up slightly
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
    marginBottom: 5, // Reduced bottom margin
  }
});

export default React.memo(TrendingSection); 