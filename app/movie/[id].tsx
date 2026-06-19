import { View, Animated, Dimensions, ActivityIndicator, Text, Platform, RefreshControl, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native'
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import ReAnimated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import React, { useState, useRef, useEffect } from 'react'
import { useLocalSearchParams } from 'expo-router';
import useFetch from '@/services/useFetch';
import { fetchMovieDetails, fetchMovieImages, fetchMovieLanguages, fetchMovieVideos } from '@/services/api';
import { LinearGradient } from 'expo-linear-gradient';
import MovieActionButtons from '@/components/moviedetails/MovieActionButtons';
import MovieTabBar from '@/components/moviedetails/MovieTabBar';
import TrailerPlayer from '../../components/TrailerPlayer';
import { MovieVideo, TabType } from '@/interfaces/interfaces';
import { Image } from 'expo-image'; // Changed to expo-image for better performance
import * as Haptics from 'expo-haptics';

// Add new memoized components to prevent unnecessary re-renders
const MemoizedMovieActionButtons = React.memo(MovieActionButtons);
const MemoizedMovieTabBar = React.memo(MovieTabBar);

// Add image placeholder and blur hash for smooth loading
const BLUR_HASH = '|rF?hV%2WCj[ayj[a|j[j[fQa{j[j[fQj[ayj[V?j[j[j[fQa{j[j[j[ayj[ayayayj[fQayj[j[j[';
const PLACEHOLDER_COLOR = '#151312';

// Constants for dimensions
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const MovieDetails = () => {
  const { id } = useLocalSearchParams();
  const [images, setImages] = useState<{ 
    backdrop: string | null, 
    logo: string | null
  }>({ 
    backdrop: null, 
    logo: null
  });
  const scrollY = useRef(new Animated.Value(0)).current;
  const { data: movie, loading } = useFetch(() => fetchMovieDetails(id as string));
  const { height } = Dimensions.get('window');
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [synopsisVisible, setSynopsisVisible] = useState(false);
  const [trailers, setTrailers] = useState<MovieVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [posterFetched, setPosterFetched] = useState(false);
  const imageTransitionDuration = 0;
  const [headerHeight] = useState(Platform.select({
    ios: 80,
    android: 70,
    default: 75
  })); // Increased header height with platform-specific values
  
  // Calculate responsive sizes
  const headerLogoHeight = headerHeight - 24; // Increased logo height
  const headerLogoWidth = headerLogoHeight * 2.2; // Slightly wider ratio for better visibility
  
  // Add new animation values for header
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerTranslateY = useRef(new Animated.Value(-headerHeight)).current;
  
  // Calculate when header should appear based on scroll position
  const headerAnimation = scrollY.interpolate({
    inputRange: [height * 0.4, height * 0.5],
    outputRange: [0, 1],
    extrapolate: 'clamp'
  });

  // Update header animations based on scroll
  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: headerAnimation,
        duration: 0,
        useNativeDriver: true,
      }),
      Animated.timing(headerTranslateY, {
        toValue: headerAnimation.interpolate({
          inputRange: [0, 1],
          outputRange: [-headerHeight, 0],
        }),
        duration: 0,
        useNativeDriver: true,
      })
    ]).start();
  }, [headerAnimation]);
  
  // Calculate scale based on scroll position
  const imageScale = scrollY.interpolate({
    inputRange: [-400, -0.1, 0],
    outputRange: [1.8, 1, 1],
    extrapolate: 'clamp'
  });
  
  // Modify logo animation to fade out when header appears
  const logoTransform = {
    translateY: scrollY.interpolate({
      inputRange: [0, height * 0.4, height * 0.5],
      outputRange: [0, 0, 0],
      extrapolate: 'clamp'
    }),
    opacity: scrollY.interpolate({
      inputRange: [0, height * 0.4, height * 0.5],
      outputRange: [1, 1, 0],
      extrapolate: 'clamp'
    })
  };
  
  // Add rating animation to match logo
  const ratingTransform = {
    opacity: scrollY.interpolate({
      inputRange: [0, height * 0.4, height * 0.5],
      outputRange: [1, 1, 0],
      extrapolate: 'clamp'
    })
  };
  
  // Debug the image fetching process - only log when logo changes
  React.useEffect(() => {
    if (images.logo) {
      console.log("Current logo path:", images.logo);
    }
  }, [images.logo]);
  
  // Fetch images in parallel with movie details
  React.useEffect(() => {
    if (id) {
      // Start fetching images immediately
      const fetchImageData = async () => {
        try {
          console.log("Fetching images for movie:", id);
          const movieImages = await fetchMovieImages(id as string);
          console.log("Received logo path:", movieImages.logo);
          
          // Only set images if they're not already set
          if (!posterFetched) {
            setImages({
              backdrop: movieImages.altPoster,
              logo: movieImages.logo
            });
            setPosterFetched(true);
          }
        } catch (error) {
          console.error('Error fetching images:', error);
        }
      };
      
      fetchImageData();
    }
  }, [id]);
  
  // Use movie backdrop as fallback
  React.useEffect(() => {
    if (movie && !images.backdrop && movie.backdrop_path) {
      setImages(prev => ({
        ...prev,
        backdrop: movie.backdrop_path
      }));
    }
  }, [movie, images.backdrop]);

  // Pull-to-reveal synopsis. Open/close animations are handled declaratively by
  // Reanimated entering/exiting on the overlay itself — the old imperative
  // Animated.parallel approach froze on the new architecture, leaving the overlay
  // mounted but invisible until an unrelated re-render (e.g. a tab tap) repainted it.
  const onRefresh = React.useCallback(() => {
    if (!synopsisVisible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setSynopsisVisible(true);
    }
  }, [synopsisVisible]);

  // Add these state handlers
  const [isLiked, setIsLiked] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);

  // Add these handlers
  const handleLike = () => {
    setIsLiked(!isLiked);
    if (isDisliked) setIsDisliked(false);
  };

  const handleDislike = () => {
    setIsDisliked(!isDisliked);
    if (isLiked) setIsLiked(false);
  };

  const handleFavorite = () => {
    setIsFavorite(!isFavorite);
  };

  const handleWatch = () => {
    // Implement watch functionality
    console.log('Watch movie:', movie?.id);
  };

  const handleTrailerPress = () => {
    if (trailers.length > 0) {
      setSelectedVideo(trailers[trailers.length - 1].key);
    }
  };

  const handleCloseVideo = () => {
    setSelectedVideo(null);
  };

  // Optimize image loading
  const imageUri = React.useMemo(() => {
    if (!images.backdrop && !movie?.backdrop_path) return null;
    return `https://image.tmdb.org/t/p/w1280${images.backdrop || movie?.backdrop_path}`;
  }, [images.backdrop, movie?.backdrop_path]);
  
  // Generate logo URI
  const logoUri = React.useMemo(() => {
    if (!images.logo) return null;
    return `https://image.tmdb.org/t/p/w500${images.logo}`;
  }, [images.logo]);

  // Animation values
  const cardOpacity = useRef(new Animated.Value(1)).current; // Start visible
  const contentOpacity = useRef(new Animated.Value(0)).current;
  
  // Only animate content when movie is loaded
  useEffect(() => {
    if (movie) {
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  }, [movie]);

  useEffect(() => {
    const loadTrailers = async () => {
      try {
        const fetchedTrailers = await fetchMovieVideos(id as string);
        setTrailers(fetchedTrailers);
      } catch (error) {
        console.error('Error loading trailers:', error);
      }
    };

    loadTrailers();
  }, [id]);

  // Add this new handler
  const handleStateChange = (newState: { isLiked: boolean; isDisliked: boolean; isFavorite: boolean }) => {
    setIsLiked(newState.isLiked);
    setIsDisliked(newState.isDisliked);
    setIsFavorite(newState.isFavorite);
  };

  // Add back the mainScrollViewRef
  const mainScrollViewRef = useRef<ScrollView>(null);

  // Add useEffect for status bar
  useEffect(() => {
    StatusBar.setHidden(true);
    return () => {
      StatusBar.setHidden(false);
    };
  }, []);

  if (loading && !imageUri) {
    return (
      <View className="bg-primary flex-1 justify-center items-center">
        <ActivityIndicator size="large" color="#9486ab" />
      </View>
    );
  }
  
  return (
    <View className="flex-1 bg-black">
      <StatusBar 
        hidden={true}
        translucent={true}
        backgroundColor="transparent"
        barStyle="light-content"
      />
      {/* Add Sticky Header */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: headerHeight,
          backgroundColor: 'rgba(0,0,0,0.98)',
          zIndex: 1000,
          opacity: headerOpacity,
          transform: [{ translateY: headerTranslateY }],
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.1)',
          paddingTop: Platform.OS === 'ios' ? 20 : 0, // Add padding for iOS status bar
        }}
      >
        <View style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
        }}>
          <View style={{ 
            flex: 1,
            marginRight: 12, // Add margin to prevent overlap with rating
          }}>
            {logoUri ? (
              <Image
                source={{ uri: logoUri }}
                style={{
                  height: headerLogoHeight,
                  width: headerLogoWidth,
                  resizeMode: 'contain',
                }}
                contentFit="contain"
                transition={0}
                cachePolicy="memory-disk"
              />
            ) : (
              <Text
                style={{
                  color: 'white',
                  fontSize: Platform.select({
                    ios: 20,
                    android: 18,
                    default: 19
                  }),
                  fontWeight: 'bold',
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {movie?.title}
              </Text>
            )}
          </View>
          
          {/* Rating in header */}
          {movie?.vote_average !== undefined && (
            <View style={{
              backgroundColor: 'rgba(0,0,0,0.75)',
              borderRadius: 10,
              paddingHorizontal: 8,
              paddingVertical: 6,
              flexDirection: 'row',
              alignItems: 'center',
              minWidth: 65, // Ensure minimum width for rating
            }}>
              <Text style={{
                color: movie.vote_average >= 7 ? '#4ade80' : 
                      movie.vote_average >= 5 ? '#FFAE42' : '#ef4444',
                fontSize: Platform.select({
                  ios: 16,
                  android: 15,
                  default: 15.5
                }),
                fontWeight: '700',
                marginRight: 2,
              }}>
                {movie.vote_average.toFixed(1)}
              </Text>
              <Text style={{
                color: 'rgba(255,255,255,0.6)',
                fontSize: Platform.select({
                  ios: 12,
                  android: 11,
                  default: 11.5
                }),
                fontWeight: '600',
                marginTop: 1,
              }}>
                /10
              </Text>
            </View>
          )}
        </View>
      </Animated.View>

      <Animated.ScrollView
        ref={mainScrollViewRef}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } }}],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        bounces={true}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 20,
        }}
        overScrollMode="never"
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={['transparent']}
            progressBackgroundColor="transparent"
            style={{ backgroundColor: 'transparent' }}
            progressViewOffset={height * 0.1}
          />
        }
      >
        {/* Synopsis overlay — revealed by pull-down, dismissed via the close button.
            Glass styling matches the floating tab bar (blur + tint + hairline border). */}
        {synopsisVisible && (
          <ReAnimated.View
            entering={FadeInDown.springify().damping(18)}
            exiting={FadeOutUp.duration(180)}
            style={styles.synopsisOverlay}
          >
            <BlurView
              intensity={50}
              tint="dark"
              experimentalBlurMethod="dimezisBlurView"
              style={styles.synopsisBlur}
            >
              <View style={styles.synopsisHeader}>
                <Text style={styles.synopsisTitle}>Synopsis</Text>
                <TouchableOpacity
                  onPress={() => setSynopsisVisible(false)}
                  hitSlop={12}
                  style={styles.synopsisClose}
                >
                  <Ionicons name="close" size={18} color="rgba(255,255,255,0.85)" />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                style={styles.synopsisScroll}
              >
                <Text style={styles.synopsisText}>{movie?.overview}</Text>
              </ScrollView>
            </BlurView>
          </ReAnimated.View>
        )}

        {/* Hero Section */}
        <View style={{
          position: 'relative',
          width: '100%',
          height: height * 0.7,
          zIndex: 2,
        }}>
          <Animated.View 
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              opacity: cardOpacity,
            }}
          >
            {/* Movie Backdrop */}
            <View style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(0,0,0,0.3)',
              overflow: 'hidden',
              zIndex: 2,
            }}>
              {imageUri ? (
                <Animated.View
                  style={{
                    width: '100%',
                    height: '100%',
                    transform: [{ scale: imageScale }],
                  }}
                >
                  <Image 
                    source={{uri: imageUri}}
                    style={{width: '100%', height: '100%'}}
                    contentFit="cover"
                    transition={imageTransitionDuration}
                    cachePolicy="memory-disk"
                  />
                  
                  {/* Top dark gradient for logo visibility */}
                  <LinearGradient
                    colors={['rgba(0,0,0,0.98)', 'transparent', 'transparent']}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: '60%',
                    }}
                  />
                  
                  {/* Bottom dark gradient for better text visibility */}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.98)']}
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '60%',
                    }}
                  />
                </Animated.View>
              ) : (
                <View style={{
                  width: '100%',
                  height: '100%',
                  backgroundColor: PLACEHOLDER_COLOR
                }} />
              )}

              {/* Simple floating logo */}
              {logoUri && (
                <Animated.View style={[
                  styles.logoContainer,
                  {
                    transform: [{ translateY: logoTransform.translateY }],
                    opacity: logoTransform.opacity
                  }
                ]}>
                  <Image
                    source={{ uri: logoUri }}
                    style={styles.logoImage}
                    contentFit="contain"
                    transition={0}
                    cachePolicy="memory-disk"
                  />
                  {movie?.tagline && (
                    <Text style={{
                      color: 'rgba(255,255,255,0.9)',
                      fontSize: 14,
                      fontStyle: 'italic',
                      textAlign: 'center',
                      marginTop: 12,
                      maxWidth: SCREEN_WIDTH * 0.8,
                    }}>
                      "{movie.tagline}"
                    </Text>
                  )}
                  <Text style={{
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 12,
                    fontWeight: '600',
                    textAlign: 'center',
                    marginTop: 8,
                    letterSpacing: 0.5,
                  }}>
                    Pull down for synopsis
                  </Text>
                </Animated.View>
              )}

              {/* Add movie title for cases where logo isn't available */}
              {!logoUri && movie?.title && (
                <Animated.View style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 20,
                  right: 20,
                  opacity: logoTransform.opacity,
                }}>
                  <LinearGradient
                    colors={[
                      'transparent',
                      'rgba(0,0,0,0.75)',
                      'rgba(0,0,0,0.95)'
                    ]}
                    style={{
                      position: 'absolute',
                      bottom: -20,
                      left: -20,
                      right: -20,
                      height: 100,
                    }}
                  />
                  <Text
                    style={{
                      color: 'white',
                      fontSize: 24,
                      fontWeight: 'bold',
                      textShadowColor: 'rgba(0, 0, 0, 0.75)',
                      textShadowOffset: { width: 0, height: 2 },
                      textShadowRadius: 4
                    }}
                  >
                    {movie.title}
                  </Text>
                  {movie?.tagline && (
                    <Text style={{
                      color: 'rgba(255,255,255,0.9)',
                      fontSize: 14,
                      fontStyle: 'italic',
                      marginTop: 8,
                      textShadowColor: 'rgba(0, 0, 0, 0.75)',
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 2,
                    }}>
                      "{movie.tagline}"
                    </Text>
                  )}
                  <Text style={{
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 12,
                    fontWeight: '600',
                    marginTop: 8,
                    letterSpacing: 0.5,
                  }}>
                    Pull down for synopsis
                  </Text>
                </Animated.View>
              )}
              
              {/* Rating Badge on Poster */}
              {movie?.vote_average !== undefined && (
                <Animated.View style={{
                  position: 'absolute',
                  top: Platform.OS === 'ios' ? 50 : 16,
                  right: 16,
                  backgroundColor: 'rgba(0,0,0,0.75)',
                  borderRadius: 10,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  flexDirection: 'row',
                  alignItems: 'center',
                  opacity: ratingTransform.opacity,
                  transform: [{ scale: 1.1 }], // Slightly larger on poster
                }}>
                  <Text style={{
                    color: movie.vote_average >= 7 ? '#4ade80' : 
                          movie.vote_average >= 5 ? '#FFAE42' : '#ef4444',
                    fontSize: 16,
                    fontWeight: '700',
                    marginRight: 2,
                  }}>
                    {movie.vote_average.toFixed(1)}
                  </Text>
                  <Text style={{
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 12,
                    fontWeight: '600',
                    marginTop: 1,
                  }}>
                    /10
                  </Text>
                </Animated.View>
              )}
            </View>
          </Animated.View>
        </View>

        {/* Container for content */}
        <View style={{
          zIndex: 2,
          marginTop: 8, // Reduced top margin
        }}>
          {/* Movie Action Buttons */}
          <View style={{ 
            paddingHorizontal: 20,
          }}>
            <MemoizedMovieActionButtons
              movieId={id}
              isLiked={isLiked}
              isDisliked={isDisliked}
              isFavorite={isFavorite}
              onLike={handleLike}
              onDislike={handleDislike}
              onFavorite={handleFavorite}
              onWatch={handleWatch}
              onTrailer={handleTrailerPress}
              hasTrailer={trailers.length > 0}
              onStateChange={handleStateChange}
            />
          </View>

          {/* Tab bar + tab content. This was wrapped in a scrollY-interpolated
              Animated.View (dim 0.3 → 1.0 over the first 100px of scroll), but the
              legacy Animated interpolation froze at its mount value on the new
              architecture, leaving everything below the hero permanently dimmed.
              The reveal effect was cut rather than rebuilt — full brightness always. */}
          <View style={{ marginTop: 8 }}>
            {movie && (
              <MemoizedMovieTabBar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                movie={movie}
                onTrailerSelect={(videoKey) => setSelectedVideo(videoKey)}
                selectedVideo={selectedVideo}
                onCloseVideo={handleCloseVideo}
                scrollViewRef={mainScrollViewRef}
              />
            )}
          </View>
        </View>

        {/* Trailer Player */}
        <TrailerPlayer
          videoId={selectedVideo}
          onClose={handleCloseVideo}
          rating={movie?.certification || 'NR'}
        />
      </Animated.ScrollView>
    </View>
  );
};

// Remove unused styles and state
const styles = StyleSheet.create({
  logoContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  logoImage: {
    width: SCREEN_WIDTH * 0.7,
    height: 100,
  },
  synopsisOverlay: {
    position: 'absolute',
    top: 90,
    left: 16,
    right: 16,
    maxHeight: '55%',
    zIndex: 1000,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  synopsisBlur: {
    // Tint over the blur; doubles as the fallback where blur is unavailable.
    backgroundColor: 'rgba(15, 15, 20, 0.55)',
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  synopsisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    paddingBottom: 10,
  },
  synopsisTitle: {
    color: '#9ccadf',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  synopsisClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  synopsisScroll: {
    flexGrow: 0,
  },
  synopsisText: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 15,
    lineHeight: 23,
    letterSpacing: 0.2,
  },
});

export default React.memo(MovieDetails);