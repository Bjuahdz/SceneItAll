import { View, Animated, Dimensions, ActivityIndicator, Text, Platform, RefreshControl, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { BlurView } from 'expo-blur';
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
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [showSynopsis, setShowSynopsis] = useState(false);
  const [synopsisVisible, setSynopsisVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [trailers, setTrailers] = useState<MovieVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [posterFetched, setPosterFetched] = useState(false);
  const imageTransitionDuration = 0;
  const [setIsOverviewExpanded] = useState(false);
  const synopsisRef = useRef<View>(null);
  const [synopsisHeight, setSynopsisHeight] = useState(0);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [isTextTruncated, setIsTextTruncated] = useState(false);
  const textRef = useRef(null);
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
  
  // Debug the image fetching process
  console.log("Current logo path:", images.logo);
  
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
              backdrop: movieImages.backdrop,
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

  // Custom refresh handler for synopsis
  const onRefresh = React.useCallback(async () => {
    if (!synopsisVisible && !isAnimating) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setShowSynopsis(true);
      setSynopsisVisible(true);
      Animated.parallel([
        Animated.spring(synopsisTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 50,
          friction: 7
        }),
        Animated.timing(synopsisOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true
        })
      ]).start();
    }
  }, [synopsisVisible, isAnimating]);

  // Add handler for synopsis tab click
  const handleSynopsisTabClick = () => {
    if (synopsisVisible && !isAnimating) {
      setIsAnimating(true);
      Animated.parallel([
        Animated.spring(synopsisTranslateY, {
          toValue: -100,
          useNativeDriver: true,
          tension: 50,
          friction: 7
        }),
        Animated.timing(synopsisOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true
        })
      ]).start(() => {
        setSynopsisVisible(false);
        setShowSynopsis(false);
        setIsAnimating(false);
      });
    }
  };

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

  useEffect(() => {
    if (movie?.overview) {
      // Simple way to estimate if text will be more than 4 lines
      const averageCharsPerLine = 35; // Approximate characters per line
      const estimatedLines = movie.overview.length / averageCharsPerLine;
      setIsTextTruncated(estimatedLines > 4);
    }
  }, [movie?.overview]);

  const isSynopsisLong = (text: string) => {
    // Calculate based on container width, font size, and average character width
    const containerWidth = Dimensions.get('window').width - 72; // Account for padding and margins
    const fontSize = 15;
    const averageCharWidth = fontSize * 0.6; // Approximate width of a character
    const charsPerLine = Math.floor(containerWidth / averageCharWidth);
    
    // Count words and estimate lines needed
    const words = text.split(' ');
    let currentLineLength = 0;
    let lineCount = 0;

    for (let word of words) {
      if (currentLineLength + word.length > charsPerLine) {
        lineCount++;
        currentLineLength = word.length + 1; // +1 for the space
      } else {
        currentLineLength += word.length + 1; // +1 for the space
      }
    }

    return lineCount > 4;
  };

  // Add this new handler
  const handleStateChange = (newState: { isLiked: boolean; isDisliked: boolean; isFavorite: boolean }) => {
    setIsLiked(newState.isLiked);
    setIsDisliked(newState.isDisliked);
    setIsFavorite(newState.isFavorite);
  };

  // Optimize the synopsis and tabBar styles
  const animatedStyles = React.useMemo(() => ({
    tabBar: {
      opacity: scrollY.interpolate({
        inputRange: [-50, 0, 100],
        outputRange: [0.3, 0.3, 1],
        extrapolate: 'clamp'
      }),
      translateY: scrollY.interpolate({
        inputRange: [-50, 0, 100],
        outputRange: [30, 30, 0],
        extrapolate: 'clamp'
      })
    }
  }), [scrollY, height]);

  // Add animation value for synopsis
  const synopsisTranslateY = useRef(new Animated.Value(-100)).current;
  const synopsisOpacity = useRef(new Animated.Value(0)).current;
  
  // Add back the mainScrollViewRef
  const mainScrollViewRef = useRef<ScrollView>(null);

  if (loading && !imageUri) {
    return (
      <View className="bg-primary flex-1 justify-center items-center">
        <ActivityIndicator size="large" color="#9486ab" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      {/* Add Sticky Header */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: headerHeight,
          backgroundColor: 'rgba(0,0,0,0.95)',
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
        {/* Synopsis Section - Only visible when pulled down */}
        {showSynopsis && (
          <Animated.View
            style={{
              position: 'absolute',
              top: 85,
              left: 16,
              right: 16,
              backgroundColor: 'rgba(15,15,20,0.98)',
              padding: 16,
              paddingTop: 20,
              zIndex: 1000,
              transform: [{
                translateY: synopsisTranslateY
              }],
              opacity: synopsisOpacity,
              borderRadius: 20,
              shadowColor: '#000',
              shadowOffset: {
                width: 0,
                height: 8,
              },
              shadowOpacity: 0.4,
              shadowRadius: 12,
              elevation: 12,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
              maxHeight: '60%',
            }}
          >
            {/* Background Gradient */}
            <LinearGradient
              colors={['rgba(148,134,171,0.1)', 'rgba(148,134,171,0.05)', 'transparent']}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '100%',
                opacity: 0.5,
              }}
            />

            {movie?.overview && (
              <View>
                <Text style={{
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 14,
                  lineHeight: 20,
                  textAlign: 'justify',
                  letterSpacing: 0.2,
                }}>
                  {movie.overview}
                </Text>
              </View>
            )}

            {/* Synopsis Label Button */}
            <TouchableOpacity
              onPress={handleSynopsisTabClick}
              style={{
                marginTop: 16,
                alignItems: 'center',
                paddingVertical: 8,
              }}
            >
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <View style={{
                  width: 40,
                  height: 1,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                }} />
                <Text style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 14,
                  fontWeight: '600',
                  letterSpacing: 0.5,
                  paddingHorizontal: 12,
                }}>
                  Synopsis
                </Text>
                <View style={{
                  width: 40,
                  height: 1,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                }} />
              </View>
            </TouchableOpacity>
          </Animated.View>
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
                    colors={['rgba(0,0,0,0.8)', 'transparent', 'transparent']}
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
                    colors={['transparent', 'rgba(0,0,0,0.9)']}
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '30%',
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

          {/* Update TabBar container spacing */}
          <Animated.View style={{
            marginTop: 8,
            opacity: animatedStyles.tabBar.opacity,
            transform: [{
              translateY: animatedStyles.tabBar.translateY
            }],
          }}>
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
          </Animated.View>
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
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.9,
    shadowRadius: 15,
    elevation: 20,
  }
});

export default React.memo(MovieDetails);