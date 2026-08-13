import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { MovieDetails } from '../../interfaces/interfaces';
import PersonCard from '../people/PersonCard';
import { useEntityOverlay } from '@/contexts/EntityOverlayContext';
import { useSheetLineage } from '@/contexts/MovieSheetContext';
import { prefetchEntity } from '@/services/entities';

const profileUrl = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w185${p}` : null);

// Top-billed cast shown as a grid; TMDB already returns them in billing order.
const MAX_CAST = 24;

/**
 * MovieCastTab — the "Cast" tab: the on-screen ensemble, faces forward. Each card
 * is the shared PersonCard (headshot → initials fallback) showing the actor and
 * the character they play.
 *
 * ▸ EVERY FACE IS A DOOR (enhance/cast). Tapping a card opens the person's
 * FULL-SCREEN entity page, grown from the headshot's touch-derived rect — the
 * overlay it opens through is the SHEET-SCOPED EntityOverlayProvider mounted in
 * the movie route (this tab renders inside it, so useEntityOverlay resolves to
 * that instance, never the search screen's). A card with no headshot opens with
 * no origin — the page just appears, the wordmark-tile rule: nothing to expand
 * from a card that shows no photograph.
 */
const MovieCastTab = ({ movie }: { movie: MovieDetails }) => {
  const { open } = useEntityOverlay();
  // Who this sheet is sitting on — the loop guard's one input. Null when the
  // sheet wasn't pushed from an entity page (search results, home rails).
  const lineage = useSheetLineage();
  const cast = (movie.cast ?? []).slice(0, MAX_CAST);

  if (cast.length === 0) {
    return <Text style={styles.empty}>No cast information available.</Text>;
  }

  return (
    <View style={styles.grid}>
      {cast.map((c) => (
        <View key={c.id} style={styles.cell}>
          <PersonCard
            person={{
              id: c.id,
              name: c.name,
              role: c.character ? `as ${c.character}` : '',
              imageUrl: profileUrl(c.profile_path),
            }}
            variant="portrait"
            onPress={(rect, remeasure) => {
              // ▸ THE LOOP GUARD (Bryan, 2026-08-12): tapping the person whose
              // page sits DIRECTLY beneath this sheet must not stack a duplicate
              // of the page you are standing on — the sheet folds back down
              // instead, returning you to their page wherever you left it.
              if (lineage?.beneath?.kind === 'person' && lineage.beneath.id === c.id) {
                lineage.dismissSheet();
                return;
              }
              // Start the page's requests NOW, on the tap — the page reuses this
              // exact promise, so the fetch runs alongside the grow (the search
              // flow's contract, copied verbatim).
              prefetchEntity('person', c.id);
              open({
                kind: 'person',
                id: c.id,
                // Artwork + name let the hero paint on the FIRST frame.
                seed: c.profile_path ? { imagePath: c.profile_path, name: c.name } : null,
                // Grow only out of a real photograph — an initials card has no
                // artwork to expand, so its page simply appears.
                origin: c.profile_path ? rect : null,
                remeasureOrigin: c.profile_path && rect ? remeasure : undefined,
              });
            }}
          />
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
