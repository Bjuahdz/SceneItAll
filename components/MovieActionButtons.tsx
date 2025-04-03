import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';

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
}: MovieActionButtonsProps) => {
  return (
    <View style={styles.container}>
      {/* Like/Dislike, Favorite, and Trailer Group */}
      <View style={styles.actionGroup}>
        <TouchableOpacity 
          style={[styles.circleButton, isLiked && styles.activeButton]} 
          onPress={onLike}
        >
          <Ionicons 
            name={isLiked ? "thumbs-up" : "thumbs-up-outline"} 
            size={22} 
            color={isLiked ? "#9ccadf" : "rgba(255,255,255,0.9)"}
          />
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.circleButton, isDisliked && styles.activeButton]} 
          onPress={onDislike}
        >
          <Ionicons 
            name={isDisliked ? "thumbs-down" : "thumbs-down-outline"} 
            size={22} 
            color={isDisliked ? "#9ccadf" : "rgba(255,255,255,0.9)"}
          />
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.circleButton, isFavorite && styles.activeButton]} 
          onPress={onFavorite}
        >
          <Ionicons 
            name={isFavorite ? "heart" : "heart-outline"} 
            size={22} 
            color={isFavorite ? "#ef4444" : "rgba(255,255,255,0.9)"}
          />
        </TouchableOpacity>

        {/* New Trailer Button */}
        <TouchableOpacity 
          style={styles.circleButton}
          onPress={onTrailer}
        >
          <MaterialCommunityIcons 
            name="movie-open-play" 
            size={22} 
            color="rgba(255,255,255,0.9)"
          />
        </TouchableOpacity>
      </View>

      {/* Watch Now Button */}
      <TouchableOpacity 
        style={styles.watchButton}
        onPress={onWatch}
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
});

export default MovieActionButtons; 