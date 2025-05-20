import React, { memo, useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  Image, 
  TouchableOpacity, 
  Dimensions, 
  StyleSheet,
  ImageBackground
} from 'react-native';
import { Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome } from '@expo/vector-icons';
import { Movie } from '@/interfaces/interfaces';
import { fetchMovieVideos, fetchMovieImages } from '@/services/api';
import TrailerPlayer from '../TrailerPlayer';

interface UpcomingHeroProps {
  movie: Movie;
  onNotify?: (movieId: number) => void;
  isActive?: boolean;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 6; // Adding padding on both sides
const CARD_HEIGHT = 440;
const LOGO_HEIGHT = 90;
const LOGO_TOP_OFFSET = -40; // Adjust this value to change how much the logo overlaps

const UpcomingHero = ({ movie, onNotify, isActive = true }: UpcomingHeroProps) => {
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerId, setTrailerId] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  
  // Add an effect for image loading optimization
  const [loaded, setLoaded] = useState(false);
  
  useEffect(() => {
    if (isActive && !loaded) {
      setLoaded(true);
    }
  }, [isActive]);
  
  React.useEffect(() => {
    // Fetch movie logo
    const fetchLogo = async () => {
      try {
        const imageData = await fetchMovieImages(movie.id.toString());
        if (imageData.logo) {
          setLogoPath(imageData.logo);
        }
      } catch (error) {
        console.error('Error fetching logo:', error);
      }
    };
    
    fetchLogo();
  }, [movie.id]);
  
  if (!movie) return null;
  
  // Check if release date is in the future
  const releaseDate = new Date(movie.release_date);
  const today = new Date();
  
  // If already released, don't show
  if (releaseDate < today) return null;
  
  // Format release date for display
  const formatReleaseDate = (dateString: string) => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June', 
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const date = new Date(dateString);
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    // Calculate days remaining
    const timeDiff = date.getTime() - today.getTime();
    const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    return { day, month, year, daysRemaining };
  };
  
  const { day, month, year, daysRemaining } = formatReleaseDate(movie.release_date);

  const handleNotify = () => {
    if (onNotify) {
      onNotify(movie.id);
    }
  };
  
  const handlePlayTrailer = async () => {
    try {
      const videos = await fetchMovieVideos(movie.id.toString());
      if (videos && videos.length > 0) {
        setTrailerId(videos[0].key);
        setShowTrailer(true);
      }
    } catch (error) {
      console.error('Error fetching videos:', error);
    }
  };
  
  const handleCloseTrailer = () => {
    setShowTrailer(false);
    setTrailerId(null);
  };

  return (
    <View style={styles.container}>
      {/* Movie logo "sticker" overlapping the top */}
      {logoPath && (
        <View style={styles.logoOuterContainer}>
          <Image
            source={{ uri: `https://image.tmdb.org/t/p/w500${logoPath}` }}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
      )}
      
      <View style={styles.card}>
        <ImageBackground
          source={{ uri: `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` }}
          style={styles.backdropImage}
          resizeMode="cover"
        >
          <LinearGradient
            colors={[
              'rgba(0,0,0,0.8)',
              'rgba(0,0,0,0.4)',
              'rgba(0,0,0,0.2)',
              'rgba(0,0,0,0.6)',
              'rgba(0,0,0,0.9)',
            ]}
            locations={[0, 0.2, 0.5, 0.8, 1]}
            style={styles.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          >
            <Link href={`/movie/${movie.id}`} asChild>
              <TouchableOpacity activeOpacity={0.9} style={styles.contentTouchable}>
                {/* Extra space at top when logo is present */}
                {logoPath && <View style={styles.logoSpacePlaceholder} />}
                
                {/* Title - only show if no logo */}
                {!logoPath && (
                  <View style={styles.titleContainer}>
                    <Text style={styles.movieTitle}>{movie.title}</Text>
                  </View>
                )}
                
                <View style={styles.centralContent}>
                  <View style={styles.dateRow}>
                    <View style={styles.dateContainer}>
                      <Text style={styles.monthText}>{month.toUpperCase()}</Text>
                      <Text style={styles.dayText}>{day}</Text>
                      <Text style={styles.yearText}>{year}</Text>
                    </View>
                    
                    <View style={styles.separator} />
                    
                    <View style={styles.countdownContainer}>
                      <Text style={styles.countdownValue}>{daysRemaining}</Text>
                      <Text style={styles.countdownLabel}>DAYS REMAINING</Text>
                    </View>
                  </View>
                  
                  <Text style={styles.overview} numberOfLines={3}>
                    {movie.overview}
                  </Text>
                </View>
              </TouchableOpacity>
            </Link>
            
            <View style={styles.actionContainer}>
              <TouchableOpacity
                style={styles.trailerButton}
                onPress={handlePlayTrailer}
                activeOpacity={0.7}
              >
                <FontAwesome name="play" size={16} color="#fff" style={styles.buttonIcon} />
                <Text style={styles.buttonText}>WATCH TRAILER</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.notifyButton}
                onPress={handleNotify}
                activeOpacity={0.7}
              >
                <FontAwesome name="bell" size={16} color="#9ccadf" style={styles.buttonIcon} />
                <Text style={styles.notifyText}>NOTIFY ME</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </ImageBackground>
      </View>
      
      {/* Trailer Player */}
      {showTrailer && trailerId && (
        <TrailerPlayer 
          videoId={trailerId} 
          onClose={handleCloseTrailer} 
          rating={'NR'}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    height: CARD_HEIGHT + Math.abs(LOGO_TOP_OFFSET/2),
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 1,
  },
  logoOuterContainer: {
    position: 'absolute',
    top: 0,
    zIndex: 10,
    width: '100%',
    alignItems: 'center',
    height: LOGO_HEIGHT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.99,
    shadowRadius: 8,
  },
  logoImage: {
    width: CARD_WIDTH * 0.90,
    height: LOGO_HEIGHT -20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.99,
    shadowRadius: 6,
  },
  logoSpacePlaceholder: {
    height: LOGO_HEIGHT +40,
    width: '100%',
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    marginTop: LOGO_TOP_OFFSET , // This creates the overlap effect
  },
  backdropImage: {
    width: '100%',
    height: '100%',
    justifyContent: 'space-between',
  },
  gradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'space-between',
    paddingVertical: 24,
  },
  contentTouchable: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 24,
  },
  titleContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  centralContent: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 20,
    width: '100%',
  },
  dateContainer: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  dayText: {
    color: 'white',
    fontSize: 36,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  monthText: {
    color: '#9ccadf',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
  },
  yearText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    marginTop: 2,
  },
  separator: {
    width: 1,
    height: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 24,
  },
  countdownContainer: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  countdownValue: {
    color: 'white',
    fontSize: 36,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  countdownLabel: {
    color: '#9ccadf',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 4,
  },
  movieTitle: {
    color: 'white',
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 0.5,
  },
  overview: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: '90%',
  },
  actionContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },
  trailerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 45, 85, 0.15)',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85, 0.3)',
    maxWidth: 190,
    shadowColor: '#FF2D55',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  notifyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(156, 202, 223, 0.1)',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(156, 202, 223, 0.2)',
    maxWidth: 190,
    shadowColor: '#9CCADF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  notifyText: {
    color: '#9ccadf',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  }
});

export default memo(UpcomingHero);
