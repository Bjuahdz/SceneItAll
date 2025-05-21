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
const LOGO_TOP_OFFSET = -70;
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

// Performance optimized movie logo component
const MovieLogo = React.memo(({ 
  logoPath,
  logoOpacity,
  logoTransform
}: { 
  logoPath: string | null | undefined,
  logoOpacity: Animated.AnimatedInterpolation<number>,
  logoTransform: {
    translateY: Animated.AnimatedInterpolation<number>,
    translateX: Animated.AnimatedInterpolation<number>,
    rotate: Animated.AnimatedInterpolation<string>,
    scale: Animated.AnimatedInterpolation<number>
  }
}) => {
  const [logoSize, setLogoSize] = useState({ width: LOGO_MAX_WIDTH, height: LOGO_HEIGHT * 0.5 });
  
  // Memoize the transform style to prevent unnecessary recalculations
  const transformStyle = useMemo(() => [
    { perspective: 1000 },
    { translateY: logoTransform.translateY },
    { translateX: logoTransform.translateX },
    { rotate: logoTransform.rotate },
    { scale: logoTransform.scale }
  ], [logoTransform]);

  // Memoize the image style to prevent unnecessary recalculations
  const imageStyle = useMemo(() => [
    styles.logoImage,
    { 
      width: logoSize.width, 
      height: logoSize.height,
      transform: [{ perspective: 1000 }]
    }
  ], [logoSize]);

  // Early return after hooks are defined
  if (!logoPath) return null;
  
  return (
    <Animated.View 
      style={[
        styles.logoOuterContainer,
        {
          opacity: logoOpacity,
          transform: transformStyle
        }
      ]}
    >
      <View style={[styles.logoWrapper, { transform: [{ perspective: 1000 }] }]}>
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w1280${logoPath}` }}
          style={imageStyle}
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
                newHeight = LOGO_HEIGHT * 0.4; 
                newWidth = newHeight * aspectRatio;
                
                if (newWidth < LOGO_MAX_WIDTH * 0.4) {
                  newWidth = LOGO_MAX_WIDTH * 0.8;
                  newHeight = newWidth / aspectRatio;
                }
              } else if (aspectRatio <= 2) {
                // For medium width logos (like Disney, Pixar)
                newWidth = LOGO_MAX_WIDTH * 0.7;
                newHeight = newWidth / aspectRatio;
              } else {
                // For very wide logos (like Star Wars, Top Gun)
                newWidth = LOGO_MAX_WIDTH * 1.0;
                newHeight = newWidth / aspectRatio;
                
                if (newHeight < LOGO_HEIGHT * 0.2) {
                  newHeight = LOGO_HEIGHT * 0.9;
                  newWidth = newHeight * aspectRatio;
                }
              }
              
              newWidth = Math.min(newWidth, LOGO_MAX_WIDTH);
              newHeight = Math.min(newHeight, LOGO_HEIGHT * 0.9);
              
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

const TrendingCard = React.memo(({
  movie,
  index,
  scrollX,
  itemIndex,
  itemWidth
}: ParallaxTrendingCardProps) => {
  const { movie_id, poster_url } = movie;
  const extendedMovie = movie as ExtendedTrendingMovie;
  
  // Memoize input ranges to prevent recalculation
  const extendedInputRange = useMemo(() => [
    (itemIndex - 2) * itemWidth,
    (itemIndex - 1) * itemWidth,
    itemIndex * itemWidth,
    (itemIndex + 1) * itemWidth,
    (itemIndex + 2) * itemWidth
  ], [itemIndex, itemWidth]);

  const activeInputRange = useMemo(() => [
    itemIndex * itemWidth - (itemWidth * 0.3),
    itemIndex * itemWidth,
    itemIndex * itemWidth + (itemWidth * 0.3)
  ], [itemIndex, itemWidth]);

  // Calculate the scale factor for the poster to make it larger than the card
  const POSTER_SCALE = 1.2;

  // Memoize all animations to prevent recalculation
  const animations = useMemo(() => ({
    scale: scrollX.interpolate({
      inputRange: extendedInputRange,
      outputRange: [0.6, 0.8, 1.0, 0.8, 0.6],
      extrapolate: 'clamp'
    }),
    rotateY: scrollX.interpolate({
      inputRange: extendedInputRange,
      outputRange: ['-60deg', '-30deg', '0deg', '30deg', '60deg'],
      extrapolate: 'clamp'
    }),
    translateX: scrollX.interpolate({
      inputRange: extendedInputRange,
      outputRange: [-100, -50, 0, 50, 100],
      extrapolate: 'clamp'
    }),
    posterTranslateX: scrollX.interpolate({
      inputRange: extendedInputRange,
      outputRange: [-200, -80, 0, 80, 200],
      extrapolate: 'clamp'
    }),
    posterTranslateY: scrollX.interpolate({
      inputRange: extendedInputRange,
      outputRange: [-50, -30, 0, 30, 50],
      extrapolate: 'clamp'
    }),
    opacity: scrollX.interpolate({
      inputRange: extendedInputRange,
      outputRange: [0.3, 0.6, 1, 0.6, 0.3],
      extrapolate: 'clamp'
    }),
    logoOpacity: scrollX.interpolate({
      inputRange: activeInputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp'
    }),
    logoTransform: {
      translateY: scrollX.interpolate({
        inputRange: activeInputRange,
        outputRange: [100, -40, 100],
        extrapolate: 'clamp'
      }),
      translateX: scrollX.interpolate({
        inputRange: activeInputRange,
        outputRange: [-200, 0, 200],
        extrapolate: 'clamp'
      }),
      rotate: scrollX.interpolate({
        inputRange: activeInputRange,
        outputRange: ['-45deg', '0deg', '45deg'],
        extrapolate: 'clamp'
      }),
      scale: scrollX.interpolate({
        inputRange: activeInputRange,
        outputRange: [0.3, 1.2, 0.3],
        extrapolate: 'clamp'
      })
    },
    numberOpacity: scrollX.interpolate({
      inputRange: activeInputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp'
    })
  }), [scrollX, extendedInputRange, activeInputRange]);

  // Memoize transform style
  const transformStyle = useMemo(() => [
    { perspective: 1000 },
    { translateX: animations.translateX },
    { scale: animations.scale },
    { rotateY: animations.rotateY }
  ], [animations]);

  // Memoize poster transform style
  const posterTransformStyle = useMemo(() => [
    { scale: POSTER_SCALE },
    { translateX: animations.posterTranslateX },
    { translateY: animations.posterTranslateY }
  ], [animations]);

  return (
    <Link href={`/movie/${movie_id}`} asChild>
      <TouchableOpacity>
        <Animated.View 
          style={[
            styles.container,
            {
              transform: transformStyle,
              opacity: animations.opacity
            }
          ]}
        >
          <MovieLogo 
            logoPath={extendedMovie.logo_path}
            logoOpacity={animations.logoOpacity}
            logoTransform={animations.logoTransform}
          />
          
          <Animated.View style={[styles.rankingContainer, { opacity: animations.numberOpacity }]}>
            <TrendingNumber number={index + 1} />
          </Animated.View>
          
          <View style={styles.card}>
            <Animated.Image
              source={{ 
                uri: (extendedMovie.clean_poster_url || poster_url).replace('/w500', '/w1280'),
                cache: 'force-cache'
              }}
              style={[
                styles.posterImage,
                { transform: posterTransformStyle }
              ]}
              resizeMode="cover"
              fadeDuration={0}
            />
            
            <LinearGradient
              colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.4)', 'transparent']}
              locations={[0, 0.3, 0.6]}
              style={styles.topGradient}
            />
            
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.99)']}
              locations={[0.4, 0.5, 0.9]}
              style={styles.bottomGradient}
            />
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Link>
  );
});

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginLeft: 20,
    marginBottom: 10,
    marginTop: 10,
    transformOrigin: 'center center',
    backfaceVisibility: 'hidden',
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
    transformOrigin: 'center bottom',
  },
  logoWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: LOGO_MAX_WIDTH,
    height: LOGO_HEIGHT * 0.6,
    transform: [{ perspective: 1000 }],
  },
  logoImage: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, 
    shadowRadius: 6,
    transform: [{ perspective: 1000 }],
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 30,
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
    position: 'absolute',
    top: 0,
    left: 0,
  },
  topGradient: {
    position: 'absolute',
    left: -20, // Extend beyond left edge
    right: -20, // Extend beyond right edge
    top: -20, // Extend beyond top edge
    height: '50%', // Increased height
    zIndex: 1,
  },
  bottomGradient: {
    position: 'absolute',
    left: -20, // Extend beyond left edge
    right: -20, // Extend beyond right edge
    bottom: -20, // Extend beyond bottom edge
    height: '50%', // Increased height
    zIndex: 1,
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

export default TrendingCard;