import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface GenreTagProps {
  genreId: number;
}

//now lets add a unique gradient effect similar to plex that has it based off the colors of the poster displayed. in our case we would want the gradient to be based off the movie poster in our hero section in the movie details page. 

// Standard TMDB genre IDs and their corresponding names
const genreMap: { [key: number]: string } = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  53: 'Thriller',
  10770: 'TV Movie',
  10752: 'War',
  37: 'Western'
};

const GenreTag = ({ genreId }: GenreTagProps) => {
  const genreName = genreMap[genreId];
  
  if (!genreName) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{genreName.toUpperCase()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#9ccadf',
    marginHorizontal: 4,
  },
  text: {
    color: '#9ccadf',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
  }
});

export default GenreTag;
