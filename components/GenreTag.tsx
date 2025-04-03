import React, { useRef, useEffect } from 'react';
import { Animated, Text } from 'react-native';

interface GenreTagProps {
  genreId: number;
}

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
  const scaleAnim = useRef(new Animated.Value(0)).current;
  
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 100,
      friction: 5,
      useNativeDriver: true,
    }).start();
  }, []);

  const genreName = genreMap[genreId];
  if (!genreName) return null;

  return (
    <Animated.View
      className="px-3 py-1.5 rounded-full mr-2 mb-2 bg-[#9486ab]/20 border border-[#9486ab]/30"
      style={{
        transform: [{ scale: scaleAnim }],
      }}
    >
      <Text className="text-[#9486ab] text-xs font-semibold">
        {genreName}
      </Text>
    </Animated.View>
  );
};

export default GenreTag;
