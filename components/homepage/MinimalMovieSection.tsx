import React, { memo, useState, useRef, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Dimensions, Animated } from 'react-native';
import { Link } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { Movie } from '@/interfaces/interfaces';
import { Image } from 'expo-image';

interface MinimalMovieSectionProps {
  title: string;
  movies: Movie[];
  icon?: string;
  accent?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_WIDTH = SCREEN_WIDTH * 0.28;
const ITEM_HEIGHT = ITEM_WIDTH * 1.5;
const INITIAL_LOAD_COUNT = 3;
const PLACEHOLDER_BLURHASH = '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQM{M|azj[azf6fQfQfQIpWXofj[ayj[j[fQayWCoeoeaya}j[ayfQa{oLj?j[WVj[ayayj[fQoff7azayj[ayj[j[ayofayayayj[fQj[ayayj[ayfjj[j[ayjuayj[';

const MinimalMovieSection = ({ 
  title, 
  movies, 
  icon = "film",
  accent = "#9ccadf"
}: MinimalMovieSectionProps) => {
  if (!movies || movies.length === 0) return null;
  
  // State to track loaded items
  const [visibleData, setVisibleData] = useState(movies.slice(0, INITIAL_LOAD_COUNT));
  const [isLoading, setIsLoading] = useState(false);
  const opacityValues = useRef(movies.map(() => new Animated.Value(0)));
  
  // Initialize opacity values for first 3 items to be fully visible
  React.useEffect(() => {
    visibleData.forEach((_, index) => {
      opacityValues.current[index].setValue(1);
    });
  }, []);
  
  const loadMoreItems = useCallback(() => {
    if (isLoading || visibleData.length >= movies.length) return;
    
    setIsLoading(true);
    
    // Simulate network delay
    setTimeout(() => {
      const nextIndex = visibleData.length;
      const newItems = movies.slice(nextIndex, nextIndex + 3);
      
      if (newItems.length > 0) {
        setVisibleData(prev => [...prev, ...newItems]);
        
        // Animate new items to fade in
        newItems.forEach((_, i) => {
          const itemIndex = nextIndex + i;
          opacityValues.current[itemIndex] = new Animated.Value(0);
          
          Animated.timing(opacityValues.current[itemIndex], {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }).start();
        });
      }
      
      setIsLoading(false);
    }, 300);
  }, [isLoading, visibleData, movies]);
  
  const onEndReached = () => {
    loadMoreItems();
  };
  
  const renderMovieItem = ({ item, index }: { item: Movie, index: number }) => (
    <Animated.View style={{ opacity: opacityValues.current[index] }}>
      <Link href={`/movie/${item.id}`} asChild>
        <TouchableOpacity style={styles.itemContainer}>
          <View style={styles.imageContainer}>
            <Image
              source={{
                uri: item.poster_path
                  ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                  : "https://placehold.co/600x400/1a1a1a/FFFFFF.png",
              }}
              placeholder={PLACEHOLDER_BLURHASH}
              recyclingKey={`${item.id}-poster`}
              cachePolicy="memory-disk"
              transition={300}
              contentFit="cover"
              style={styles.posterImage}
            />
            
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>{item.vote_average.toFixed(1)}</Text>
            </View>
          </View>
          
          <Text style={styles.titleText} numberOfLines={1}>
            {item.title}
          </Text>
          
          <Text style={styles.yearText}>
            {item.release_date?.split("-")[0] || ""}
          </Text>
        </TouchableOpacity>
      </Link>
    </Animated.View>
  );

  // Preload the first batch of images on component mount
  React.useEffect(() => {
    if (movies && movies.length > 0) {
      const imagesToPreload = movies.slice(0, INITIAL_LOAD_COUNT).map(movie => {
        return {
          uri: movie.poster_path 
            ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
            : "https://placehold.co/600x400/1a1a1a/FFFFFF.png"
        };
      });
      Image.prefetch(imagesToPreload);
    }
  }, [movies]);

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <View style={styles.titleContainer}>
          <FontAwesome 
            name={icon} 
            size={16} 
            color={accent}
            style={styles.titleIcon} 
          />
          <Text style={[styles.sectionTitle, { color: 'white' }]}>
            {title}
          </Text>
        </View>
        
        <Link href={`/search?query=${title}`} asChild>
          <TouchableOpacity style={styles.seeAllButton}>
            <Text style={[styles.seeAllText, { color: accent }]}>See All</Text>
          </TouchableOpacity>
        </Link>
      </View>
      
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={visibleData}
        renderItem={renderMovieItem}
        keyExtractor={(item) => `minimal-${item.id}`}
        contentContainerStyle={styles.listContainer}
        removeClippedSubviews={true}
        maxToRenderPerBatch={3}
        initialNumToRender={INITIAL_LOAD_COUNT}
        windowSize={3}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    paddingTop: 15,
    paddingBottom: 5,
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 5,
    marginBottom: 12,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleIcon: {
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  seeAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listContainer: {
    paddingLeft: 5,
    paddingRight: 10,
    paddingBottom: 5,
    gap: 16,
  },
  itemContainer: {
    width: ITEM_WIDTH,
  },
  imageContainer: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  posterImage: {
    width: ITEM_WIDTH,
    height: ITEM_HEIGHT,
    borderRadius: 8,
  },
  ratingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ratingText: {
    color: '#f0f0f0',
    fontSize: 12,
    fontWeight: 'bold',
  },
  titleText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  yearText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    marginTop: 2,
  }
});

export default memo(MinimalMovieSection); 