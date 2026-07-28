import React, { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { fetchSimilarMovies } from '@/services/api';

interface SimilarMovie {
  id: number;
  title: string;
  poster_path: string;
  vote_average: number;
  release_date?: string;
}

interface MovieSimilarTabProps {
  movieId: string;
  // Provided by the details screen — pushes the tapped movie onto the in-sheet stack.
  onMovieSelect?: (movieId: number) => void;
}

// A stripped-down take on the trending carousel: poster + title + year + rating,
// no rank numbers, no floating logo. Every dimension is a fixed pixel value —
// percentage sizing inside the horizontal rail is what blew the cards up to
// full-screen before.
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_W = Math.round(SCREEN_WIDTH * 0.42);
const POSTER_H = Math.round(CARD_W * 1.5);
const CARD_GAP = 14;

/**
 * The SIMILAR tab — up to 8 movies from TMDB's /movie/{id}/similar (genre + keyword
 * matching) in a single-row snap carousel. Tapping a card hands the id up to the
 * details screen, which slides a fresh details view in from the right INSIDE the
 * current sheet (no router push — that lands behind the modal).
 */
export default function MovieSimilarTab({ movieId, onMovieSelect }: MovieSimilarTabProps) {
  const [movies, setMovies] = useState<SimilarMovie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      const results = await fetchSimilarMovies(movieId, 8);
      if (alive) {
        setMovies(results);
        setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [movieId]);

  const openMovie = (id: number) => {
    Haptics.selectionAsync();
    onMovieSelect?.(id);
  };

  if (loading) {
    return (
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>Finding similar movies...</Text>
      </View>
    );
  }

  if (movies.length === 0) {
    return (
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>No similar movies found</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={CARD_W + CARD_GAP}
      snapToAlignment="start"
      contentContainerStyle={styles.rail}
    >
      {movies.map((movie) => (
        <Pressable
          key={movie.id}
          onPress={() => openMovie(movie.id)}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Open ${movie.title}`}
        >
          <Image
            source={{ uri: `https://image.tmdb.org/t/p/w342${movie.poster_path}` }}
            style={styles.poster}
            resizeMode="cover"
          />
          <Text style={styles.title} numberOfLines={1}>
            {movie.title}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{movie.release_date?.split('-')[0] ?? '—'}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={11} color="#a8690f" />
              <Text style={styles.meta}>{movie.vote_average?.toFixed(1)}</Text>
            </View>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stateBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    height: 180,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  rail: {
    gap: CARD_GAP,
    paddingRight: 20,
  },
  card: {
    width: CARD_W,
  },
  cardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  poster: {
    width: CARD_W,
    height: POSTER_H,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '600',
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  meta: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
});
