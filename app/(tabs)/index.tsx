import {
  View,
  Text,
  ActivityIndicator,
  FlatList,
  Image,
} from "react-native";

import { useRouter } from "expo-router";
import useFetch from "@/services/useFetch";
import { fetchMovies, fetchNowPlayingMovies } from "@/services/api";
import { getTrendingMovies } from "@/services/appwrite";
import { images } from "@/constants/images";
import MovieCard from "@/components/MovieCard";
import TrendingCard from "@/components/TrendingCard";
import React from "react";
import HeroPoster from "@/components/HeroPoster";

// Add memoized components
const MemoizedMovieCard = React.memo(MovieCard);
const MemoizedTrendingCard = React.memo(TrendingCard);
const MemoizedHeroPoster = React.memo(HeroPoster);

const Index = () => {
  const router = useRouter();

  const {
    data: trendingMovies,
    loading: trendingLoading,
    error: trendingError,
  } = useFetch(getTrendingMovies);

  const {
    data: nowPlayingMovies,
    loading: nowPlayingLoading,
    error: nowPlayingError,
  } = useFetch(fetchNowPlayingMovies);

  const {
    data: movies,
    loading: moviesLoading,
    error: moviesError,
  } = useFetch(() => fetchMovies({ query: "" }));

  // Optimize list rendering
  const renderMovie = React.useCallback(({ item, index }) => (
    <MemoizedMovieCard {...item} key={`movie-${item.id}-${index}`} />
  ), []);

  const renderTrending = React.useCallback(({ item, index }) => (
    <MemoizedTrendingCard
      key={`trending-${item.movie_id}-${index}`}
      movie={item}
      index={index}
    />
  ), []);

  // Optimize list header
  const ListHeader = React.useCallback(() => (
    <>
      <View 
        className="-mx-5" 
        style={{
          marginTop: -50,
        }}
      >
        {nowPlayingMovies && (
          <MemoizedHeroPoster movies={nowPlayingMovies} />
        )}
      </View>

      {trendingMovies && (
        <View className="mt-10">
          <Text className="text-lg text-white font-bold mb-3">
            Trending Movies
          </Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-4 mt-3"
            data={trendingMovies}
            contentContainerStyle={{
              gap: 26,
            }}
            renderItem={renderTrending}
            keyExtractor={(item, index) => `trending-${item.movie_id}-${index}`}
            removeClippedSubviews={true}
            maxToRenderPerBatch={5}
            windowSize={5}
          />
        </View>
      )}

      <Text className="text-lg text-white font-bold mt-5 mb-3">
        Latest Releases
      </Text>
    </>
  ), [nowPlayingMovies, trendingMovies, renderTrending]);

  return (
    <View className="flex-1 bg-black">
      <Image
        source={images.bg1}
        className="absolute w-full z-0"
        resizeMode="cover"
      />

      {moviesLoading || trendingLoading || nowPlayingLoading ? (
        <View className="flex-1 bg-primary justify-center items-center">
          <ActivityIndicator size="large" color="#9486ab" className="mt-10" />
        </View>
      ) : moviesError || trendingError || nowPlayingError ? (
        <Text>Error: {moviesError?.message || trendingError?.message || nowPlayingError?.message}</Text>
      ) : (
        <FlatList
          className="px-5"
          data={movies}
          bounces={false}
          overScrollMode="always"
          removeClippedSubviews={true}
          maxToRenderPerBatch={6}
          windowSize={5}
          initialNumToRender={9}
          ListHeaderComponent={ListHeader}
          renderItem={renderMovie}
          keyExtractor={(item, index) => `movie-${item.id}-${index}`}
          numColumns={3}
          columnWrapperStyle={{
            justifyContent: "flex-start",
            gap: 20,
            paddingRight: 5,
            marginBottom: 10,
          }}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </View>
  );
};

export default React.memo(Index);