import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { MovieDetails } from '../../interfaces/interfaces';
import PersonCard, { Person } from '../people/PersonCard';

const profileUrl = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w185${p}` : null);

// Top-billed cast shown as a grid; TMDB already returns them in billing order.
const MAX_CAST = 24;

/**
 * MovieCastTab — the "Cast" tab: the on-screen ensemble, faces forward. Each card
 * is the shared PersonCard (headshot → initials fallback) showing the actor and
 * the character they play.
 */
const MovieCastTab = ({ movie }: { movie: MovieDetails }) => {
  const cast: Person[] = (movie.cast ?? []).slice(0, MAX_CAST).map((c) => ({
    id: c.id,
    name: c.name,
    role: c.character ? `as ${c.character}` : '',
    imageUrl: profileUrl(c.profile_path),
  }));

  if (cast.length === 0) {
    return <Text style={styles.empty}>No cast information available.</Text>;
  }

  return (
    <View style={styles.grid}>
      {cast.map((person) => (
        <View key={person.id} style={styles.cell}>
          <PersonCard person={person} variant="portrait" />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Match Extras section rhythm: 12 horizontal cell pad, 24 between rows.
    marginHorizontal: -6,
    rowGap: 24,
  },
  cell: {
    width: '33.333%',
    paddingHorizontal: 6,
  },
  empty: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 24,
  },
});

export default MovieCastTab;
