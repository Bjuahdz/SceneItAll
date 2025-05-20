import React, { useState, memo, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, Dimensions, TouchableOpacity, Animated } from 'react-native';
import { Movie } from '@/interfaces/interfaces';
import BoxOfficeHero from './BoxOfficeHero';
import { FontAwesome } from '@expo/vector-icons';
import Pagination from '../Pagination';
import { Image } from 'expo-image';

interface BoxOfficeHeroSectionProps {
  cashCowMovies: Movie[];
  moneyPitMovies: Movie[];
  title?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.9;
const ITEM_SPACING = 20;
const INITIAL_VISIBLE_COUNT = 2;
const MAX_MOVIES_PER_SECTION = 8;

const BoxOfficeHeroSection = ({ 
  cashCowMovies,
  moneyPitMovies,
  title = "Box Office" 
}: BoxOfficeHeroSectionProps) => {
  const [activeCategory, setActiveCategory] = useState<'cashCows' | 'moneyPits'>('cashCows');
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleMovies, setVisibleMovies] = useState<Movie[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  
  // Update visible movies when category changes
  useEffect(() => {
    // Select the correct movies array based on active category
    const displayMovies = activeCategory === 'cashCows' 
      ? cashCowMovies.slice(0, MAX_MOVIES_PER_SECTION) 
      : moneyPitMovies.slice(0, MAX_MOVIES_PER_SECTION);
    
    // Ensure we don't have duplicate IDs in our data
    const uniqueMovies = Array.from(
      new Map(displayMovies.map(movie => [movie.id, movie])).values()
    );
    
    // Initialize with just the first few visible movies
    setVisibleMovies(uniqueMovies.slice(0, INITIAL_VISIBLE_COUNT));
    
    // Reset scroll position
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: false });
      setActiveIndex(0);
      scrollX.setValue(0);
    }
    
