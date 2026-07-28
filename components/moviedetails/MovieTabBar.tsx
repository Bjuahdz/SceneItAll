/**
 * MovieTabBar Component
 * 
 * A comprehensive tab-based interface for displaying movie details, cast, extras, and similar movies.
 * Features a modern UI with animations, collapsible sections, and media galleries.
 */

import React from 'react';
import { View, Text, TouchableOpacity, Image, Dimensions, ScrollView, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchMovieVideos, TMDB_CONFIG } from '../../services/api';
import { useState, useEffect } from 'react';
import MovieDetailsTab from './MovieDetailsTab';
import MovieCastTab from './MovieCastTab';
import MovieSimilarTab from './MovieSimilarTab';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  MovieTabBarProps,
  TabType,
  MovieVideo
} from '../../interfaces/interfaces';

// Shared rhythm under the tab strip — every tab starts and spaces the same way.
const TAB_CONTENT_TOP = 16;
const TAB_SECTION_GAP = 24;
const SECTION_TITLE_GAP = 12;

const getCacheImageUri = (fileName: string) => {
  if (!FileSystem.cacheDirectory) {
    throw new Error('File-system cache directory is unavailable');
  }
  return `${FileSystem.cacheDirectory}${fileName}`;
};

/**
 * Downloads an image to cache and opens the OS share sheet directly — no
 * intermediate "what would you like to do?" dialog.
 */
const shareImage = async (imageUrl: string, fileName: string, dialogTitle: string) => {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert('Error', 'Sharing is not available on this device');
      return;
    }
    const downloadResult = await FileSystem.downloadAsync(imageUrl, getCacheImageUri(fileName));
    await Sharing.shareAsync(downloadResult.uri, {
      mimeType: 'image/jpeg',
      dialogTitle,
    });
    await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
  } catch (error) {
    console.error('Error sharing image:', error);
    Alert.alert('Error', 'Failed to share image');
  }
};

/**
 * NOTE: These sections live at MODULE scope on purpose. When they were declared
 * inside MovieTabBar's body, every parent re-render minted a brand-new component
 * type, so React unmounted + remounted each section — loading state reset, the
 * fetch effects re-ran, and the whole Extras tab flickered uncontrollably.
 */

/**
 * TrailersSection Component
 * Fetches and displays movie trailers with YouTube thumbnails
 */
