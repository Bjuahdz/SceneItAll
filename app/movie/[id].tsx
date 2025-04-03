import { View, Animated, Dimensions, ActivityIndicator, Text, ImageBackground, Image, Platform, RefreshControl, ScrollView, TouchableOpacity } from 'react-native'
import { BlurView } from 'expo-blur';
import React, { useState, useRef, useEffect } from 'react'
import { useLocalSearchParams } from 'expo-router';
import useFetch from '@/services/useFetch';
import { fetchMovieDetails, fetchMovieImages, fetchMovieLanguages } from '@/services/api';
import { LinearGradient } from 'expo-linear-gradient';
import MovieActionButtons from '@/components/MovieActionButtons';
import MovieTabBar from '@/components/MovieTabBar';

// Add new memoized components to prevent unnecessary re-renders
const MemoizedMovieActionButtons = React.memo(MovieActionButtons);
const MemoizedMovieTabBar = React.memo(MovieTabBar);

const MovieDetails = () => {
  const { id } = useLocalSearchParams();
  const [images, setImages] = useState<{ backdrop: string | null, logo: string | null }>({ backdrop: null, logo: null });
  const scrollY = useRef(new Animated.Value(0)).current;
  const { data: movie, loading } = useFetch(() => fetchMovieDetails(id as string));
  const { height } = Dimensions.get('window');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(false);
  const synopsisRef = useRef<View>(null);
  const [synopsisHeight, setSynopsisHeight] = useState(0);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [isTextTruncated, setIsTextTruncated] = useState(false);
  const textRef = useRef(null);
  
  // Calculate scale based on scroll position
  const imageScale = scrollY.interpolate({
    inputRange: [-400, -0.1, 0],
    outputRange: [1.8, 1, 1],
    extrapolate: 'clamp'
  });
  
  // Fetch images when movie details are loaded
  React.useEffect(() => {
    const getImages = async () => {
      if (movie?.id) {
        const movieImages = await fetchMovieImages(movie.id.toString());
        setImages({
          backdrop: movieImages.backdrop || movie.backdrop_path,
          logo: movieImages.logo
        });
      }
    };
    getImages();
  }, [movie?.id]);

  // Add refresh handler
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      if (movie?.id) {
        const [movieData, movieImages] = await Promise.all([
          fetchMovieDetails(movie.id.toString()),
          fetchMovieImages(movie.id.toString())
        ]);
        
        setImages({
          backdrop: movieImages.backdrop || movieData.backdrop_path,
          logo: movieImages.logo
        });
      }
    } catch (error) {
      console.error('Error refreshing:', error);
    } finally {
      setRefreshing(false);
    }
  }, [movie?.id]);

  // Add this function to calculate collapse threshold
  const calculateCollapseThreshold = (textLength: number, expanded: boolean) => {
    if (!expanded) return height * 0.2; // Default threshold when not expanded
    
    // Base threshold on synopsis content length
    const baseThreshold = height * 0.2;
    const contentBasedThreshold = Math.min(
      (textLength / 500) * height * 0.3, // Adjust threshold based on text length
      height * 0.5 // Maximum threshold
    );
    
    return Math.max(baseThreshold, contentBasedThreshold);
  };

  // Modify the synopsisTranslateY interpolation to create a smoother slide-up effect
  const synopsisTranslateY = scrollY.interpolate({
    inputRange: [0, height * 0.2],
    outputRange: [0, -height * 0.2],
    extrapolate: 'clamp'
  });

  // Update the contentTranslateY to move up more gradually
  const contentTranslateY = scrollY.interpolate({
    inputRange: [0, height * 0.2],
    outputRange: [0, -height * 0.2],
    extrapolate: 'clamp'
  });

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

  const handleTrailer = () => {
    // Implement trailer functionality
    console.log('Show trailer for movie:', movie?.id);
  };

  // Add a new ref to track if we're currently animating
  const isAnimating = useRef(false);

  // Update animation config
  const animationConfig = React.useMemo(() => ({
    // Initial pause before any animations start
    // Lower (0-30): Immediate start
    // Default (50): Slight pause
    // Higher (100-200): More dramatic pause
    initialDelay: 50,

    // Duration for movie card/poster fade in
    // Lower (300-400): Quick, snappy appearance
    // Default (500): Smooth fade
    // Higher (600-800): Slower, more dramatic reveal
    cardDuration: 500,

    // Pause between card fade-in completing and secondary elements starting
    // (synopsis, action buttons, and tab bar)
    // Lower (100): Quick succession
    // Default (200): Clear separation
    // Higher (300-500): More pronounced stagger effect
    contentDelay: 100,

    // How long secondary elements take to fade in
    // (controls fade duration of synopsis, buttons, and tab bar together)
    // Lower (300): Quick pop-in
    // Default (400): Smooth reveal
    // Higher (500-600): Gradual appearance
    contentDuration: 400,
  }), []);

  // Optimize interpolations using useMemo
  const animatedStyles = React.useMemo(() => ({
    synopsis: {
      opacity: scrollY.interpolate({
        inputRange: [0, height * 0.1, height * 0.2],
        outputRange: [1, 0.5, 0],
        extrapolate: 'clamp'
      }),
      translateY: scrollY.interpolate({
        inputRange: [0, height * 0.2],
        outputRange: [0, -height * 0.2],
        extrapolate: 'clamp'
      })
    },
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

  // Optimize image loading
  const imageUri = React.useMemo(() => 
    `https://image.tmdb.org/t/p/w1280${images.backdrop || movie?.backdrop_path}`,
    [images.backdrop, movie?.backdrop_path]
  );

  // Update the animation sequence
  useEffect(() => {
    if (!movie?.id) return;

    // Reset opacities
    cardOpacity.setValue(0);
    contentOpacity.setValue(0);

    const timeout = setTimeout(() => {
      // First animate the card
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: animationConfig.cardDuration,
        useNativeDriver: true,
      }).start(({ finished }) => {
        // Only start content animation after card animation is complete
        if (finished) {
          setTimeout(() => {
            Animated.timing(contentOpacity, {
              toValue: 1,
              duration: animationConfig.contentDuration,
              useNativeDriver: true,
            }).start();
          }, animationConfig.contentDelay);
        }
      });
    }, animationConfig.initialDelay);

    return () => clearTimeout(timeout);
  }, [movie?.id, animationConfig]);

  // Optimize scroll handler
  const handleScroll = React.useCallback(
    Animated.event(
      [{ nativeEvent: { contentOffset: { y: scrollY } }}],
      { 
        useNativeDriver: true,
        listener: (event: any) => {
          if (!isSynopsisExpanded || isAnimating.current) return;

          const offsetY = event.nativeEvent.contentOffset.y;
          const collapseThreshold = calculateCollapseThreshold(
            movie?.overview?.length || 0,
            isSynopsisExpanded
          );
          
          if (offsetY > collapseThreshold) {
            isAnimating.current = true;
            setIsSynopsisExpanded(false);
            setTimeout(() => {
              isAnimating.current = false;
            }, 300);
          }
        }
      }
    ),
    [isSynopsisExpanded, movie?.overview?.length]
  );

  // Add these near the top with other state declarations
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  if (loading) {
    return (
      <View className="bg-primary flex-1 justify-center items-center">
        <ActivityIndicator size="large" color="#9486ab" />
      </View>
    );
  }

  if (!movie) {
    return (
      <View className="bg-primary flex-1 justify-center items-center">
        <Text className="text-white">Movie not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <ImageBackground
        source={{uri: `https://image.tmdb.org/t/p/w1280${movie?.backdrop_path}`}}
        className="flex-1"
        resizeMode="cover"
      >
        <View className="absolute w-full h-full bg-black/70" />
        
        <BlurView intensity={30} tint="dark" className="flex-1">
      <Animated.ScrollView
        onScroll={handleScroll}
        scrollEventThrottle={16}
        bounces={true}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
              paddingTop: height * 0.1,
              paddingHorizontal: 20,
              paddingBottom: 20,
        }}
        overScrollMode="never"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#9486ab"
            colors={['#9486ab']}
            progressBackgroundColor="#151312"
            style={{ backgroundColor: 'transparent' }}
            progressViewOffset={height * 0.1}
          />
        }
      >
        {/* Main Container with Hero Card */}
        <View style={{
          position: 'relative',
          width: '100%',
          height: height * 0.3,
          borderRadius: 24,
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
          {/* Static Card */}
          <View style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: 24,
            backgroundColor: 'rgba(0,0,0,0.4)',
            overflow: 'hidden',
            zIndex: 2,
          }}>
          <Animated.Image 
              source={{uri: `https://image.tmdb.org/t/p/w1280${images.backdrop || movie.backdrop_path}`}}
              style={[{
                width: '100%',
                height: '100%',
                transform: [{ scale: imageScale }],
              }]}
            resizeMode="cover"
          />

              {/* Logo Section */}
            {images.logo && (
              <View style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 120,
              }}>
                <LinearGradient
                  colors={[
                    'transparent',
                    'rgba(0,0,0,0.6)',
                    'rgba(0,0,0,0.8)'
                  ]}
                  style={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                  }}
                />
                
                <View style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 0,
                  right: 0,
                  alignItems: 'center',
                }}>
                  <Image
                    source={{ uri: `https://image.tmdb.org/t/p/w500${images.logo}` }}
                    style={{
                      width: '70%',
                      height: 60,
                      shadowColor: '#fff',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.2,
                      shadowRadius: 5,
                      ...Platform.select({
                        android: {
                          elevation: 5,
                        },
                        ios: {
                          shadowColor: '#fff',
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.25,
                          shadowRadius: 3.84,
                        },
                      }),
                    }}
                    resizeMode="contain"
                  />
            </View>
              </View>
            )}

              {/* Add Rating Badge */}
              <View style={{
                position: 'absolute',
                top: 16,
                right: 16,
                backgroundColor: 'rgba(0,0,0,0.75)',
                borderRadius: 8,
                paddingHorizontal: 6,
                paddingVertical: 4,
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: movie.vote_average >= 7 ? 'rgba(74, 222, 128, 0.5)' :
                            movie.vote_average >= 5 ? 'rgba(255, 174, 66, 0.5)' :
                            'rgba(239, 68, 68, 0.5)',
              }}>
                <Text style={{
                  color: movie.vote_average >= 7 ? '#4ade80' : 
                        movie.vote_average >= 5 ? '#FFAE42' : '#ef4444',
                  fontSize: 14,
                  fontWeight: '700',
                  marginRight: 1,
                }}>
                  {movie.vote_average.toFixed(1)}
                </Text>
                <Text style={{
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 10,
                  fontWeight: '600',
                  marginTop: 1,
                }}>
                  /10
                </Text>
              </View>
          </View>

          {/* Static Gradient Border */}
          <View 
            style={{
              position: 'absolute',
              top: -4,
              left: -4,
              right: -4,
              bottom: -4,
              borderRadius: 24,
              zIndex: 1,
              shadowColor: '#9ccadf',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.5,
              shadowRadius: 15,
              elevation: 10,
            }}
          >
            <LinearGradient
              colors={[
                'rgba(148, 134, 171, 0.8)',
                'rgba(156, 202, 223, 0.8)',
                'rgba(148, 134, 171, 0.8)'
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 24,
              }}
            />
          </View>

          {/* Static Shadow */}
          <View style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: 24,
            backgroundColor: 'transparent',
            shadowColor: '#fff',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 20,
            elevation: 15,
            zIndex: 0,
          }} />
          </Animated.View>
            </View>

        {/* Synopsis Section */}
        <Animated.View 
          style={{
            marginTop: 15,
            marginHorizontal: 20,
            opacity: Animated.multiply(
              contentOpacity,
              animatedStyles.synopsis.opacity
            ),
            transform: [{ 
              translateY: animatedStyles.synopsis.translateY
            }],
            zIndex: 1,
          }}
        >
          <LinearGradient
            colors={[
              'rgba(156, 202, 223, 0.1)',
              'rgba(148, 134, 171, 0.05)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 16,
              padding: 16,
              position: 'relative',
            }}
          >
            <View 
              ref={synopsisRef}
              onLayout={(event) => {
                const { height } = event.nativeEvent.layout;
                setSynopsisHeight(height);
              }}
              style={{ flex: 1 }}
            >
              {movie.tagline && (
                <Text style={{
                  color: '#9ccadf',
                  fontSize: 14,
                  fontStyle: 'italic',
                  marginBottom: 8,
                  opacity: 0.9,
                }}>
                  "{movie.tagline}"
                </Text>
              )}
              <Text 
                style={{
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 15,
                  lineHeight: 24,
                  textAlign: 'justify',
                  marginBottom: 24,
                }}
                numberOfLines={isSynopsisExpanded ? undefined : 4}
              >
                {movie.overview}
              </Text>
              
              {/* Bottom border with Synopsis button */}
              <View style={{
                position: 'absolute',
                bottom: 0,
                left: 16,
                right: 16,
                height: 3,
                backgroundColor: '#9ccadf',
                opacity: 0.7,
                borderRadius: 1.5,
              }} />
              
              <TouchableOpacity
                onPress={() => {
                  if (!isAnimating.current) {
                    setIsSynopsisExpanded(!isSynopsisExpanded);
                  }
                }}
                style={{
                  position: 'absolute',
                  bottom: -10,
                  left: 0,
                  right: 0,
                  alignItems: 'center',
                }}
                activeOpacity={0.7}
              >
                <View style={{
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(156, 202, 223, 0.3)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 100,
                }}>
                  <Text style={{
                    color: '#9ccadf',
                    fontSize: 12,
                    fontWeight: '600',
                    letterSpacing: 0.5,
                  }}>
                    SYNOPSIS
              </Text>
                  {movie.overview && isSynopsisLong(movie.overview) && (
                    <View style={{
                      width: 16,
                      height: 16,
                      borderRadius: 8,
                      backgroundColor: 'rgba(156, 202, 223, 0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 6,
                    }}>
                      <Text style={{
                        color: '#9ccadf',
                        fontSize: 14,
                        fontWeight: '400',
                        lineHeight: 16,
                        textAlign: 'center',
                      }}>
                        {isSynopsisExpanded ? '−' : '+'}
              </Text>
            </View>
                  )}
                </View>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Container for content that slides up */}
        <Animated.View style={{
          opacity: contentOpacity,
          transform: [{ 
            translateY: contentTranslateY
          }],
          zIndex: 2,
        }}>
          {/* Movie Action Buttons */}
          <View style={{ 
            marginTop: 16,
            marginBottom: 8,
            paddingHorizontal: 20,
          }}>
            <MemoizedMovieActionButtons
              movieId={movie?.id}
              isLiked={isLiked}
              isDisliked={isDisliked}
              isFavorite={isFavorite}
              onLike={handleLike}
              onDislike={handleDislike}
              onFavorite={handleFavorite}
              onWatch={handleWatch}
              onTrailer={handleTrailer}
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
            <MemoizedMovieTabBar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              movie={movie}
            />
          </Animated.View>

          {/* Rest of the content */}
          {/* ... */}
        </Animated.View>
      </Animated.ScrollView>
        </BlurView>
      </ImageBackground>
    </View>
  );
};

export default React.memo(MovieDetails);