    // Preload the first few images
    if (displayMovies.length > 0) {
      const imagesToPreload = [];
      
      // Collect images to preload
      displayMovies.slice(0, INITIAL_VISIBLE_COUNT).forEach(movie => {
        if (movie.backdrop_path) {
          imagesToPreload.push({ 
            uri: `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` 
          });
        }
        
        if (movie.logo_path) {
          imagesToPreload.push({ 
            uri: `https://image.tmdb.org/t/p/w500${movie.logo_path}` 
          });
        }
      });
      
      // Preload collected images
      if (imagesToPreload.length > 0) {
        Image.prefetch(imagesToPreload);
      }
    }
  }, [activeCategory, cashCowMovies, moneyPitMovies]);
  
  if ((!cashCowMovies || cashCowMovies.length === 0) && 
      (!moneyPitMovies || moneyPitMovies.length === 0)) {
    return null;
  }
  
  // Create a state for the filtered display movies to use consistently
  const [allUniqueMovies, setAllUniqueMovies] = useState<Movie[]>([]);
  
  // Use allDisplayMovies consistently throughout component
  const allDisplayMovies = useMemo(() => {
    const sourceArray = activeCategory === 'cashCows' 
      ? cashCowMovies.slice(0, MAX_MOVIES_PER_SECTION) 
      : moneyPitMovies.slice(0, MAX_MOVIES_PER_SECTION);
      
    // Ensure uniqueness
    return Array.from(new Map(sourceArray.map(movie => [movie.id, movie])).values());
  }, [activeCategory, cashCowMovies, moneyPitMovies]);
  
  // Update loadMoreMovies to use the unique movies list
  const loadMoreMovies = useCallback(() => {
    if (visibleMovies.length < allDisplayMovies.length) {
      const nextBatch = allDisplayMovies.slice(
        visibleMovies.length, 
        visibleMovies.length + INITIAL_VISIBLE_COUNT
      );
      
      setVisibleMovies(prev => [...prev, ...nextBatch]);
      
      // Preload the next batch of images
      const imagesToPreload = [];
      nextBatch.forEach(movie => {
        if (movie.backdrop_path) {
          imagesToPreload.push({ 
            uri: `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` 
          });
        }
        
        if (movie.logo_path) {
          imagesToPreload.push({ 
            uri: `https://image.tmdb.org/t/p/w500${movie.logo_path}` 
          });
        }
      });
      
      if (imagesToPreload.length > 0) {
        Image.prefetch(imagesToPreload);
      }
    }
  }, [visibleMovies, allDisplayMovies]);
  
  // Navigate to a specific page
  const navigateToPage = useCallback((index: number) => {
    if (flatListRef.current && index >= 0 && index < allDisplayMovies.length) {
      // Ensure we have loaded enough movies to scroll to this index
      if (index >= visibleMovies.length - 1) {
        // Load all movies up to the requested index plus one extra for smooth scrolling
        const newVisibleCount = index + 2;
        setVisibleMovies(allDisplayMovies.slice(0, newVisibleCount));
      }
      
      // After the state update, scroll to the requested position
      setTimeout(() => {
        if (flatListRef.current) {
          flatListRef.current.scrollToOffset({
            offset: index * (CARD_WIDTH + ITEM_SPACING),
            animated: true
          });
        }
      }, 50);
    }
  }, [allDisplayMovies, visibleMovies.length, CARD_WIDTH, ITEM_SPACING]);
  
  // Handle scroll event to update active index
  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { 
      useNativeDriver: true,
      listener: (event: any) => {
        const offset = event.nativeEvent.contentOffset.x;
        const newIndex = Math.round(offset / (CARD_WIDTH + ITEM_SPACING));
        
        if (newIndex !== activeIndex && newIndex >= 0 && newIndex < allDisplayMovies.length) {
          setActiveIndex(newIndex);
          
          // Load more movies if we're approaching the end of loaded content
          if (newIndex >= visibleMovies.length - 2) {
            loadMoreMovies();
          }
        }
      }
    }
  );
  
  // Create a memoized renderItem function
  const renderBoxOfficeMovie = useCallback(({ item }: { item: Movie }) => (
    <BoxOfficeHero 
      movie={item} 
      type={activeCategory}
    />
  ), [activeCategory]);
  
  // Optimize category toggle handlers
  const handleCashCowsPress = useCallback(() => setActiveCategory('cashCows'), []);
  const handleMoneyPitsPress = useCallback(() => setActiveCategory('moneyPits'), []);
  
  // Track current index for pagination control
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50
  }).current;
  
  // Handle reaching end of available content
  const handleEndReached = useCallback(() => {
    loadMoreMovies();
  }, [loadMoreMovies]);
  
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleContainer}>
          <FontAwesome name="line-chart" size={20} color="#9ccadf" style={styles.titleIcon} />
          <Text style={styles.title}>{title}</Text>
        </View>
        
        <View style={styles.toggleContainer}>
          <TouchableOpacity 
            style={[
              styles.toggleButton,
              activeCategory === 'cashCows' ? styles.activeToggle : styles.inactiveToggle
            ]}
            onPress={handleCashCowsPress}
          >
            <FontAwesome
              name="arrow-up"
              size={12}
              color={activeCategory === 'cashCows' ? '#7fec7f' : 'rgba(255, 255, 255, 0.4)'}
            />
            <Text style={[
              styles.toggleText,
              activeCategory === 'cashCows' ? styles.activeToggleText : styles.inactiveToggleText
            ]}>
              Cash Cows
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[
              styles.toggleButton,
              activeCategory === 'moneyPits' ? styles.activeToggle : styles.inactiveToggle
            ]}
            onPress={handleMoneyPitsPress}
          >
            <FontAwesome
              name="arrow-down"
              size={12}
              color={activeCategory === 'moneyPits' ? '#fc7676' : 'rgba(255, 255, 255, 0.4)'}
            />
            <Text style={[
              styles.toggleText,
              activeCategory === 'moneyPits' ? styles.activeToggleText : styles.inactiveToggleText
            ]}>
              Money Pits
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      
      <Text style={styles.description}>
        {activeCategory === 'cashCows' 
          ? 'Movies that turned a significant profit at the box office'
          : 'Movies that failed to recover their production budgets'}
      </Text>
      
      <Animated.FlatList
        ref={flatListRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        data={visibleMovies}
        renderItem={renderBoxOfficeMovie}
        keyExtractor={(item) => `${activeCategory}-${item.id}`}
        contentContainerStyle={styles.listContainer}
        onScroll={handleScroll}
        snapToAlignment="center"
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + ITEM_SPACING}
        snapToOffsets={allDisplayMovies.map((_, i) => i * (CARD_WIDTH + ITEM_SPACING))}
        disableIntervalMomentum={true}
        initialNumToRender={INITIAL_VISIBLE_COUNT}
        maxToRenderPerBatch={2}
        viewabilityConfig={viewabilityConfig}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        scrollEventThrottle={16}
        removeClippedSubviews={true}
      />
      
      {/* Add the pagination component */}
      <Pagination
        currentIndex={activeIndex}
        totalItems={allDisplayMovies.length}
        onPageChange={navigateToPage}
        scrollX={scrollX}
        primaryColor="#9ccadf"
        itemWidth={CARD_WIDTH}
        itemSpacing={ITEM_SPACING}
        dotsStyle="round"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 35,
    marginBottom: 15,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 6,
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
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 20,
    overflow: 'hidden',
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  activeToggle: {
    backgroundColor: 'rgba(20, 20, 20, 0.8)',
  },
  inactiveToggle: {
    backgroundColor: 'transparent',
  },
  toggleText: {
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  activeToggleText: {
    color: 'white',
  },
  inactiveToggleText: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
  description: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginHorizontal: 20,
    marginBottom: 16,
  },
  listContainer: {
    paddingLeft: 20,
    paddingRight: 5,
    paddingTop: 8,
    paddingBottom: 10,
  },
  paginationContainer: {
    marginTop: 0,  // Positioned below the cards
    paddingTop: 0
  }
});

export default memo(BoxOfficeHeroSection);