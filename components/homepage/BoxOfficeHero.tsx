import React, { memo, useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  Image, 
  TouchableOpacity, 
  Dimensions, 
  StyleSheet,
  Platform,
  Animated
} from 'react-native';
import { Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome } from '@expo/vector-icons';
import { Movie } from '@/interfaces/interfaces';
import { Image as ExpoImage } from 'expo-image';

interface BoxOfficeHeroProps {
  movie: Movie;
  type: 'cashCows' | 'moneyPits';
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.9;
const MINI_HERO_HEIGHT = 400;
const PLACEHOLDER_BLURHASH = '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQM{M|azj[azf6fQfQfQIpWXofj[ayj[j[fQayWCoeoeaya}j[ayfQa{oLj?j[WVj[ayayj[fQoff7azayj[ayj[j[ayofayayayj[fQj[ayayj[ayfjj[j[ayjuayj[';

// Format currency outside component to avoid recreation on each render
const formatCurrency = (amount: number) => {
  if (amount === 0) return 'N/A';
  
  const absAmount = Math.abs(amount);
  
  if (absAmount >= 1000000000) {
    return `$${(absAmount / 1000000000).toFixed(1)}B`;
  } else if (absAmount >= 1000000) {
    return `$${(absAmount / 1000000).toFixed(1)}M`;
  } else if (absAmount >= 1000) {
    return `$${(absAmount / 1000).toFixed(1)}K`;
  } else {
    return `$${absAmount}`;
  }
};

// Create a separate component for the movie backdrop with optimized loading
const MovieBackdrop = memo(({ path, movieId }: { path: string, movieId: number }) => (
  <ExpoImage
    source={{ uri: `https://image.tmdb.org/t/p/w1280${path}` }}
    placeholder={PLACEHOLDER_BLURHASH}
    recyclingKey={`backdrop-${movieId}`}
    cachePolicy="memory-disk"
    transition={500}
    contentFit="cover"
    style={styles.backdropImage}
  />
));

// Create a separate component for the logo with optimized loading
const MovieLogo = memo(({ path, movieId }: { path: string | null, movieId: number }) => {
  if (!path) return null;
  return (
    <ExpoImage
      source={{ uri: `https://image.tmdb.org/t/p/w500${path}` }}
      placeholder={PLACEHOLDER_BLURHASH}
      recyclingKey={`logo-${movieId}`}
      cachePolicy="memory-disk"
      transition={300}
      contentFit="contain"
      style={styles.titleLogo}
    />
  );
});

const BoxOfficeHero = ({ movie, type }: BoxOfficeHeroProps) => {
  if (!movie) return null;
  
  // Add fade-in animation
  const [opacity] = useState(new Animated.Value(0));
  
  useEffect(() => {
    // Preload the backdrop and logo images
    if (movie) {
      const imagesToPreload = [];
      
      if (movie.backdrop_path) {
        imagesToPreload.push({ 
          uri: `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` 
        });
      }
      
      if (movie.logo_path) {
        imagesToPreload.push({ 
          uri: `https://image.tmdb.org/t/p/w500${movie.logo_path}` 
        });
      }
      
      if (imagesToPreload.length > 0) {
        ExpoImage.prefetch(imagesToPreload);
      }
      
      // Fade in the component once mounted
      Animated.timing(opacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }
  }, [movie]);
  
  // Calculate values once instead of using useMemo
  const budget = movie.budget || movie.popularity * 10000000;
  const revenue = movie.revenue || (movie.vote_average * movie.popularity * 2000000);
  const profit = revenue - budget;
  const profitValue = formatCurrency(profit);
  const formattedBudget = formatCurrency(budget);
  const formattedRevenue = formatCurrency(revenue);
  
  const isCashCow = type === 'cashCows';
  const releaseYear = movie.release_date?.split("-")[0];
  const rating = movie.vote_average.toFixed(1);
  
  return (
    <Animated.View style={[styles.cardWrapper, { opacity }]}>
      <Link href={`/movie/${movie.id}`} asChild>
        <TouchableOpacity activeOpacity={0.8} style={styles.container}>
          {/* Background Image with optimization */}
          <MovieBackdrop path={movie.backdrop_path} movieId={movie.id} />
          
          {/* Clean, professional gradient overlay */}
          <LinearGradient
            colors={[
              'rgba(0,0,0,0.1)',
              'rgba(0,0,0,0.7)',
              'rgba(0,0,0,0.9)'
            ]}
            locations={[0, 0.7, 1]}
            style={styles.mainGradient}
          />
          
          {/* Certification badge */}
          <View style={[
            styles.typeBadge, 
            isCashCow ? styles.cashCowBadge : styles.moneyPitBadge
          ]}>
            <Text style={styles.badgeText}>
              {isCashCow ? 'CASH COW' : 'MONEY PIT'}
            </Text>
          </View>
          
          {/* Content area */}
          <View style={styles.contentContainer}>            
            {/* Left section - Movie title (logo) and info */}
            <View style={styles.movieDetails}>
              {movie.logo_path ? (
                <MovieLogo path={movie.logo_path} movieId={movie.id} />
              ) : (
                <Text style={styles.title} numberOfLines={2}>
                  {movie.title}
                </Text>
              )}
              
              <View style={styles.infoRow}>
                <Text style={styles.year}>{releaseYear}</Text>
                <View style={styles.ratingContainer}>
                  <FontAwesome name="star" size={12} color="#FFD700" />
                  <Text style={styles.rating}>{rating}</Text>
                </View>
              </View>
            </View>
            
            {/* Right section - Financial data */}
            <View style={styles.financialSection}>
              <View style={styles.profitWrapper}>
                <View style={[
                  styles.profitContainer,
                  isCashCow ? styles.profitGreen : styles.profitRed
                ]}>
                  <FontAwesome 
                    name={isCashCow ? "arrow-up" : "arrow-down"} 
                    size={16} 
                    color={isCashCow ? "#7fec7f" : "#fc7676"} 
                    style={styles.profitIcon}
                  />
                  <Text style={[
                    styles.profitValue,
                    isCashCow ? styles.profitText : styles.lossText
                  ]}>
                    {profitValue}
                  </Text>
                </View>
              </View>
              
              <View style={styles.financeRows}>
                <View style={styles.financeRow}>
                  <Text style={styles.financeLabel}>Budget</Text>
                  <Text style={styles.financeValue}>{formattedBudget}</Text>
                </View>
                <View style={styles.rowDivider} />
                <View style={styles.financeRow}>
                  <Text style={styles.financeLabel}>Revenue</Text>
                  <Text style={styles.financeValue}>{formattedRevenue}</Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Link>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  cardWrapper: {
    width: CARD_WIDTH,
    marginRight: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  container: {
    width: '100%',
    height: MINI_HERO_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0d100e',
  },
  backdropImage: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: '#151515', // Placeholder color while loading
  },
  mainGradient: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  typeBadge: {
    position: 'absolute',
    top: 16,
    right: 0,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  cashCowBadge: {
    backgroundColor: 'rgba(127, 236, 127, 0.9)',
  },
  moneyPitBadge: {
    backgroundColor: 'rgba(252, 118, 118, 0.9)',
  },
  badgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  contentContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    flexDirection: 'row',
    borderRadius: 12,
  },
  movieDetails: {
    flex: 1,
    paddingRight: 16,
    justifyContent: 'flex-end',
  },
  title: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  year: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    marginRight: 14,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  rating: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  financialSection: {
    width: 145,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  profitWrapper: {
    width: '100%',
    marginBottom: 10,
    padding: 1,
  },
  profitContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderWidth: 1,
    overflow: 'visible',
  },
  profitGreen: {
    borderColor: 'rgba(127, 236, 127, 0.5)',
  },
  profitRed: {
    borderColor: 'rgba(252, 118, 118, 0.5)',
  },
  profitIcon: {
    marginRight: 6,
  },
  profitValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  profitText: {
    color: '#7fec7f',
  },
  lossText: {
    color: '#fc7676',
  },
  financeRows: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  financeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 4,
  },
  financeLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
  },
  financeValue: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  titleLogo: {
    width: '100%',
    height: 65,
    marginBottom: 8,
  },
});

export default memo(BoxOfficeHero);