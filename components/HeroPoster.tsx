import { View, Text, Image, Dimensions, FlatList } from "react-native";
import { Link } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState, useRef } from "react";
import { Movie } from "@/interfaces/interfaces";
import { TouchableOpacity } from "react-native";
import GenreTag from './GenreTag';
import { Animated } from "react-native";

interface HeroPosterProps {
  movies: Movie[];
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = 580;
const MAX_BOUNCE_DISTANCE = 100;
const GRADIENT_OFFSET = -0.2;

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);

const HeroPoster = ({ movies }: HeroPosterProps) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);

  if (!movies?.length) return null;

  const topMovies = movies.slice(0, 7);
  if (!topMovies.length) return null;

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { 
      useNativeDriver: true,
      listener: (event: any) => {
        const offset = event.nativeEvent.contentOffset.x;
        const newIndex = Math.round(offset / SCREEN_WIDTH);
        if (newIndex !== activeIndex && newIndex >= 0 && newIndex < topMovies.length) {
          setActiveIndex(newIndex);
        }
      }
    }
  );

  const renderPaginationDots = () => (
    <View className="absolute bottom-5 z-10 flex-row justify-center w-full gap-1.5">
      {topMovies.map((_, index) => {
        const inputRange = [
          (index - 2) * SCREEN_WIDTH,
          (index - 1) * SCREEN_WIDTH,
          index * SCREEN_WIDTH,
          (index + 1) * SCREEN_WIDTH,
          (index + 2) * SCREEN_WIDTH
        ];

        const scale = scrollX.interpolate({
          inputRange: [
            (index - 1) * SCREEN_WIDTH,
            index * SCREEN_WIDTH,
            (index + 1) * SCREEN_WIDTH
          ],
          outputRange: [0.8, 1.2, 0.8],
          extrapolate: 'clamp',
        });

        const opacity = scrollX.interpolate({
          inputRange: [
            (index - 1) * SCREEN_WIDTH,
            index * SCREEN_WIDTH,
            (index + 1) * SCREEN_WIDTH
          ],
          outputRange: [0.4, 1, 0.4],
          extrapolate: 'clamp',
        });

        const backgroundColor = scrollX.interpolate({
          inputRange,
          outputRange: [
            '#9486ab',    // Original purple but full opacity
            '#9486ab',    // Original purple
            '#9ccadf',    // Blue for active
            '#9486ab',    // Original purple
            '#9486ab'     // Original purple but full opacity
          ],
          extrapolate: 'clamp',
        });

        return (
          <Animated.View
            key={`dot-${index}`}
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor,
              opacity,
              transform: [{ scale }]
            }}
          />
        );
      })}
    </View>
  );

  const renderHeroPoster = () => {
    const currentMovie = topMovies[activeIndex];
    const imageUrl = `https://image.tmdb.org/t/p/w1280${currentMovie.poster_path}`;
    
    return (
      <View style={{ 
        position: 'absolute', 
        width: '100%', 
        height: HERO_HEIGHT,
        overflow: 'hidden'
      }}>
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
        <LinearGradient
          colors={[
            "rgba(0,0,0,0.4)",
            "transparent",
            "transparent",
            "rgba(0,0,0,1.0)"
          ]}
          locations={[0, 0.3, 0.1, 0.9]}
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            transform: [{ translateX: GRADIENT_OFFSET }]
          }}
        />
      </View>
    );
  };

  const renderItem = ({ item: movie }: { item: Movie }) => (
    <View 
      style={{ 
        width: SCREEN_WIDTH,
        height: HERO_HEIGHT + MAX_BOUNCE_DISTANCE,
        justifyContent: 'flex-end',
        paddingBottom: 32,
      }}
    >
      <TouchableOpacity 
        activeOpacity={1} 
        style={{
          width: '100%',
          paddingHorizontal: 20,
          paddingVertical: 15,
          backgroundColor: 'transparent'
        }}
      >
        <View className="flex-row justify-between items-center">
          <Text className="text-white text-2xl font-bold flex-1" numberOfLines={2}>
            {movie.title}
          </Text>
          <View className="bg-accent/80 px-3 py-1 rounded-full ml-2">
            <Text className="text-white font-bold">
              {movie.vote_average.toFixed(1)}
            </Text>
          </View>
        </View>

        <Text className="text-gray-200 text-sm mt-2">
          Released: {new Date(movie.release_date).toLocaleDateString()}
        </Text>

        <View className="flex-row items-center mt-2 flex-wrap">
          {movie.genre_ids.slice(0, 3).map((genreId) => (
            <GenreTag key={genreId} genreId={genreId} />
          ))}
        </View>

        <View className="mt-3">
          <Text 
            className="text-gray-300 text-sm leading-5" 
            numberOfLines={3}
          >
            {movie.overview}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );

  return (
    <Link href={`/movie/${topMovies[activeIndex].id}`} asChild>
      <TouchableOpacity 
        activeOpacity={0.8}
        style={{ height: HERO_HEIGHT + MAX_BOUNCE_DISTANCE }}
      >
        <View style={{ height: '100%' }}>
          {renderHeroPoster()}
          <AnimatedFlatList
            ref={flatListRef}
            data={topMovies}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={true}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            renderItem={renderItem}
            keyExtractor={(item) => item.id.toString()}
            decelerationRate={0.85}
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              backgroundColor: 'transparent'
            }}
            pointerEvents="box-none"
            maxToRenderPerBatch={3}
            windowSize={3}
          />
          {renderPaginationDots()}
        </View>
      </TouchableOpacity>
    </Link>
  );
};

export default HeroPoster;

