import { View, TouchableOpacity, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons, MaterialCommunityIcons, AntDesign } from '@expo/vector-icons';
import React, { useState, useRef } from 'react';
import * as Haptics from 'expo-haptics';

const FavoriteButton = ({ onPress, isFavorite }) => {
  const [particles, setParticles] = useState([]);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const bounceAnim = useRef(new Animated.Value(1)).current;

  const createParticles = () => {
    const particleCount = 12;
    const newParticles = [...Array(particleCount)].map((_, index) => ({
      id: Date.now() + index,
      animation: new Animated.ValueXY({ x: 0, y: 0 }),
      opacity: new Animated.Value(1),
      scale: new Animated.Value(0),
    }));
    setParticles(newParticles);

    newParticles.forEach((particle, index) => {
      const angle = (index / particleCount) * Math.PI * 2;
      const radius = 50;
      
      Animated.parallel([
        Animated.sequence([
          Animated.delay(index * 20),
          Animated.spring(particle.animation, {
            toValue: {
              x: Math.cos(angle) * radius,
              y: Math.sin(angle) * radius,
            },
            speed: 20,
            bounciness: 8,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.spring(particle.scale, {
            toValue: 1,
            speed: 20,
            bounciness: 8,
            useNativeDriver: true,
          }),
          Animated.timing(particle.opacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        setParticles([]);
      });
    });
  };

  const handlePress = async () => {
    if (!isFavorite) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      
      Animated.sequence([
        Animated.spring(bounceAnim, {
          toValue: 1.3,
          speed: 20,
          bounciness: 15,
          useNativeDriver: true,
        }),
        Animated.spring(bounceAnim, {
          toValue: 1,
          speed: 50,
          bounciness: 25,
          useNativeDriver: true,
        }),
      ]).start();

      Animated.spring(rotateAnim, {
        toValue: 1,
        speed: 50,
        bounciness: 8,
        useNativeDriver: true,
      }).start();

      createParticles();
    } else {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      Animated.spring(rotateAnim, {
        toValue: 0,
        speed: 50,
        bounciness: 8,
        useNativeDriver: true,
      }).start();
    }
    onPress();
  };

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg']
  });

  return (
    <View style={styles.favoriteContainer}>
      {particles.map((particle) => (
        <Animated.View
          key={particle.id}
          style={[
            styles.particle,
            {
              transform: [
                { translateX: particle.animation.x },
                { translateY: particle.animation.y },
                { scale: particle.scale },
                { rotate: `${Math.random() * 360}deg` },
              ],
              opacity: particle.opacity,
            },
          ]}
        >
          <View style={[
            styles.particleHeart,
            { backgroundColor: Math.random() > 0.5 ? '#ef4444' : '#ff6b6b' }
          ]} />
        </Animated.View>
      ))}

      <Animated.View style={{
        transform: [
          { scale: bounceAnim },
        ]
      }}>
        <TouchableOpacity
          style={[
            styles.circleButton,
            isFavorite && styles.activeButton,
          ]}
          onPress={handlePress}
          activeOpacity={0.7}
        >
          {isFavorite ? (
            <Animated.View style={{ transform: [{ scale: bounceAnim }] }}>
              <Ionicons
                name="heart"
                size={22}
                color="#ef4444"
              />
            </Animated.View>
          ) : (
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <AntDesign
                name="plus"
                size={22}
                color="rgba(255,255,255,0.9)"
              />
            </Animated.View>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const MovieActionButtons = ({
  movieId,
  onLike,
  onDislike,
  onFavorite,
  onWatch,
  onTrailer,
  isLiked = false,
  isDisliked = false,
  isFavorite = false,
  hasTrailer = false,
  onStateChange,
}: MovieActionButtonsProps) => {

  const handleLike = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isLiked && isDisliked) {
      onStateChange?.({ isLiked: true, isDisliked: false, isFavorite });
    }
    onLike();
  };

  const handleDislike = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isDisliked && (isLiked || isFavorite)) {
      onStateChange?.({ isLiked: false, isDisliked: true, isFavorite: false });
    }
    onDislike();
  };

  const handleFavorite = () => {
    if (!isFavorite && isDisliked) {
      onStateChange?.({ isLiked, isDisliked: false, isFavorite: true });
    }
    onFavorite();
  };

  return (
    <View style={styles.container}>
      <View style={styles.actionGroup}>
        <TouchableOpacity 
          style={[styles.circleButton, isLiked && styles.activeButton]} 
          onPress={handleLike}
          activeOpacity={0.7}
        >
          <Ionicons 
            name={isLiked ? "thumbs-up" : "thumbs-up-outline"} 
            size={22} 
            color={isLiked ? "#9ccadf" : "rgba(255,255,255,0.9)"}
          />
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.circleButton, isDisliked && styles.activeButton]} 
          onPress={handleDislike}
          activeOpacity={0.7}
        >
          <Ionicons 
            name={isDisliked ? "thumbs-down" : "thumbs-down-outline"} 
            size={22} 
            color={isDisliked ? "#9ccadf" : "rgba(255,255,255,0.9)"}
          />
        </TouchableOpacity>

        <FavoriteButton
          onPress={handleFavorite}
          isFavorite={isFavorite}
        />

        <TouchableOpacity 
          style={[
            styles.circleButton,
            !hasTrailer && styles.noTrailerButton
          ]}
          onPress={hasTrailer ? onTrailer : undefined}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons 
            name="movie-open-play" 
            size={22} 
            color={hasTrailer ? "rgba(255,255,255,0.9)" : "#ef4444"}
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity 
        style={styles.watchButton}
        onPress={onWatch}
        activeOpacity={0.7}
      >
        <Ionicons name="play" size={20} color="#000000" />
        <Text style={styles.watchButtonText}>Watch Now</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    gap: 16,
  },
  actionGroup: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  activeButton: {
    backgroundColor: 'rgba(156, 202, 223, 0.15)',
    borderColor: '#9ccadf',
  },
  favoriteContainer: {
    position: 'relative',
    width: 44,
    height: 44,
  },
  particle: {
    position: 'absolute',
    width: 8,
    height: 8,
    left: '50%',
    top: '50%',
    marginLeft: -4,
    marginTop: -4,
    zIndex: 1,
  },
  particleHeart: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ef4444',
  },
  watchButton: {
    backgroundColor: '#9ccadf',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  watchButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  noTrailerButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#ef4444',
  },
});

export default MovieActionButtons; 