const TrailersSection = ({
  movieId,
  onTrailerSelect,
}: { movieId: string; onTrailerSelect: (videoKey: string) => void }) => {
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

  if (loading) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>Loading trailers...</Text>
      </View>
    );
  }

  if (videos.length === 0) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>No trailers available</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={extrasStyles.rail}
    >
      {videos.map((video) => (
        <TouchableOpacity
          key={video.id}
          onPress={() => onTrailerSelect(video.key)}
          style={extrasStyles.wideCard}
        >
          <Image
            source={{
              uri: `https://img.youtube.com/vi/${video.key}/maxresdefault.jpg`,
            }}
            style={extrasStyles.cardImage}
            defaultSource={{ uri: `https://img.youtube.com/vi/${video.key}/hqdefault.jpg` }}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={extrasStyles.trailerScrim}
          >
            <Text style={extrasStyles.trailerName}>{video.name}</Text>
            <Text style={extrasStyles.trailerMeta}>
              {video.type} • {new Date(video.published_at).toLocaleDateString()}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

/**
 * BackdropsSection Component
 * Displays movie backdrop images — tap shares the full-res image directly.
 */
const BackdropsSection = ({ movieId }: { movieId: string }) => {
  const [backdrops, setBackdrops] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>Loading backdrops...</Text>
      </View>
    );
  }

  if (backdrops.length === 0) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>No backdrops available</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={extrasStyles.rail}
    >
      {backdrops.map((backdrop, index) => {
        const imageUrl = `https://image.tmdb.org/t/p/original${backdrop}`;
        return (
          <TouchableOpacity
            key={`backdrop-${index}`}
            onPress={() => shareImage(imageUrl, 'backdrop_image.jpg', 'Share Movie Backdrop')}
            style={extrasStyles.wideCard}
          >
            <Image
              source={{
                uri: `https://image.tmdb.org/t/p/w780${backdrop}`,
              }}
              style={extrasStyles.cardImage}
            />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.3)']}
              style={extrasStyles.hintScrim}
            >
              <Text style={extrasStyles.hintText}>Share</Text>
            </LinearGradient>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

/**
 * PostersSection Component
 * Displays movie poster images — tap shares the full-res image directly.
 */
const PostersSection = ({ movieId }: { movieId: string }) => {
  const [posters, setPosters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>Loading posters...</Text>
      </View>
    );
  }

  if (posters.length === 0) {
    return (
      <View style={extrasStyles.stateBox}>
        <Text style={extrasStyles.stateText}>No posters available</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={extrasStyles.rail}
    >
      {posters.map((poster, index) => {
        const imageUrl = `https://image.tmdb.org/t/p/original${poster}`;
        return (
          <TouchableOpacity
            key={`poster-${index}`}
            onPress={() => shareImage(imageUrl, 'poster_image.jpg', 'Share Movie Poster')}
            style={extrasStyles.posterCard}
          >
            <Image
              source={{
                uri: `https://image.tmdb.org/t/p/w342${poster}`,
              }}
              style={extrasStyles.cardImage}
            />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.3)']}
              style={extrasStyles.hintScrim}
            >
              <Text style={extrasStyles.hintText}>Share</Text>
            </LinearGradient>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

// Shared look for the three extras rails — one definition instead of three
// copies of the same inline objects.
const extrasStyles = StyleSheet.create({
  stateBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    height: 180,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  rail: {
    gap: 12,
    paddingRight: 20,
  },
  wideCard: {
    width: 280,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  posterCard: {
    width: 120,
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  trailerScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    height: '50%',
  },
  trailerName: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  trailerMeta: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4,
  },
  hintScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '500',
  },
});

/**
 * MovieTabBar Component
 * Main component for displaying movie information in a tabbed interface
 * 
 * @param activeTab - Currently selected tab
 * @param setActiveTab - Function to change the active tab
 * @param movie - Movie data object
 * @param onTrailerSelect - Handler for when a trailer is selected (the detail
 *        screen owns the single cinema player — no player renders here)
 * @param scrollViewRef - Reference to the main scroll view
 */
const MovieTabBar = ({
  activeTab, setActiveTab, movie, onTrailerSelect, scrollViewRef, onSimilarMovieSelect
}: MovieTabBarProps) => {
  // Available tabs configuration
  const tabs: { id: TabType; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'cast', label: 'Cast' },
    { id: 'extras', label: 'Extras' },
    { id: 'similar', label: 'Similar' },
  ];

  return (
    // Vertical rhythm is owned here: identical top inset + section gap for every tab.
    <View>
      {/* Tab Navigation Bar */}
      <View style={tabStyles.tabBar}>
        <View style={tabStyles.tabRow}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={tabStyles.tabHit}
            >
              <Text style={[
                tabStyles.tabLabel,
                activeTab === tab.id && tabStyles.tabLabelActive,
              ]}>
                {tab.label}
              </Text>
              {activeTab === tab.id && <View style={tabStyles.tabIndicator} />}
            </TouchableOpacity>
          ))}
        </View>
        <View style={tabStyles.tabRule} />
      </View>

      {/* Tab Content — same top pad for Details / Cast / Extras / Similar */}
      <View style={tabStyles.content}>
        {activeTab === 'details' && <MovieDetailsTab movie={movie} />}

        {activeTab === 'cast' && <MovieCastTab movie={movie} />}

        {activeTab === 'extras' && (
          <View style={tabStyles.sections}>
            <View style={tabStyles.section}>
              <Text style={tabStyles.sectionTitle}>Trailers</Text>
              <TrailersSection movieId={movie.id.toString()} onTrailerSelect={onTrailerSelect} />
            </View>
            <View style={tabStyles.section}>
              <Text style={tabStyles.sectionTitle}>Backdrops</Text>
              <BackdropsSection movieId={movie.id.toString()} />
            </View>
            <View style={tabStyles.section}>
              <Text style={tabStyles.sectionTitle}>Posters</Text>
              <PostersSection movieId={movie.id.toString()} />
            </View>
          </View>
        )}

        {activeTab === 'similar' && (
          <MovieSimilarTab movieId={movie.id.toString()} onMovieSelect={onSimilarMovieSelect} />
        )}
      </View>
    </View>
  );
};

const tabStyles = StyleSheet.create({
  tabBar: {
    paddingHorizontal: 20,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  tabHit: {
    paddingVertical: 12,
  },
  tabLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  tabLabelActive: {
    color: '#9ccadf',
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: '#9ccadf',
    borderRadius: 1.25,
  },
  tabRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  content: {
    paddingTop: TAB_CONTENT_TOP,
    paddingHorizontal: 20,
  },
  sections: {
    gap: TAB_SECTION_GAP,
  },
  section: {
    gap: SECTION_TITLE_GAP,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default MovieTabBar;
