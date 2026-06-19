import { View, Text, Dimensions, FlatList, StyleSheet, TouchableOpacity } from "react-native";
import { Link } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Movie, MovieVideo } from "@/interfaces/interfaces";
import GenreTag from '../GenreTag';
import { Animated } from "react-native";
import TrailerPlayer from "../TrailerPlayer";
import { fetchMovieVideos, fetchMovieDetails } from "@/services/api";
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';

interface HeroPosterProps {
  movies: Movie[];
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = 700;
const MAX_BOUNCE_DISTANCE = 70;
const PLACEHOLDER_BLURHASH = '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQM{M|azj[azf6fQfQfQIpWXofj[ayj[j[fQayWCoeoeaya}j[ayfQa{oLj?j[WVj[ayayj[fQoff7azayj[ayj[j[ayofayayayj[fQj[ayayj[ayfjj[j[ayjuayj[';

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);

// Default certification if not available
const DEFAULT_CERTIFICATION = 'NR';

// Define a separate MovieLogo component outside of the main component
const MovieLogo = ({ path }: { path: string | null }) => {
  if (!path) return null;
  return (
    <Image
      source={{ uri: `https://image.tmdb.org/t/p/w300${path}` }}
      placeholder={PLACEHOLDER_BLURHASH}
      transition={150}
      cachePolicy="memory-disk"
      contentFit="contain"
      style={styles.logoImage}
    />
  );
};

