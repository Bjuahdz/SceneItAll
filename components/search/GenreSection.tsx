import React, { memo } from 'react';
import { View, Text, FlatList, StyleSheet, Dimensions, TouchableOpacity, Image, ImageBackground } from 'react-native';
import { Link } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { Movie } from '@/interfaces/interfaces';
import { LinearGradient } from 'expo-linear-gradient';
import { icons } from '@/constants/icons';

interface GenreSectionProps {
  movies: Movie[];
  title: string;
  genreId: number;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Icons for different genres
const genreIcons: {[key: number]: string} = {
  28: 'rocket', // Action
  12: 'compass', // Adventure
  878: 'space-shuttle', // Sci-Fi
  35: 'smile-o', // Comedy
  18: 'heartbeat', // Drama
  53: 'bolt', // Thriller
  27: 'warning', // Horror
  36: 'university', // History
  10751: 'users', // Family
};

const GenreSection = ({ movies, title, genreId }: GenreSectionProps) => {
  if (!movies || movies.length === 0) return null;
  
  const genreIcon = genreIcons[genreId] || 'film';
  
  // Get first 5 movies to display (reduced to accommodate larger cards)
  const displayMovies = movies.slice(0, 5);
  
  const renderMovieItem = ({ item }: { item: Movie }) => (
    <Link href={`/movie/${item.id}`} asChild>
      <TouchableOpacity style={styles.movieCard}>
        <Image
          source={{
            uri: item.poster_path
              ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
              : "https://placehold.co/600x400/1a1a1a/FFFFFF.png",
          }}
          style={styles.posterImage}
          resizeMode="cover"
        />
        
        <View style={styles.ratingBadge}>
          <Text style={styles.ratingText}>{item.vote_average.toFixed(1)}</Text>
        </View>
      </TouchableOpacity>
    </Link>
  );

  // Select a backdrop from one of the movies for the background
  const backdropPath = displayMovies.find(movie => movie.backdrop_path)?.backdrop_path;
  
  return (
    <View style={styles.container}>
      {/* Genre Section with Background */}
      <ImageBackground
        source={{
          uri: backdropPath
            ? `https://image.tmdb.org/t/p/w780${backdropPath}`
            : "https://placehold.co/600x400/1a1a1a/FFFFFF.png"
        }}
        style={styles.backgroundImage}
      >
        <LinearGradient
          colors={['rgba(13, 16, 14, 0.7)', 'rgba(13, 16, 14, 0.95)']}
          style={styles.gradientContainer}
        >
          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.titleSection}>
              <View style={styles.iconCircle}>
                <FontAwesome name={genreIcon} size={18} color="#9ccadf" />
              </View>
              <View>
                <Text style={styles.titleText}>{title}</Text>
              </View>
            </View>
            
            <Link href={`/genre/${genreId}`} asChild>
              <TouchableOpacity style={styles.viewAllButton}>
                <Text style={styles.viewAllText}>View All</Text>
                <FontAwesome name="angle-right" size={12} color="#9ccadf" />
              </TouchableOpacity>
            </Link>
          </View>
          
          {/* Movies Row */}
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={displayMovies}
            renderItem={renderMovieItem}
            keyExtractor={(item) => `genre-movie-${item.id}`}
            contentContainerStyle={styles.listContainer}
            decelerationRate="fast"
            removeClippedSubviews={true}
            maxToRenderPerBatch={5}
            initialNumToRender={3}
            windowSize={5}
          />
        </LinearGradient>
      </ImageBackground>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 15,
    borderRadius: 16,
    overflow: 'hidden',
    marginHorizontal: 20,
  },
  backgroundImage: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 16,
  },
  gradientContainer: {
    paddingTop: 16,
    paddingBottom: 20,
    borderRadius: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  titleSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(156, 202, 223, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  titleText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  countText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    marginTop: 2,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(156, 202, 223, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(156, 202, 223, 0.2)',
  },
  viewAllText: {
    color: '#9ccadf',
    fontSize: 12,
    fontWeight: '500',
    marginRight: 6,
  },
  listContainer: {
    paddingLeft: 16,
    paddingRight: 10,
    paddingTop: 4,
  },
  movieCard: {
    width: 140,
    height: 210,
    marginRight: 16,
    borderRadius: 10,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  posterImage: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  ratingBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  ratingText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: 'bold',
  }
});

export default memo(GenreSection); 