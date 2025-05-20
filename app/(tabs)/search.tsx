import { useState, useEffect } from "react";
import { View, Text, ActivityIndicator, FlatList, Image, ScrollView } from "react-native";

import { images } from "@/constants/images";
import { icons } from "@/constants/icons";

import useFetch from "@/services/useFetch";
import { 
  fetchMovies, 
  fetchMoviesByGenre 
} from "@/services/api";
import { updateSearchCount } from "@/services/appwrite";

import SearchBar from "@/components/search/SearchBar";
import MovieDisplayCard from "@/components/MovieCard";
import GenreSection from "@/components/search/GenreSection";
import React from "react";

// Genre IDs from TMDB - copied from index.tsx
const ACTION_GENRE_ID = 28;
const ADVENTURE_GENRE_ID = 12;
const SCIFI_GENRE_ID = 878;
const COMEDY_GENRE_ID = 35;
const DRAMA_GENRE_ID = 18;
const THRILLER_GENRE_ID = 53;
const HORROR_GENRE_ID = 27;
const HISTORY_GENRE_ID = 36;
const FAMILY_GENRE_ID = 10751;

// Memoized component
const MemoizedGenreSection = React.memo(GenreSection);

const Search = () => {
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: movies = [],
    loading: searchLoading,
    error: searchError,
    refetch: loadMovies,
    reset,
  } = useFetch(() => fetchMovies({ query: searchQuery }), false);

  // Genre-specific movie fetches - moved from index.tsx
  const {
    data: actionAdventureMovies,
    loading: actionAdventureLoading,
    error: actionAdventureError,
  } = useFetch(() => fetchMoviesByGenre([ACTION_GENRE_ID, ADVENTURE_GENRE_ID]));

  const {
    data: scifiMovies,
    loading: scifiLoading,
    error: scifiError,
  } = useFetch(() => fetchMoviesByGenre([SCIFI_GENRE_ID]));

  const {
    data: comedyMovies,
    loading: comedyLoading,
    error: comedyError,
  } = useFetch(() => fetchMoviesByGenre([COMEDY_GENRE_ID]));

  const {
    data: dramaMovies,
    loading: dramaLoading,
    error: dramaError,
  } = useFetch(() => fetchMoviesByGenre([DRAMA_GENRE_ID]));

  const {
    data: thrillerMovies,
    loading: thrillerLoading,
    error: thrillerError,
  } = useFetch(() => fetchMoviesByGenre([THRILLER_GENRE_ID]));

  const {
    data: horrorMovies,
    loading: horrorLoading,
    error: horrorError,
  } = useFetch(() => fetchMoviesByGenre([HORROR_GENRE_ID]));

  const {
    data: historyMovies,
    loading: historyLoading,
    error: historyError,
  } = useFetch(() => fetchMoviesByGenre([HISTORY_GENRE_ID]));

  const {
    data: familyMovies,
    loading: familyLoading,
    error: familyError,
  } = useFetch(() => fetchMoviesByGenre([FAMILY_GENRE_ID]));

  // Check if any of the genre fetches are loading
  const isAnyGenreLoading = 
    actionAdventureLoading || scifiLoading || comedyLoading || 
    dramaLoading || thrillerLoading || horrorLoading || 
    historyLoading || familyLoading;

  // Check if any of the genre fetches have errors
  const anyGenreError = 
    actionAdventureError || scifiError || comedyError || 
    dramaError || thrillerError || horrorError || 
    historyError || familyError;

  const handleSearch = (text: string) => {
    setSearchQuery(text);
  };

  // Effect for search debouncing
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (searchQuery.trim()) {
        await loadMovies();
      } else {
        reset();
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Separate effect for updating search count
  useEffect(() => {
    if (movies?.length! > 0 && movies?.[0]) {
      updateSearchCount(searchQuery, movies[0]);
    }
  }, [movies]);

  // Determine which content to show
  const showSearchResults = searchQuery.trim().length > 0;

  return (
    <View className="flex-1 bg-primary">
      <Image
        source={images.bg}
        className="flex-1 absolute w-full z-0"
        resizeMode="cover"
      />

      {/* Header with Search Bar always visible */}
      <View className="w-full flex-row justify-center mt-20 items-center">
        <Image source={icons.logo} className="w-12 h-10" />
      </View>

      <View className="mx-5 my-5">
        <SearchBar
          placeholder="Search for a movie"
          value={searchQuery}
          onChangeText={handleSearch}
        />
      </View>

      {/* Loading indicator */}
      {(searchLoading || isAnyGenreLoading) && (
        <View className="bg-primary justify-center items-center py-3">
          <ActivityIndicator
            size="large"
            color="#9486ab"
            className="my-3"
          />
        </View>
      )}

      {/* Error display */}
      {(searchError || anyGenreError) && (
        <Text className="text-red-500 px-5 my-3">
          Error: An error occurred while loading content
        </Text>
      )}

      {/* Conditional rendering based on search state */}
      {showSearchResults ? (
        // Search Results
        <FlatList
          className="px-5"
          data={movies as Movie[]}
          keyExtractor={(item) => `search-${item.id}`}
          renderItem={({ item }) => <MovieDisplayCard {...item} />}
          numColumns={3}
          columnWrapperStyle={{
            justifyContent: "flex-start",
            gap: 16,
            marginVertical: 16,
          }}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListHeaderComponent={
            <Text className="text-xl text-white font-bold mb-3">
              Search Results for{" "}
              <Text className="text-accent">{searchQuery}</Text>
            </Text>
          }
          ListEmptyComponent={
            !searchLoading && !searchError ? (
              <View className="mt-10 px-5">
                <Text className="text-center text-gray-500">
                  No movies found for "{searchQuery}"
                </Text>
              </View>
            ) : null
          }
        />
      ) : (
        // Initial state with GenreSections
        <ScrollView
          bounces={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <Text className="text-xl text-white font-bold px-5 mb-3">
            Browse Movies by Genre
          </Text>
          
          {actionAdventureMovies && (
            <View style={{ marginHorizontal: 5 }}>
              <MemoizedGenreSection 
                title="Action & Adventure" 
                movies={actionAdventureMovies}
                genreId={ACTION_GENRE_ID} 
              />
            </View>
          )}
          
          {scifiMovies && (
            <View style={{ marginHorizontal: 5 }}>
              <MemoizedGenreSection 
                title="Sci-Fi" 
                movies={scifiMovies}
                genreId={SCIFI_GENRE_ID} 
              />
            </View>
          )}
          
          {comedyMovies && (
            <View style={{ marginHorizontal: 5 }}>
              <MemoizedGenreSection 
                title="Comedy" 
                movies={comedyMovies}
                genreId={COMEDY_GENRE_ID} 
              />
            </View>
          )}
          
          {dramaMovies && (
            <View style={{ marginHorizontal: 5 }}>
              <MemoizedGenreSection 
                title="Drama" 
                movies={dramaMovies}
                genreId={DRAMA_GENRE_ID} 
              />
            </View>
          )}
          
          {thrillerMovies && (
            <View style={{ marginHorizontal: 5 }}>
              <MemoizedGenreSection 
                title="Thriller" 
                movies={thrillerMovies}
                genreId={THRILLER_GENRE_ID} 
              />
            </View>
          )}
          
          {horrorMovies && (
            <View style={{ marginHorizontal: 5 }}>
              <MemoizedGenreSection 
                title="Horror" 
                movies={horrorMovies}
                genreId={HORROR_GENRE_ID} 
              />
            </View>
          )}
          
          {historyMovies && (
            <View style={{ marginHorizontal: 5 }}>
              <MemoizedGenreSection 
                title="Historical" 
                movies={historyMovies}
                genreId={HISTORY_GENRE_ID} 
              />
            </View>
          )}
          
          {familyMovies && (
            <View style={{ marginHorizontal: 5 }}>
              <MemoizedGenreSection 
                title="Family" 
                movies={familyMovies}
                genreId={FAMILY_GENRE_ID} 
              />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

export default Search;