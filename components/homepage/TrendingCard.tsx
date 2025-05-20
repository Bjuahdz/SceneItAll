import { Link } from "expo-router";
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions, Animated } from "react-native";
import React, { useMemo, useState, useEffect, useRef } from "react";
import MaskedView from "@react-native-masked-view/masked-view";
import { TrendingCardProps, TrendingMovie } from "@/interfaces/interfaces";
import { LinearGradient } from "expo-linear-gradient";

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.7;
const CARD_HEIGHT = CARD_WIDTH * 1.5;
const LOGO_HEIGHT = 290;
const LOGO_TOP_OFFSET = -107;
const LOGO_MAX_WIDTH = CARD_WIDTH * 0.9;

// Performance optimized 3D number with fewer layers
const TrendingNumber = React.memo(({ number }: { number: number }) => {
  // Further reduced from 4 to 2 layers for better performance
  const TOTAL_LAYERS = 2;
  
  const layers = useMemo(() => {
    const elements = [];
    
    // Create fewer base layers for depth but maintain 3D effect
    for (let i = TOTAL_LAYERS; i > 0; i--) {
      const depth = Math.pow(i, 1.5) / 2;
      
      elements.push(
        <Text 
          key={`base-${i}`}
          style={[
            styles.rankingLayer,
            {
              left: depth,
              top: depth,
              color: '#2a5e7e',
              zIndex: TOTAL_LAYERS - i,
            }
          ]}
        >
          {number}
        </Text>
      );
    }
    
    // Front face with gradient
    elements.push(
      <MaskedView 
        key="front"
        style={{zIndex: TOTAL_LAYERS}}
        maskElement={
          <Text style={styles.rankingLayer}>
            {number}
          </Text>
        }
      >
        <LinearGradient
          colors={['#e8f0f5', '#9ccadf', '#4a8eae']}
          locations={[0.1, 0.5, 0.9]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.rankingGradient}
        />
      </MaskedView>
    );
    
    return elements;
  }, [number]);
  
  return <>{layers}</>;
});

// Extended interface for trending movies with additional fields
interface ExtendedTrendingMovie extends TrendingMovie {
  logo_path?: string | null;
  clean_poster_url?: string;
}

