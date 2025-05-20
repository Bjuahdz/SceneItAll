/**
 * MovieTabBar Component
 * 
 * A comprehensive tab-based interface for displaying movie details, cast, extras, and similar movies.
 * Features a modern UI with animations, collapsible sections, and media galleries.
 */

import React from 'react';
import { View, Text, TouchableOpacity, Image, Dimensions, ScrollView, Alert, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchMovieVideos, TMDB_CONFIG } from '../../services/api';
import { useState, useEffect, useRef } from 'react';
import TrailerPlayer from '../TrailerPlayer';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { 
  MovieTabBarProps, 
  TabType, 
  Quality, 
  CollapsibleSectionProps 
} from '../../interfaces/interfaces';

/**
 * NoContentPlaceholder Component
 * Displays a standardized placeholder when content is unavailable
 * @param message - The message to display in the placeholder
 */
const NoContentPlaceholder = ({ message }: { message: string }) => (
  <View style={{
    alignItems: 'center',
    padding: 16,
    gap: 12,
  }}>
    <View style={{
      backgroundColor: 'rgba(156, 202, 223, 0.1)',
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'rgba(156, 202, 223, 0.15)',
    }}>
      <Ionicons 
        name="information-circle-outline" 
        size={24} 
        color="rgba(156, 202, 223, 0.6)" 
      />
    </View>
    <Text style={{
      color: 'rgba(255,255,255,0.5)',
      fontSize: 14,
      textAlign: 'center',
      fontStyle: 'italic',
    }}>
      {message}
    </Text>
  </View>
);

/**
 * CollapsibleSection Component
 * A reusable component that can show/hide content with a preview mode
 * @param title - Section title
 * @param children - Full content to display when expanded
 * @param previewContent - Preview content to show when collapsed
 * @param itemCount - Number of items in the section
 * @param hasContent - Whether the section has any content
 */
const CollapsibleSection = ({ title, children, previewContent, itemCount, hasContent }: CollapsibleSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMultipleItems = itemCount > 1;

  if (!hasContent) {
    return (
      <View style={{
        backgroundColor: 'rgba(156, 202, 223, 0.05)',
        borderRadius: 16,
        marginBottom: 16,
        overflow: 'hidden',
      }}>
        <View style={{
          padding: 16,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.1)',
        }}>
          <Text style={{
            color: 'rgba(255,255,255,0.9)',
            fontSize: 15,
            fontWeight: '600',
          }}>
            {title}
          </Text>
        </View>
        <NoContentPlaceholder message={`${title} unavailable`} />
      </View>
    );
  }

  return (
    <View style={{
      backgroundColor: 'rgba(156, 202, 223, 0.05)',
      borderRadius: 16,
      marginBottom: 16,
      overflow: 'hidden',
    }}>
      <TouchableOpacity
        onPress={() => hasMultipleItems && setIsExpanded(!isExpanded)}
        disabled={!hasMultipleItems}
        style={{
          padding: 16,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.1)',
        }}
      >
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Text style={{
            color: 'rgba(255,255,255,0.9)',
            fontSize: 15,
            fontWeight: '600',
          }}>
            {title}
          </Text>
          {hasMultipleItems && (
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color="#9ccadf"
            />
          )}
        </View>
      </TouchableOpacity>

      <View style={{
        padding: 16,
      }}>
        {hasMultipleItems ? (isExpanded ? children : previewContent) : children}
      </View>
    </View>
  );
};

/**
 * MovieTabBar Component
 * Main component for displaying movie information in a tabbed interface
 * 
 * @param activeTab - Currently selected tab
 * @param setActiveTab - Function to change the active tab
 * @param movie - Movie data object
 * @param onTrailerSelect - Handler for when a trailer is selected
 * @param selectedVideo - Currently selected video ID
 * @param onCloseVideo - Handler for closing the video player
 * @param scrollViewRef - Reference to the main scroll view
 */
