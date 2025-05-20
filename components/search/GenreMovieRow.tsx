import React, { memo } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity } from 'react-native';
import { Link } from 'expo-router';
import { icons } from '@/constants/icons';
import { Movie } from '@/interfaces/interfaces';

type GenreMovieRowProps = {
  title: string;
  movies: Movie[];
};

const GenreMovieRow = ({ title, movies }: GenreMovieRowProps) => {
  const renderMovieItem = ({ item }: { item: Movie }) => (
    <Link href={`/movie/${item.id}`} asChild>
      <TouchableOpacity className="mr-6">
        <Image
          source={{
            uri: item.poster_path
              ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
              : "https://placehold.co/600x400/1a1a1a/FFFFFF.png",
          }}
          className="w-28 h-40 rounded-lg"
          resizeMode="cover"
        />
        
        <Text className="text-sm font-bold text-white mt-2 w-28" numberOfLines={1}>
          {item.title}
        </Text>
        
        <View className="flex-row items-center justify-start gap-x-1">
          <Image source={icons.star} className="size-4" />
          <Text className="text-xs text-white font-bold uppercase">
            {Math.round(item.vote_average / 2)}
          </Text>
        </View>
        
        <Text className="text-xs text-light-300 font-medium mt-1">
          {item.release_date?.split("-")[0]}
        </Text>
      </TouchableOpacity>
    </Link>
  );

  return (
    <View className="mt-6">
      <Text className="text-lg text-white font-bold mb-3">
        {title}
      </Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={movies}
        renderItem={renderMovieItem}
        keyExtractor={(item) => `genre-movie-${item.id}`}
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        windowSize={5}
      />
    </View>
  );
};

export default memo(GenreMovieRow); 