// Improved movie logo component with detailed tweaking options
const MovieLogo = React.memo(({ 
  logoPath,
  logoOpacity,
  logoTransform
}: { 
  logoPath: string | null,
  logoOpacity: Animated.AnimatedInterpolation<number>,
  logoTransform: {
    translateY: Animated.AnimatedInterpolation<number>,
    scale: Animated.AnimatedInterpolation<number>
  }
}) => {
  const [logoSize, setLogoSize] = useState({ width: LOGO_MAX_WIDTH, height: LOGO_HEIGHT * 0.5 });
  
  if (!logoPath) return null;
  
  return (
    <Animated.View 
      style={[
        styles.logoOuterContainer,
        {
          opacity: logoOpacity,
          transform: [
            { translateY: logoTransform.translateY },
            { scale: logoTransform.scale }
          ]
        }
      ]}
    >
      <View style={styles.logoWrapper}>
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w500${logoPath}` }}
          style={[
            styles.logoImage,
            { width: logoSize.width, height: logoSize.height }
          ]}
          resizeMode="contain"
          fadeDuration={0}
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source;
            if (width && height) {
              // Calculate the aspect ratio
              const aspectRatio = width / height;
              
              let newWidth, newHeight;
              
              if (aspectRatio <= 1) {
                // For tall/square logos (like Marvel, Sony Pictures)
                // TWEAK POINT 1: Adjust this value (0.7) to change how tall the vertical logos appear
                // Higher value = taller logos (range 0.3-0.9)
                newHeight = LOGO_HEIGHT * 0.4; 
                newWidth = newHeight * aspectRatio;
                
                // TWEAK POINT 2: Adjust the minimum width for tall logos
                // Higher value = wider minimum width (range 0.2-0.6)
                // This helps very tall logos not appear too skinny
                if (newWidth < LOGO_MAX_WIDTH * 0.4) {
                  newWidth = LOGO_MAX_WIDTH * 0.8;
                  newHeight = newWidth / aspectRatio;
                }
              } else if (aspectRatio <= 2) {
                // For medium width logos (like Disney, Pixar)
                // TWEAK POINT 3: Adjust this value (0.7) to change how wide the medium-width logos appear
                // Higher value = wider logos (range 0.5-0.9)
                newWidth = LOGO_MAX_WIDTH * 0.7;
                newHeight = newWidth / aspectRatio;
              } else {
                // For very wide logos (like Star Wars, Top Gun)
                // TWEAK POINT 4: Adjust this value (1.0) to control the width of wide logos
                // Lower to make them less wide (range 0.7-1.0)
                newWidth = LOGO_MAX_WIDTH * 1.0;
                newHeight = newWidth / aspectRatio;
                
                // TWEAK POINT 5: Minimum height for wide logos
                // Increase this value (0.2) to make very wide logos taller (range 0.1-0.4)
                if (newHeight < LOGO_HEIGHT * 0.2) {
                  newHeight = LOGO_HEIGHT * 0.9;
                  newWidth = newHeight * aspectRatio;
                }
              }
              
              // TWEAK POINT 6: Maximum width cap
              // You can adjust LOGO_MAX_WIDTH at the top of the file
              newWidth = Math.min(newWidth, LOGO_MAX_WIDTH);
              
              // TWEAK POINT 7: Maximum height cap for all logos
              // Increase this value (0.7) to allow taller logos (range 0.5-0.9)
              newHeight = Math.min(newHeight, LOGO_HEIGHT * 0.9);
              
              // Update the logo size state
              setLogoSize({ width: newWidth, height: newHeight });
            }
          }}
        />
      </View>
    </Animated.View>
  );
});

interface ParallaxTrendingCardProps extends TrendingCardProps {
  scrollX: Animated.Value;
  itemIndex: number;
  itemWidth: number;
}

const TrendingCard = ({
  movie,
  index,
  scrollX,
  itemIndex,
  itemWidth
}: ParallaxTrendingCardProps) => {
  const { movie_id, title, poster_url } = movie;
  const extendedMovie = movie as ExtendedTrendingMovie;
  
  // Simplified parallax effect - only calculate for current card and adjacent cards
  const inputRange = [
    (itemIndex - 1) * itemWidth,
    itemIndex * itemWidth,
    (itemIndex + 1) * itemWidth
  ];
  
  // Scale animation: 0.92 when not active, 1 when active (reduced range for better performance)
  const scale = scrollX.interpolate({
    inputRange,
    outputRange: [0.92, 1, 0.92],
    extrapolate: 'clamp'
  });
  
  // Card opacity animation (0.7 to 1 for better visibility)
  const opacity = scrollX.interpolate({
    inputRange,
    outputRange: [0.7, 1, 0.7],
    extrapolate: 'clamp'
  });
  
  // For the active logo detection, use a narrower range
  const activeInputRange = [
    itemIndex * itemWidth - (itemWidth * 0.3),  // Start when we're 30% of the way to the center
    itemIndex * itemWidth,                      // Full opacity at center
    itemIndex * itemWidth + (itemWidth * 0.3)   // End when we're 30% past the center
  ];
  
  // Logo opacity - only visible when close to the center (0 to 1)
  const logoOpacity = scrollX.interpolate({
    inputRange: activeInputRange,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp'
  });
  
  // Logo transform animations
  const logoTransform = {
    translateY: scrollX.interpolate({
      inputRange: activeInputRange,
      outputRange: [20, -40, 20], // Bigger movement for more dramatic effect
      extrapolate: 'clamp'
    }),
    scale: scrollX.interpolate({
      inputRange: activeInputRange,
      outputRange: [0.8, 1.2, 0.8], // Grow when active
      extrapolate: 'clamp'
    })
  };
  
  return (
    <Link href={`/movie/${movie_id}`} asChild>
      <TouchableOpacity>
        <Animated.View 
          style={[
            styles.container,
            {
              transform: [{ scale }],
              opacity
            }
          ]}
        >
          {/* Movie logo with dramatic pop-up effect when active */}
          <MovieLogo 
            logoPath={extendedMovie.logo_path}
            logoOpacity={logoOpacity}
            logoTransform={logoTransform}
          />
          
          {/* 3D Number with performance optimization */}
          <View style={styles.rankingContainer}>
            <TrendingNumber number={index + 1} />
          </View>
          
          <View style={styles.card}>
            <Image
              source={{ uri: extendedMovie.clean_poster_url || poster_url }}
              style={styles.posterImage}
              resizeMode="cover"
              fadeDuration={0}
            />
            
            {/* Top gradient to help logos stand out better */}
            <LinearGradient
              colors={['rgba(0,0,0,0.7)', 'transparent']}
              style={styles.topGradient}
            />
            
            {/* Bottom gradient for better number visibility */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.9)']}
              style={styles.bottomGradient}
            />
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Link>
  );
};

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginLeft: 20,
    marginBottom: 10,
    marginTop: 10,
  },
  logoOuterContainer: {
    position: 'absolute',
    top: LOGO_TOP_OFFSET,
    zIndex: 10,
    width: '100%',
    alignItems: 'center',
    height: LOGO_HEIGHT,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
  logoWrapper: {
    // This centers the logo within its container
    alignItems: 'center',
    justifyContent: 'center',
    width: LOGO_MAX_WIDTH,
    height: LOGO_HEIGHT * 0.6,
  },
  logoImage: {
    // Size is dynamically set based on aspect ratio
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, 
    shadowRadius: 6,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 30, // Reduced from 60 to a more standard card radius
    overflow: 'hidden',
    position: 'relative',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  topGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '30%',
  },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '30%',
  },
  rankingContainer: {
    position: 'absolute',
    bottom: -40,
    left: -40,
    zIndex: 10,
    width: 180,
    height: 180,
  },
  rankingLayer: {
    position: 'absolute',
    fontSize: 160,
    fontWeight: '900',
    color: '#2a5e7e',
    left: 0,
    top: 0,
  },
  rankingGradient: {
    width: 180,
    height: 180,
  }
});

export default React.memo(TrendingCard);