const HeroPoster = ({ movies }: HeroPosterProps) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [showTrailer, setShowTrailer] = useState(false);
  const [activeTrailerId, setActiveTrailerId] = useState<string | null>(null);
  const [trailers, setTrailers] = useState<Record<number, MovieVideo[]>>({});
  const [movieCertifications, setMovieCertifications] = useState<Record<number, string>>({});
  const [expandedSynopsis, setExpandedSynopsis] = useState<Record<number, boolean>>({});
  
  // Use ref instead of state for loading to avoid re-renders
  const loadingStatesRef = useRef<Record<number, boolean>>({});
  const dataFetchedRef = useRef<Set<number>>(new Set());
  
  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  const opacityValuesRef = useRef<Record<number, Animated.Value>>({});
  
  // Add a ref to track which images we've started preloading
  const preloadedImagesRef = useRef<Set<string>>(new Set());

  if (!movies?.length) return null;

  // Optimize by limiting number of movies and memoizing the slice
  const topMovies = useMemo(() => movies.slice(0, 7), [movies]);
  if (!topMovies.length) return null;

  // Preload images function to optimize image loading
  const preloadImages = useCallback((movieIndex: number) => {
    const currentMovie = topMovies[movieIndex];
    if (!currentMovie) return;
    
    // Skip if we've already preloaded this image
    const posterUrl = `https://image.tmdb.org/t/p/w780${currentMovie.poster_path}`;
    if (preloadedImagesRef.current.has(posterUrl)) return;
    
    // Add to preload tracking set
    preloadedImagesRef.current.add(posterUrl);
    
    // Prepare preload array
    const imagesToPreload = [{ uri: posterUrl }];
    
    // Add logo if available
    if (currentMovie.logo_path) {
      const logoUrl = `https://image.tmdb.org/t/p/w300${currentMovie.logo_path}`;
      if (!preloadedImagesRef.current.has(logoUrl)) {
        preloadedImagesRef.current.add(logoUrl);
        imagesToPreload.push({ uri: logoUrl });
      }
    }
    
    // Preload images
    if (imagesToPreload.length > 0) {
      Image.prefetch(imagesToPreload.map(img => img.uri));
    }
  }, [topMovies]);

  // Initialize opacity values and fetch data only for visible movies
  useEffect(() => {
    // Initialize opacity values for all top movies
    topMovies.forEach(movie => {
      if (!opacityValuesRef.current[movie.id]) {
        opacityValuesRef.current[movie.id] = new Animated.Value(1);
      }
    });
    
    // Preload first 2 movies' images for faster initial display
    if (topMovies.length > 0) {
      preloadImages(0);
      if (topMovies.length > 1) {
        preloadImages(1);
      }
      
      // Only fetch data for the first movie initially if not already fetched
      if (!dataFetchedRef.current.has(topMovies[0].id)) {
        prefetchMovieData(topMovies[0].id);
      }
    }
  }, [topMovies]);

  // Use a separate effect to monitor active index changes
  useEffect(() => {
    // The poster crossfade is handled by expo-image's `transition` when the source
    // changes (see heroPoster below) — NOT an RN Animated opacity. A native-driven
    // Animated.timing was unreliable on the New Architecture (Expo Go SDK 54) and would
    // sometimes get stuck at opacity 0, leaving a cover dark until another swipe. The
    // built-in crossfade is consistent and also removes the dark gap mid-swipe.

    // Prefetch data for current and next movie if not already fetched
    if (topMovies[activeIndex] && !dataFetchedRef.current.has(topMovies[activeIndex].id)) {
      prefetchMovieData(topMovies[activeIndex].id);
    }
    
    // Prefetch next movie data and images
    const nextIndex = (activeIndex + 1) % topMovies.length;
    if (!dataFetchedRef.current.has(topMovies[nextIndex].id)) {
      prefetchMovieData(topMovies[nextIndex].id);
    }
    
    // Preload next movie images
    preloadImages(nextIndex);
    
    // Also preload the one after that for smooth experience
    const nextNextIndex = (nextIndex + 1) % topMovies.length;
    preloadImages(nextNextIndex);
  }, [activeIndex]);

  // Optimized prefetch function
  const prefetchMovieData = async (movieId: number) => {
    // Skip if we've already fetched this movie
    if (dataFetchedRef.current.has(movieId)) return;
    
    // Mark as loading and fetched
    loadingStatesRef.current[movieId] = true;
    dataFetchedRef.current.add(movieId);
    
    try {
      // Fetch only certification first for faster initial display
      const details = await fetchMovieDetails(movieId.toString());
      
      // Update certification immediately
      setMovieCertifications(prev => ({ 
        ...prev, 
        [movieId]: details.certification || DEFAULT_CERTIFICATION 
      }));
      
      // Then fetch trailers in background
      fetchMovieVideos(movieId.toString())
        .then(videos => {
          setTrailers(prev => ({ ...prev, [movieId]: videos }));
        })
        .catch(error => {
          console.error('Error fetching trailers:', error);
        });
      
    } catch (error) {
      console.error('Error prefetching movie data:', error);
      setMovieCertifications(prev => ({ 
        ...prev, 
        [movieId]: DEFAULT_CERTIFICATION 
      }));
    } finally {
      loadingStatesRef.current[movieId] = false;
    }
  };

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { 
      useNativeDriver: true,
      listener: (event: any) => {
        const offset = event.nativeEvent.contentOffset.x;
        const newIndex = Math.round(offset / SCREEN_WIDTH);
        if (newIndex !== activeIndex && newIndex >= 0 && newIndex < topMovies.length) {
          setActiveIndex(newIndex);
        }
      }
    }
  );

  const handleTrailerPlay = (movieId: number) => {
    const movieTrailers = trailers[movieId] || [];
    if (movieTrailers.length > 0) {
      setActiveTrailerId(movieTrailers[0].key);
      setShowTrailer(true);
    }
  };

  const handleCloseTrailer = () => {
    setShowTrailer(false);
    setActiveTrailerId(null);
  };

  const toggleSynopsis = (movieId: number) => {
    setExpandedSynopsis(prev => ({
      ...prev,
      [movieId]: !prev[movieId]
    }));
  };

  // Keep the number and underline on the same source of truth so they cannot drift apart.
  const paginationIndicator = useMemo(() => (
    <View style={styles.paginationContainer}>
      {topMovies.map((_, index) => {
        const isActive = index === activeIndex;

        return (
          <View key={`indicator-${index}`} style={styles.indicatorWrapper}>
            <Animated.View
              style={[
                styles.paginationLine,
                isActive ? styles.activePaginationLine : styles.inactivePaginationLine,
              ]}
            />

            {isActive && (
              <View style={styles.activeNumberContainer}>
                <Text style={styles.activeNumberText}>{index + 1}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  ), [topMovies.length, activeIndex]);

  // Memoize the current poster to prevent unnecessary re-renders
  const heroPoster = useMemo(() => {
    const currentMovie = topMovies[activeIndex];
    if (!currentMovie) return null;
    
    // Use smaller image size for better performance
    const imageUrl = `https://image.tmdb.org/t/p/w780${currentMovie.poster_path}`;
    
    return (
      <View style={styles.posterContainer}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.posterImage}
          contentFit="cover" 
          placeholder={PLACEHOLDER_BLURHASH}
          // Built-in crossfade from the previous poster to the new one when `source`
          // changes — reliable on Fabric and leaves no dark gap. No recyclingKey here:
          // a changing key makes expo-image reset to the placeholder (a dark flash)
          // instead of transitioning in place. Tune this duration to taste.
          transition={300}
          cachePolicy="memory-disk"
        />
        <LinearGradient
          colors={[
            "rgba(0,0,0,0.4)",
            "rgba(0,0,0,0.3)",
            "rgba(0,0,0,0.4)",
            "rgba(0,0,0,0.75)",
            "rgba(0,0,0,0.99)"
          ]}
          locations={[0, 0.3, 0.6, 0.8, 1]}
          style={styles.gradient}
        />
      </View>
    );
  }, [topMovies, activeIndex]);

  // Format date to "MMM YYYY" (e.g., "JUN 2023")
  const formatReleaseDate = useMemo(() => (dateString: string) => {
    const date = new Date(dateString);
    const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const year = date.getFullYear();
    return `${month} ${year}`;
  }, []);

  const renderItem = ({ item }: { item: any }) => {
    const movie = item as Movie;
    // Check if we have trailers for this movie
    const hasTrailer = trailers[movie.id]?.length > 0;
    const isSynopsisExpanded = expandedSynopsis[movie.id] || false;
    const isLoading = loadingStatesRef.current[movie.id] || false;
    
    // Determine if synopsis is long enough to warrant expansion
    const isSynopsisLong = movie.overview && movie.overview.length > 150;
    const showTrailerButton = hasTrailer;
    const infoItemCount = showTrailerButton ? 4 : 3;

    return (
      <Link href={`/movie/${movie.id}`} asChild>
        <TouchableOpacity 
          activeOpacity={0.9}
          style={styles.itemContainer}
        >
          <View style={styles.contentTouchable}>
            <View style={styles.contentMain}>
              <View style={styles.titleLogoContainer}>
                {movie.logo_path ? (
                  <MovieLogo path={movie.logo_path} />
                ) : (
                  <Text style={styles.titleText} numberOfLines={2}>
                    {movie.title}
                  </Text>
                )}
                
                <View style={styles.genreContainer}>
                  {movie.genre_ids.slice(0, 3).map((genreId) => (
                    <GenreTag key={genreId} genreId={genreId} />
                  ))}
                </View>
              </View>
              
              <View style={[
                styles.infoBar,
                !showTrailerButton && { paddingHorizontal: infoItemCount === 3 ? 32 : 16 }
              ]}>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>REVIEW</Text>
                  <Text style={styles.infoValue}>
                    {movie.vote_average.toFixed(1)}
                  </Text>
                </View>
                
                <View style={[
                  styles.infoDivider,
                  { marginHorizontal: infoItemCount === 3 ? 24 : 16 }
                ]} />
                
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>RELEASE</Text>
                  <Text style={styles.infoValue}>
                    {formatReleaseDate(movie.release_date)}
                  </Text>
                </View>
                
                <View style={[
                  styles.infoDivider,
                  { marginHorizontal: infoItemCount === 3 ? 24 : 16 }
                ]} />
                
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>RATED</Text>
                  <Text style={styles.infoValue}>
                    {movieCertifications[movie.id] || DEFAULT_CERTIFICATION}
                  </Text>
                </View>
                
                {showTrailerButton && (
                  <>
                    <View style={[
                      styles.infoDivider,
                      { marginHorizontal: infoItemCount === 3 ? 24 : 16 }
                    ]} />
                    
                    <TouchableOpacity 
                      style={[
                        styles.trailerButton,
                        isLoading && { opacity: 0.5 }
                      ]}
                      onPress={(e) => {
                        e.stopPropagation();
                        if (!isLoading && hasTrailer) {
                          handleTrailerPlay(movie.id);
                        }
                      }}
                      disabled={isLoading || !hasTrailer}
                    >
                      <View style={styles.trailerButtonContent}>
                        <MaterialIcons name="play-arrow" size={14} color="#9ccadf" />
                        <Text style={styles.trailerButtonText}>TRAILER</Text>
                      </View>
                    </TouchableOpacity>
                  </>
                )}
              </View>
              
              <View style={styles.synopsisContainer}>
                <Text 
                  style={styles.synopsisText} 
                  numberOfLines={isSynopsisExpanded ? undefined : 3}
                >
                  {movie.overview}
                  {isSynopsisLong && !isSynopsisExpanded && (
                    <Text style={{ color: 'rgba(156, 202, 223, 0.7)', fontSize: 14 }}>{' '}...</Text>
                  )}
                </Text>
                
                {isSynopsisLong && (
                  <TouchableOpacity
                    style={styles.readMoreButton}
                    onPress={(e) => {
                      e.stopPropagation();
                      toggleSynopsis(movie.id);
                    }}
                    hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                  >
                    <Text style={styles.readMoreText}>
                      {isSynopsisExpanded ? '• LESS •' : '• MORE •'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Link>
    );
  };

  return (
    <View style={styles.container}>
      {heroPoster}
      <AnimatedFlatList
        ref={flatListRef}
        data={topMovies}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={true}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={renderItem}
        keyExtractor={(item) => (item as Movie).id.toString()}
        decelerationRate={0.85}
        style={styles.flatList}
        pointerEvents="box-none"
        // Optimize FlatList performance
        maxToRenderPerBatch={2}
        windowSize={3}
        initialNumToRender={1}
        removeClippedSubviews={true}
        getItemLayout={(data, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />
      {paginationIndicator}
      
      {showTrailer && activeTrailerId && topMovies[activeIndex] && (
        <TrailerPlayer 
          videoId={activeTrailerId} 
          onClose={handleCloseTrailer} 
          rating={movieCertifications[topMovies[activeIndex].id] || DEFAULT_CERTIFICATION}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: HERO_HEIGHT + MAX_BOUNCE_DISTANCE,
    position: 'relative',
  },
  posterContainer: { 
    position: 'absolute', 
    width: '100%', 
    height: HERO_HEIGHT,
    overflow: 'hidden',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  posterImage: {
    width: '100%', 
    height: '100%',
    backgroundColor: 'rgba(21, 21, 21, 0.5)', // More transparent and subtle
  },
  gradient: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    zIndex: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  itemContainer: { 
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT + MAX_BOUNCE_DISTANCE,
    justifyContent: 'flex-end',
  },
  contentTouchable: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: 85, // Extra space for pagination dots
  },
  contentMain: {
    alignItems: 'center',
  },
  titleLogoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: { 
    width: 280, 
    height: 120, 
    marginBottom: 16,
  },
  titleText: {
    color: 'white',
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    maxWidth: '80%',
    marginBottom: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: {width: -1, height: 1},
    textShadowRadius: 6,
  },
  genreContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 6,
  },
  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    width: '100%',
    paddingHorizontal: 16,
  },
  infoItem: {
    alignItems: 'center',
    height: 44,
  },
  infoLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1,
    marginBottom: 4,
  },
  infoValue: {
    color: '#9ccadf',
    fontSize: 15,
    fontWeight: 'bold',
  },
  skeletonValue: {
    width: 32,
    height: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
  },
  infoDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 16,
  },
  trailerButton: {
    height: 32,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(156, 202, 223, 0.15)',
    borderWidth: 1,
    borderColor: '#9ccadf',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trailerButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trailerButtonText: {
    color: '#9ccadf',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  synopsisContainer: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  synopsisText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  readMoreButton: {
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 3,
  },
  readMoreText: {
    color: 'rgba(156, 202, 223, 0.8)',
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.8,
  },
  flatList: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  paginationContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 10,
  },
  paginationLine: {
    width: 20,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#9ccadf',
  },
  activePaginationLine: {
    opacity: 1,
    transform: [{ scaleX: 1.6 }],
  },
  inactivePaginationLine: {
    opacity: 0.4,
    transform: [{ scaleX: 1 }],
  },
  indicatorWrapper: {
    position: 'relative',
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  activeNumberContainer: {
    position: 'absolute',
    top: -16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeNumberText: {
    color: '#9ccadf',
    fontSize: 12,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

export default HeroPoster;