const MovieTabBar = ({
  activeTab, setActiveTab, movie, onTrailerSelect, selectedVideo, onCloseVideo, scrollViewRef
}: MovieTabBarProps) => {
  // Available tabs configuration
  const tabs: { id: TabType; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'cast', label: 'Cast' },
    { id: 'extras', label: 'Extras' },
    { id: 'similar', label: 'Similar' },
  ];

  // Video quality options for trailers
  const qualities: Quality[] = [
    { label: '1080p', value: 'hd1080' },
    { label: '720p', value: 'hd720' },
    { label: '480p', value: 'large' },
    { label: '360p', value: 'medium' },
  ];

  /**
   * TrailersSection Component
   * Fetches and displays movie trailers with YouTube thumbnails
   */
  const TrailersSection = ({ movieId }: { movieId: string }) => {
    const [videos, setVideos] = useState<MovieVideo[]>([]);
    const [loading, setLoading] = useState(true);

    // Fetch trailers on component mount
    useEffect(() => {
      const loadVideos = async () => {
        try {
          const fetchedVideos = await fetchMovieVideos(movieId);
          setVideos(fetchedVideos);
        } catch (error) {
          console.error('Error loading videos:', error);
        } finally {
          setLoading(false);
        }
      };

      loadVideos();
    }, [movieId]);

    const handleTrailerPress = (videoKey: string) => {
      onTrailerSelect(videoKey);
    };

    if (loading) {
      return (
        <View style={{
          backgroundColor: 'rgba(255,255,255,0.05)',
          height: 180,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 14,
          }}>
            Loading trailers...
          </Text>
        </View>
      );
    }

    if (videos.length === 0) {
      return (
        <View style={{
          backgroundColor: 'rgba(255,255,255,0.05)',
          height: 180,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 14,
          }}>
            No trailers available
          </Text>
        </View>
      );
    }

    return (
      <>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 12,
            paddingRight: 20,
          }}
        >
          {videos.map((video) => (
            <TouchableOpacity
              key={video.id}
              onPress={() => handleTrailerPress(video.key)}
              style={{
                width: 280,
                height: 160,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
              }}
            >
              <Image
                source={{
                  uri: `https://img.youtube.com/vi/${video.key}/maxresdefault.jpg`,
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  resizeMode: 'cover',
                }}
                defaultSource={{ uri: `https://img.youtube.com/vi/${video.key}/hqdefault.jpg` }}
              />
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.8)']}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: 12,
                  height: '50%',
                }}
              >
                <Text style={{
                  color: 'white',
                  fontSize: 14,
                  fontWeight: '600',
                }}>
                  {video.name}
                </Text>
                <Text style={{
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 12,
                  marginTop: 4,
                }}>
                  {video.type} • {new Date(video.published_at).toLocaleDateString()}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </>
    );
  };

  /**
   * BackdropsSection Component
   * Displays movie backdrop images with sharing capabilities
   */
  const BackdropsSection = ({ movieId }: { movieId: string }) => {
    const [backdrops, setBackdrops] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    /**
     * Handles sharing of backdrop images
     * Shows options dialog and handles the sharing process
     */
    const handleSaveImage = async (imageUrl: string) => {
      try {
        Alert.alert(
          'Image Options',
          'What would you like to do with this image?',
          [
            {
              text: 'Cancel',
              style: 'cancel'
            },
            {
              text: 'Options',
              onPress: async () => {
                try {
                  const isAvailable = await Sharing.isAvailableAsync();
                  
                  if (isAvailable) {
                    // Download image directly to cache
                    const downloadResult = await FileSystem.downloadAsync(
                      imageUrl,
                      FileSystem.cacheDirectory + 'backdrop_image.jpg'
                    );

                    // Share the downloaded file
                    await Sharing.shareAsync(downloadResult.uri, {
                      mimeType: 'image/jpeg',
                      dialogTitle: 'Share Movie Backdrop'
                    });

                    // Clean up
                    await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
                  } else {
                    Alert.alert('Error', 'Sharing is not available on this device');
                  }
                } catch (error) {
                  console.error('Error sharing image:', error);
                  Alert.alert('Error', 'Failed to share image');
                }
              }
            }
          ]
        );
      } catch (error) {
        console.error('Error handling image share:', error);
        Alert.alert('Error', 'Failed to share image');
      }
    };

    useEffect(() => {
      const loadBackdrops = async () => {
        try {
          const response = await fetch(
            `${TMDB_CONFIG.BASE_URL}/movie/${movieId}/images`,
            {
              method: 'GET',
              headers: TMDB_CONFIG.headers,
            }
          );
          const data = await response.json();
          const cleanBackdrops = (data.backdrops || [])
            .filter((backdrop: any) => !backdrop.iso_639_1)
            .map((backdrop: any) => backdrop.file_path);
          setBackdrops(cleanBackdrops);
        } catch (error) {
          console.error('Error loading backdrops:', error);
        } finally {
          setLoading(false);
        }
      };

      loadBackdrops();
    }, [movieId]);

    if (loading) {
      return (
        <View style={{
          backgroundColor: 'rgba(255,255,255,0.05)',
          height: 180,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 14,
          }}>
            Loading backdrops...
          </Text>
        </View>
      );
    }

    if (backdrops.length === 0) {
      return (
        <View style={{
          backgroundColor: 'rgba(255,255,255,0.05)',
          height: 180,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 14,
          }}>
            No backdrops available
          </Text>
        </View>
      );
    }

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 12,
          paddingRight: 20,
        }}
      >
        {backdrops.map((backdrop, index) => {
          const imageUrl = `https://image.tmdb.org/t/p/original${backdrop}`;
          return (
            <TouchableOpacity
              key={`backdrop-${index}`}
              onPress={() => handleSaveImage(imageUrl)}
              style={{
                width: 280,
                height: 160,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
              }}
            >
              <Image
                source={{
                  uri: `https://image.tmdb.org/t/p/w780${backdrop}`,
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  resizeMode: 'cover',
                }}
              />
              {/* Add a subtle hint that the image is tappable */}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.3)']}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 40,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: 12,
                  fontWeight: '500',
                }}>
                  Image options
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  /**
   * PostersSection Component
   * Displays movie poster images with sharing capabilities
   */
  const PostersSection = ({ movieId }: { movieId: string }) => {
    const [posters, setPosters] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const handleSaveImage = async (imageUrl: string) => {
      try {
        Alert.alert(
          'Image Options',
          'What would you like to do with this image?',
          [
            {
              text: 'Cancel',
              style: 'cancel'
            },
            {
              text: 'Options',
              onPress: async () => {
                try {
                  const isAvailable = await Sharing.isAvailableAsync();
                  
                  if (isAvailable) {
                    // Download image directly to cache
                    const downloadResult = await FileSystem.downloadAsync(
                      imageUrl,
                      FileSystem.cacheDirectory + 'poster_image.jpg'
                    );

                    // Share the downloaded file
                    await Sharing.shareAsync(downloadResult.uri, {
                      mimeType: 'image/jpeg',
                      dialogTitle: 'Share Movie Poster'
                    });

                    // Clean up
                    await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
                  } else {
                    Alert.alert('Error', 'Sharing is not available on this device');
                  }
                } catch (error) {
                  console.error('Error sharing image:', error);
                  Alert.alert('Error', 'Failed to share image');
                }
              }
            }
          ]
        );
      } catch (error) {
        console.error('Error handling image share:', error);
        Alert.alert('Error', 'Failed to share image');
      }
    };

    useEffect(() => {
      const loadPosters = async () => {
        try {
          const response = await fetch(
            `${TMDB_CONFIG.BASE_URL}/movie/${movieId}/images`,
            {
              method: 'GET',
              headers: TMDB_CONFIG.headers,
            }
          );
          const data = await response.json();
          const cleanPosters = (data.posters || [])
            .filter((poster: any) => !poster.iso_639_1)
            .map((poster: any) => poster.file_path);
          setPosters(cleanPosters);
        } catch (error) {
          console.error('Error loading posters:', error);
        } finally {
          setLoading(false);
        }
      };

      loadPosters();
    }, [movieId]);

    if (loading) {
      return (
        <View style={{
          backgroundColor: 'rgba(255,255,255,0.05)',
          height: 180,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 14,
          }}>
            Loading posters...
          </Text>
        </View>
      );
    }

    if (posters.length === 0) {
      return (
        <View style={{
          backgroundColor: 'rgba(255,255,255,0.05)',
          height: 180,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 14,
          }}>
            No posters available
          </Text>
        </View>
      );
    }

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 12,
          paddingRight: 20,
        }}
      >
        {posters.map((poster, index) => {
          const imageUrl = `https://image.tmdb.org/t/p/original${poster}`;
          return (
            <TouchableOpacity
              key={`poster-${index}`}
              onPress={() => handleSaveImage(imageUrl)}
              style={{
                width: 120,
                height: 180,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
              }}
            >
              <Image
                source={{
                  uri: `https://image.tmdb.org/t/p/w342${poster}`,
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  resizeMode: 'cover',
                }}
              />
              {/* Add a subtle hint that the image is tappable */}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.3)']}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 40,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: 12,
                  fontWeight: '500',
                }}>
                  Image options
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  /**
   * ScrollToTopButton Component
   * Provides a button to scroll back to the top of the content
   */
  const ScrollToTopButton = () => (
    <TouchableOpacity
      onPress={() => {
        scrollViewRef?.current?.scrollTo({
          y: Dimensions.get('window').height * 0.3,
          animated: true
        });
      }}
      style={{
        alignSelf: 'center',
        marginTop: 40,
        marginBottom: 20,
        backgroundColor: 'rgba(156, 202, 223, 0.1)',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 25,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderWidth: 1,
        borderColor: 'rgba(156, 202, 223, 0.2)',
      }}
    >
      <Ionicons 
        name="chevron-up" 
        size={18} 
        color="#9ccadf" 
      />
      <Text style={{
        color: '#9ccadf',
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.5,
      }}>
        Back to Tabs
      </Text>
    </TouchableOpacity>
  );

  // Card flip animation state and refs
  const [isFlipped, setIsFlipped] = useState(false);
  const flipAnimation = useRef(new Animated.Value(0)).current;

  /**
   * Animation functions for card flip effect
   */
  const flipToBack = () => {
    Animated.spring(flipAnimation, {
      toValue: 180,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start();
    setIsFlipped(true);
  };

  const flipToFront = () => {
    Animated.spring(flipAnimation, {
      toValue: 0,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start();
    setIsFlipped(false);
  };

  // Animation interpolation for 3D card flip effect
  const frontInterpolate = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });

  const backInterpolate = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const frontAnimatedStyle = {
    transform: [{ rotateY: frontInterpolate }]
  };

  const backAnimatedStyle = {
    transform: [{ rotateY: backInterpolate }]
  };

  return (
    <View style={{ marginTop: 20 }}>
      {/* Video Player Component */}
      <TrailerPlayer
        videoId={selectedVideo}
        onClose={onCloseVideo}
        rating={movie.certification}
      />

      {/* Tab Navigation Bar */}
      <View style={{ 
        paddingHorizontal: 20,
      }}>
        {/* Tab Buttons */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 1,
          width: '100%',
        }}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={{
                paddingVertical: 12,
              }}
            >
              {/* Tab Label with Active Indicator */}
              <Text style={{
                color: activeTab === tab.id ? '#9ccadf' : 'rgba(255,255,255,0.6)',
                fontSize: 16,
                fontWeight: activeTab === tab.id ? '700' : '500',
                letterSpacing: 0.3,
              }}>
                {tab.label}
              </Text>
              {/* Active Tab Indicator Line */}
              {activeTab === tab.id && (
                <View style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 2.5,
                  backgroundColor: '#9ccadf',
                  borderRadius: 1.25,
                }} />
              )}
            </TouchableOpacity>
          ))}
        </View>
        
        {/* Tab Bar Bottom Border */}
        <View style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: 'rgba(255,255,255,0.1)',
          marginHorizontal: 20,
        }} />
      </View>

      {/* Tab Content Container */}
      <View style={{
        paddingTop: 20,
        paddingHorizontal: 20,
        minHeight: 200,
      }}>
        {/* Details Tab */}
        {activeTab === 'details' && (
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <View style={{ gap: 20, paddingBottom: 20 }}>
              {/* Movie Info Card with Flip Animation */}
              <View style={{
                backgroundColor: 'transparent',
                borderRadius: 16,
                marginBottom: 16,
              }}>
                {/* Card Flip Touch Handler */}
                <TouchableOpacity
                  onPress={() => isFlipped ? flipToFront() : flipToBack()}
                  activeOpacity={0.9}
                >
                  {/* Front Side of Card */}
                  <Animated.View style={[
                    {
                      backfaceVisibility: 'hidden',
                      backgroundColor: 'rgba(156, 202, 223, 0.05)',
                      borderRadius: 16,
                    },
                    frontAnimatedStyle
                  ]}>
                    {/* Movie Details Content */}
                    <View>
                      {/* Release Date and Status */}
                      <View style={{
                        padding: 20,
                        alignItems: 'center',
                        gap: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: 'rgba(255,255,255,0.1)',
                      }}>
                        <Text style={{
                          color: '#9ccadf',
                          fontSize: 18,
                          fontWeight: '600',
                          letterSpacing: 0.5,
                        }}>
                          {new Date(movie.release_date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </Text>
                        <View style={{
                          backgroundColor: 'rgba(156, 202, 223, 0.15)',
                          paddingHorizontal: 12,
                          paddingVertical: 4,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: 'rgba(156, 202, 223, 0.2)',
                        }}>
                          <Text style={{
                            color: '#9ccadf',
                            fontSize: 12,
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: 1,
                          }}>
                            {movie.status}
                          </Text>
                        </View>
                      </View>

                      {/* Rating, Runtime, Language */}
                      <View style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        padding: 20,
                        paddingTop: 16,
                        borderBottomWidth: 1,
                        borderBottomColor: 'rgba(255,255,255,0.1)',
                      }}>
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ 
                            color: 'rgba(255,255,255,0.6)', 
                            fontSize: 13, 
                            marginBottom: 6 
                          }}>
                            Rating
                          </Text>
                          <Text style={{ 
                            color: movie.certification === 'R' ? '#ef4444' : '#9ccadf', 
                            fontSize: 18, 
                            fontWeight: '600' 
                          }}>
                            {movie.certification}
                          </Text>
                        </View>

                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 6 }}>
                            Runtime
                          </Text>
                          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 18, fontWeight: '600' }}>
                            {movie.formattedRuntime}
                          </Text>
                        </View>

                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 6 }}>
                            Language
                          </Text>
                          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 18, fontWeight: '600' }}>
                            {movie.spoken_languages.find(lang => 
                              lang.iso_639_1 === movie.original_language
                            )?.english_name || movie.original_language.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      {/* Genres */}
                      <View style={{
                        padding: 20,
                        paddingTop: 16,
                        borderBottomWidth: 1,
                        borderBottomColor: 'rgba(255,255,255,0.1)',
                      }}>
                        {(() => {
                          // Format genre names
                          const formatGenreName = (name: string) => {
                            return name === "Science Fiction" ? "Sci-Fi" : name;
                          };

                          const genres = movie.genres.map(genre => ({
                            ...genre,
                            name: formatGenreName(genre.name)
                          }));

                          // Sort genres by text length
                          const sortedGenres = [...genres].sort((a, b) => a.name.length - b.name.length);
                          const genreCount = sortedGenres.length;

                          // For 4 genres, separate the longest one
                          if (genreCount === 4) {
                            const longestGenre = sortedGenres.pop(); // Remove longest genre
                            
                            return (
                              <View style={{ gap: 12 }}>
                                {/* First row with 3 genres */}
                                <View style={{
                                  flexDirection: 'row',
                                  justifyContent: 'center',
                                  gap: 8,
                                }}>
                                  {sortedGenres.map((genre) => (
                                    <View key={genre.id} style={{
                                      backgroundColor: 'rgba(156, 202, 223, 0.1)',
                                      paddingHorizontal: 12,
                                      paddingVertical: 6,
                                      borderRadius: 16,
                                      borderWidth: 1,
                                      borderColor: 'rgba(156, 202, 223, 0.15)',
                                    }}>
                                      <Text style={{
                                        color: '#9ccadf',
                                        fontSize: 13,
                                        fontWeight: '500',
                                      }}>
                                        {genre.name}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                                
                                {/* Second row with longest genre */}
                                <View style={{
                                  flexDirection: 'row',
                                  justifyContent: 'center',
                                }}>
                                  <View key={longestGenre.id} style={{
                                    backgroundColor: 'rgba(156, 202, 223, 0.1)',
                                    paddingHorizontal: 12,
                                    paddingVertical: 6,
                                    borderRadius: 16,
                                    borderWidth: 1,
                                    borderColor: 'rgba(156, 202, 223, 0.15)',
                                  }}>
                                    <Text style={{
                                      color: '#9ccadf',
                                      fontSize: 13,
                                      fontWeight: '500',
                                    }}>
                                      {longestGenre.name}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            );
                          }

                          // For all other counts (1, 2, 3, 5+)
                          // Rearrange based on count
                          if (genreCount === 2) {
                            // Longest on right
                            [sortedGenres[0], sortedGenres[1]] = [sortedGenres[1], sortedGenres[0]];
                          } else if (genreCount === 3) {
                            // Longest in middle
                            const middle = sortedGenres.pop();
                            sortedGenres.splice(1, 0, middle);
                          }

                          return (
                            <View style={{
                              flexDirection: 'row',
                              justifyContent: genreCount === 1 ? 'center' : 'center',
                              flexWrap: 'wrap',
                              gap: 8,
                            }}>
                              {sortedGenres.map((genre) => (
                                <View key={genre.id} style={{
                                  backgroundColor: 'rgba(156, 202, 223, 0.1)',
                                  paddingHorizontal: 12,
                                  paddingVertical: 6,
                                  borderRadius: 16,
                                  borderWidth: 1,
                                  borderColor: 'rgba(156, 202, 223, 0.15)',
                                }}>
                                  <Text style={{
                                    color: '#9ccadf',
                                    fontSize: 13,
                                    fontWeight: '500',
                                  }}>
                                    {genre.name}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          );
                        })()}
                      </View>

                      {/* Financial Info */}
                      <View style={{
                        padding: 20,
                        paddingTop: 16,
                      }}>
                        <View style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                        }}>
                          {/* Left Column */}
                          <View style={{
                            flex: 1,
                            alignItems: 'center',
                            paddingHorizontal: 8,
                          }}>
                            <Text style={{ 
                              color: 'rgba(255,255,255,0.6)', 
                              fontSize: 13,
                              marginBottom: 8,
                            }}>
                              Budget
                            </Text>
                            <Text style={{ 
                              color: 'rgba(255,255,255,0.9)', 
                              fontSize: 16, 
                              fontWeight: '700',
                            }}>
                              {movie.formattedBudget}
                            </Text>
                          </View>

                          {/* Center Column */}
                          <View style={{
                            flex: 1,
                            alignItems: 'center',
                            paddingHorizontal: 8,
                            borderLeftWidth: 1,
                            borderRightWidth: 1,
                            borderColor: 'rgba(255,255,255,0.08)',
                          }}>
                            <Text style={{ 
                              color: 'rgba(255,255,255,0.6)', 
                              fontSize: 13,
                              marginBottom: 8,
                            }}>
                              Revenue
                            </Text>
                            <Text style={{ 
                              color: '#9ccadf', 
                              fontSize: 16, 
                              fontWeight: '700',
                            }}>
                              {movie.formattedRevenue}
                            </Text>
                          </View>

                          {/* Right Column */}
                          <View style={{
                            flex: 1,
                            alignItems: 'center',
                            paddingHorizontal: 8,
                          }}>
                            <Text style={{ 
                              color: 'rgba(255,255,255,0.6)', 
                              fontSize: 13,
                              marginBottom: 8,
                            }}>
                              Profit
                            </Text>
                            <Text style={{
                              color: movie.formattedProfit.startsWith('-') ? 
                                'rgba(239, 68, 68, 0.9)' : 
                                'rgba(74, 222, 128, 0.9)',
                              fontSize: 16,
                              fontWeight: '700',
                            }}>
                              {movie.formattedProfit}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Footer Label - Front Side */}
                      <View style={{
                        borderTopWidth: 1,
                        borderTopColor: 'rgba(255,255,255,0.1)',
                        padding: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        backgroundColor: 'rgba(156, 202, 223, 0.08)',
                        borderBottomLeftRadius: 16,
                        borderBottomRightRadius: 16,
                        overflow: 'hidden',
                      }}>
                        <LinearGradient
                          colors={['rgba(156, 202, 223, 0.2)', 'rgba(156, 202, 223, 0.1)']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: 0,
                            bottom: 0,
                            borderBottomLeftRadius: 16,
                            borderBottomRightRadius: 16,
                          }}
                        />
                        <Ionicons 
                          name="film-outline" 
                          size={14} 
                          color="#9ccadf" 
                        />
                        <Text style={{
                          color: '#9ccadf',
                          fontSize: 12,
                          fontWeight: '600',
                          letterSpacing: 0.3,
                        }}>
                          View Production Studios
                        </Text>
                        <Ionicons 
                          name="chevron-forward" 
                          size={14} 
                          color="#9ccadf" 
                        />
                      </View>
                    </View>
                  </Animated.View>

                  {/* Back Side of Card */}
                  <Animated.View style={[
                    {
                      backfaceVisibility: 'hidden',
                      backgroundColor: 'rgba(156, 202, 223, 0.05)',
                      borderRadius: 16,
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                    },
                    backAnimatedStyle
                  ]}>
                    <View style={{
                      flex: 1,
                      justifyContent: 'center',
                      alignItems: 'center',
                      padding: 20,
                    }}>
                      {/* You can keep a placeholder or leave it empty */}
                      {/* <Text style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: 16,
                        fontStyle: 'italic',
                        textAlign: 'center',
                      }}>
                        Production Companies (coming soon)
                      </Text> */}
                    </View>

                    {/* Footer Label - Back Side */}
                    <View style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      borderTopWidth: 1,
                      borderTopColor: 'rgba(255,255,255,0.1)',
                      padding: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      backgroundColor: 'rgba(156, 202, 223, 0.08)',
                      borderBottomLeftRadius: 16,
                      borderBottomRightRadius: 16,
                      overflow: 'hidden',
                    }}>
                      <LinearGradient
                        colors={['rgba(156, 202, 223, 0.2)', 'rgba(156, 202, 223, 0.1)']}
                        start={{ x: 1, y: 0 }}
                        end={{ x: 0, y: 0 }}
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: 0,
                          bottom: 0,
                          borderBottomLeftRadius: 16,
                          borderBottomRightRadius: 16,
                        }}
                      />
                      <Ionicons 
                        name="stats-chart-outline" 
                        size={14} 
                        color="#9ccadf" 
                      />
                      <Text style={{
                        color: '#9ccadf',
                        fontSize: 12,
                        fontWeight: '600',
                        letterSpacing: 0.3,
                      }}>
                        View Movie Details
                      </Text>
                      <Ionicons 
                        name="chevron-back" 
                        size={14} 
                        color="#9ccadf" 
                      />
                    </View>
                  </Animated.View>
                </TouchableOpacity>
              </View>

              {/* Credits Section */}
              <CollapsibleSection 
                title="Credits & Crew"
                itemCount={Math.max(movie.directors?.length || 0, movie.writers?.length || 0)}
                hasContent={Boolean(movie.directors?.length || movie.writers?.length)}
                previewContent={
                  <View style={{ gap: 24 }}>
                    {/* Directors Preview */}
                    {movie.directors?.[0] && (
                      <View style={{
                        borderLeftWidth: 2,
                        borderLeftColor: '#9ccadf',
                        paddingLeft: 16,
                      }}>
                        <Text style={{
                          color: '#9ccadf',
                          fontSize: 13,
                          fontWeight: '600',
                          marginBottom: 12,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}>
                          {movie.directors.length > 1 ? 'Directors' : 'Director'}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{
                            color: 'rgba(255,255,255,0.9)',
                            fontSize: 15,
                          }}>
                            {movie.directors[0].name}
                          </Text>
                          {movie.directors.length > 1 && (
                            <Text style={{
                              color: 'rgba(156, 202, 223, 0.7)',
                              fontSize: 13,
                            }}>
                              +{movie.directors.length - 1}
                            </Text>
                          )}
                        </View>
                      </View>
                    )}
                    
                    {/* Writers Preview */}
                    {movie.writers?.[0] && (
                      <View style={{
                        borderLeftWidth: 2,
                        borderLeftColor: '#9ccadf',
                        paddingLeft: 16,
                      }}>
                        <Text style={{
                          color: '#9ccadf',
                          fontSize: 13,
                          fontWeight: '600',
                          marginBottom: 12,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}>
                          Writers
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{
                            color: 'rgba(255,255,255,0.9)',
                            fontSize: 15,
                          }}>
                            {movie.writers[0].name}
                          </Text>
                          <View style={{
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            backgroundColor: 'rgba(156, 202, 223, 0.1)',
                            borderRadius: 4,
                          }}>
                            <Text style={{
                              color: 'rgba(156, 202, 223, 0.8)',
                              fontSize: 12,
                            }}>
                              {movie.writers[0].job}
                            </Text>
                          </View>
                          {movie.writers.length > 1 && (
                            <Text style={{
                              color: 'rgba(156, 202, 223, 0.7)',
                              fontSize: 13,
                            }}>
                              +{movie.writers.length - 1}
                            </Text>
                          )}
                        </View>
                      </View>
                    )}
                  </View>
                }
              >
                <View style={{ gap: 32 }}>
                  {/* Full Directors List */}
                  {movie.directors?.length > 0 && (
                    <View style={{
                      borderLeftWidth: 2,
                      borderLeftColor: '#9ccadf',
                      paddingLeft: 16,
                    }}>
                      <Text style={{
                        color: '#9ccadf',
                        fontSize: 13,
                        fontWeight: '600',
                        marginBottom: 16,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}>
                        {movie.directors.length > 1 ? 'Directors' : 'Director'}
                      </Text>
                      <View style={{ gap: 12 }}>
                        {movie.directors.map(director => (
                          <Text key={director.id} style={{
                            color: 'rgba(255,255,255,0.9)',
                            fontSize: 15,
                          }}>
                            {director.name}
                          </Text>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Full Writers List */}
                  {movie.writers?.length > 0 && (
                    <View style={{
                      borderLeftWidth: 2,
                      borderLeftColor: '#9ccadf',
                      paddingLeft: 16,
                    }}>
                      <Text style={{
                        color: '#9ccadf',
                        fontSize: 13,
                        fontWeight: '600',
                        marginBottom: 16,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}>
                        Writers
                      </Text>
                      <View style={{ gap: 20 }}>
                        {/* Group writers by job */}
                        {Object.entries(
                          movie.writers.reduce((acc, writer) => {
                            if (!acc[writer.job]) {
                              acc[writer.job] = [];
                            }
                            acc[writer.job].push(writer);
                            return acc;
                          }, {} as Record<string, typeof movie.writers>)
                        ).map(([job, writers]) => (
                          <View key={job} style={{ gap: 12 }}>
                            <View style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              backgroundColor: 'rgba(156, 202, 223, 0.1)',
                              borderRadius: 4,
                              alignSelf: 'flex-start',
                            }}>
                              <Text style={{
                                color: 'rgba(156, 202, 223, 0.8)',
                                fontSize: 12,
                              }}>
                                {job}
                              </Text>
                            </View>
                            <View style={{ gap: 8, paddingLeft: 4 }}>
                              {writers.map(writer => (
                                <Text key={writer.id} style={{
                                  color: 'rgba(255,255,255,0.9)',
                                  fontSize: 15,
                                }}>
                                  {writer.name}
                                </Text>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              </CollapsibleSection>

              <ScrollToTopButton />
            </View>
          </ScrollView>
        )}
        
        {/* Cast Tab */}
        {activeTab === 'cast' && (
          <View style={{ gap: 24 }}>
            {/* Cast Grid Layout */}
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Text style={{
                color: 'rgba(255,255,255,0.9)',
                fontSize: 24,
                fontWeight: '700',
                textAlign: 'center',
              }}>
                Main Cast
              </Text>
            </View>

            <ScrollView 
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingBottom: 20,
              }}
            >
              <View style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-evenly',
                gap: 16,
                paddingHorizontal: 4,
              }}>
                {(movie.cast?.slice(0, 12) || []).map((item) => (
                  <View key={item.id} style={{
                    width: '28%',
                    alignItems: 'center',
                    marginBottom: 24,
                  }}>
                    {/* Cast Member Photo Card */}
                    <View style={{
                      width: 100,
                      height: 130,
                      borderRadius: 12,
                      overflow: 'hidden',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      shadowColor: '#9ccadf',
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 0.4,
                      shadowRadius: 8,
                      elevation: 8,
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor: 'rgba(156, 202, 223, 0.3)',
                    }}>
                      <Image
                        source={{ 
                          uri: item.profile_path 
                            ? `https://image.tmdb.org/t/p/w200${item.profile_path}`
                            : 'https://via.placeholder.com/200x200?text=No+Image'
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          resizeMode: 'cover',
                        }}
                      />
                      {/* Refined gradient overlay */}
                      <LinearGradient
                        colors={[
                          'transparent',
                          'rgba(0,0,0,0.5)',
                          'rgba(0,0,0,0.8)',
                          'rgba(0,0,0,0.9)',
                        ]}
                        locations={[0, 0.5, 0.8, 1]}
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: '50%',
                          justifyContent: 'flex-end',
                          padding: 8,
                        }}
                      >
                        <Text style={{
                          color: 'rgba(255,255,255,0.95)',
                          fontSize: 12,
                          fontWeight: '600',
                          textAlign: 'center',
                          textShadowColor: 'rgba(0,0,0,0.5)',
                          textShadowOffset: { width: 0, height: 1 },
                          textShadowRadius: 2,
                        }}>
                          {item.name}
                        </Text>
                      </LinearGradient>
                    </View>

                    {/* Character Name Below Card */}
                    <Text style={{
                      color: 'rgba(255,255,255,0.6)',
                      fontSize: 15,
                      textAlign: 'center',
                      marginTop: 1,
                    }}>
                      {item.character}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <ScrollToTopButton />
          </View>
        )}

        {/* Extras Tab */}
        {activeTab === 'extras' && (
          <ScrollView 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              gap: 24,
              paddingBottom: 20,
            }}
          >
            {/* Trailers Gallery */}
            <View style={{ gap: 12 }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <Text style={{
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 18,
                  fontWeight: '600',
                }}>
                  Trailers
                </Text>
              </View>
              
              <TrailersSection 
                movieId={movie.id.toString()} 
              />
            </View>

            {/* Backdrops Gallery */}
            <View style={{ gap: 12 }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <Text style={{
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 18,
                  fontWeight: '600',
                }}>
                  Backdrops
                </Text>
              </View>
              <BackdropsSection 
                movieId={movie.id.toString()}
              />
            </View>

            {/* Posters Gallery */}
            <View style={{ gap: 12 }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <Text style={{
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 18,
                  fontWeight: '600',
                }}>
                  Posters
                </Text>
              </View>
              <PostersSection 
                movieId={movie.id.toString()}
              />
            </View>
            <ScrollToTopButton />
          </ScrollView>
        )}

        {/* Similar Movies Tab (Placeholder) */}
        {activeTab === 'similar' && (
          <View>
            <Text style={{ color: 'rgba(255,255,255,0.9)' }}>Similar movies coming soon...</Text>
            <ScrollToTopButton />
          </View>
        )}
      </View>
    </View>
  );
};

export default MovieTabBar; 