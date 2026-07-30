import React, { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView, Dimensions } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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
// Two lines of title, always — reserved whether the title needs them or not, so every
// card is the same height and the year/rating rows line up across the rail. Letting the
// block size itself left the meta row of a one-line title sitting above its neighbours.
const TITLE_LINE_H = 17;
const TITLE_BLOCK_H = TITLE_LINE_H * 2;

/**
 * One card in the rail.
 *
 * The Pressable carries a PLAIN style object and nothing else. It used to take a
 * `({ pressed }) => [...]` function, which is the landmine this stack has bitten us with
 * repeatedly: the function's styles are unreliable, and when `width: CARD_W` went missing
 * the card sized itself to its widest CHILD instead — the title. Short titles gave a card
 * of exactly CARD_W; long ones gave a wider card, which is why the gaps down the rail were
 * uneven and why the snap stopped landing (snapToInterval assumes CARD_W + CARD_GAP).
 *
 * The press feedback therefore lives on an inner Animated.View, driven by a shared value on
 * the UI thread. Transform only: no layout, and no opacity animation that can be starved
 * mid-restore and leave the card dimmed while the next screen slides in.
 */
function SimilarCard({ movie, onPress }: { movie: SimilarMovie; onPress: () => void }) {
  const press = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(press.value, [0, 1], [1, 0.97]) }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(1, { duration: 90 });
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: 140 });
      }}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`Open ${movie.title}`}
    >
      <Animated.View style={pressStyle}>
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w342${movie.poster_path}` }}
          style={styles.poster}
          resizeMode="cover"
        />
        <Text style={styles.title} numberOfLines={2}>
          {movie.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{movie.release_date?.split('-')[0] ?? '—'}</Text>
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={11} color="#a8690f" />
            <Text style={styles.meta}>{movie.vote_average?.toFixed(1)}</Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

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
        <SimilarCard key={movie.id} movie={movie} onPress={() => openMovie(movie.id)} />
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
  // A plain object on purpose — see SimilarCard. This width is what the rail's snap
  // interval assumes, and it must not be able to go missing.
  card: {
    width: CARD_W,
  },
  poster: {
    width: CARD_W,
    height: POSTER_H,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  // Two lines reserved whether they are used or not, so the meta rows align across the
  // rail. A title longer than that ellipses rather than widening anything.
  title: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: TITLE_LINE_H,
    height: TITLE_BLOCK_H,
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
