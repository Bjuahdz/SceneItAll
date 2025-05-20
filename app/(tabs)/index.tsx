import {
  View,
  Text,
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  Dimensions,
  StyleSheet,
} from "react-native";

import { useRouter } from "expo-router";
import useFetch from "@/services/useFetch";
import { 
  fetchMovies, 
  fetchNowPlayingMovies, 
  fetchMoviesByGenre,
  fetchUpcomingMovies,
  fetchCashCowMovies,
  fetchMoneyPitMovies 
} from "@/services/api";
import { getTrendingMovies } from "@/services/appwrite";
import { images } from "@/constants/images";
import React from "react";
import HeroPoster from "@/components/homepage/HeroPoster";
import TrendingSection from "@/components/homepage/TrendingSection";
import UpcomingMoviesSection from "@/components/homepage/UpcomingMoviesSection";
import BoxOfficeHeroSection from '@/components/homepage/BoxOfficeHeroSection';
import MinimalMovieSection from '@/components/homepage/MinimalMovieSection';

// Add memoized components
const MemoizedHeroPoster = React.memo(HeroPoster);
const MemoizedTrendingSection = React.memo(TrendingSection);
const MemoizedUpcomingMoviesSection = React.memo(UpcomingMoviesSection);
const MemoizedBoxOfficeHeroSection = React.memo(BoxOfficeHeroSection);
const MemoizedMinimalMovieSection = React.memo(MinimalMovieSection);

// Genre IDs from TMDB
const DRAMA_GENRE_ID = 18;
const ACTION_GENRE_ID = 28;
const THRILLER_GENRE_ID = 53;
const SCIFI_GENRE_ID = 878;
const COMEDY_GENRE_ID = 35;
const HORROR_GENRE_ID = 27;
const ROMANCE_GENRE_ID = 10749;
const ADVENTURE_GENRE_ID = 12;
const FAMILY_GENRE_ID = 10751;

const Index = () => {
  const router = useRouter();

  // Hero sections data
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
    data: upcomingMovies,
    loading: upcomingLoading,
    error: upcomingError,
  } = useFetch(() => fetchUpcomingMovies(10));

  const {
    data: cashCowMovies,
    loading: cashCowLoading,
    error: cashCowError,
  } = useFetch(() => fetchCashCowMovies(8));

  const {
    data: moneyPitMovies,
    loading: moneyPitLoading,
    error: moneyPitError,
  } = useFetch(() => fetchMoneyPitMovies(20));

  // Minimal sections data 
  const {
    data: justAddedMovies,
    loading: justAddedLoading,
    error: justAddedError,
  } = useFetch(() => fetchMovies({ query: '' }));
  
  // Genre-specific minimal sections
  const {
    data: dramaMovies,
    loading: dramaLoading,
    error: dramaError,
  } = useFetch(() => fetchMoviesByGenre(DRAMA_GENRE_ID));
  
  const {
    data: actionMovies,
    loading: actionLoading,
    error: actionError,
  } = useFetch(() => fetchMoviesByGenre(ACTION_GENRE_ID));
  
  const {
    data: thrillerMovies,
    loading: thrillerLoading,
    error: thrillerError,
  } = useFetch(() => fetchMoviesByGenre(THRILLER_GENRE_ID));
  
  const {
    data: scifiMovies,
    loading: scifiLoading,
    error: scifiError,
  } = useFetch(() => fetchMoviesByGenre(SCIFI_GENRE_ID));
  
  const {
    data: comedyMovies,
    loading: comedyLoading,
    error: comedyError,
  } = useFetch(() => fetchMoviesByGenre(COMEDY_GENRE_ID));
  
  const {
    data: horrorMovies,
    loading: horrorLoading,
    error: horrorError,
  } = useFetch(() => fetchMoviesByGenre(HORROR_GENRE_ID));
  
  const {
    data: romanceMovies,
    loading: romanceLoading,
    error: romanceError,
  } = useFetch(() => fetchMoviesByGenre(ROMANCE_GENRE_ID));
  
  const {
    data: adventureMovies,
    loading: adventureLoading,
    error: adventureError,
  } = useFetch(() => fetchMoviesByGenre(ADVENTURE_GENRE_ID));
  
  const {
    data: familyMovies,
    loading: familyLoading,
    error: familyError,
  } = useFetch(() => fetchMoviesByGenre(FAMILY_GENRE_ID));

  // Check for loading/error states
  const boxOfficeLoading = cashCowLoading || moneyPitLoading;
  const boxOfficeError = cashCowError || moneyPitError;
  
  const minimalSectionsLoading = justAddedLoading || dramaLoading || actionLoading || 
    thrillerLoading || scifiLoading || comedyLoading || horrorLoading || 
    romanceLoading || adventureLoading || familyLoading;
    
  const minimalSectionsError = justAddedError || dramaError || actionError || 
    thrillerError || scifiError || comedyError || horrorError || 
    romanceError || adventureError || familyError;

  // Main content component
  const MainContent = React.useCallback(() => (
    <ScrollView
      className="px-5"
      bounces={false}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      {/* Hero Poster Section */}
      <View 
        className="-mx-5" 
        style={{
          marginTop: -20,
        }}
      >
        {nowPlayingMovies && (
          <MemoizedHeroPoster movies={nowPlayingMovies} />
        )}
      </View>

      {/* Drama Movies */}
      {dramaMovies && (
        <View style={{ marginTop: 15 }}>
          <MemoizedMinimalMovieSection 
            title="Emotional Powerhouses" 
            movies={dramaMovies} 
            icon="heartbeat"
            accent="#e57373"
          />
        </View>
      )}
      
      {/* Comedy Movies */}
      {comedyMovies && (
        <View style={{ marginTop: 10 }}>
          <MemoizedMinimalMovieSection 
            title="Laugh-Out-Loud Gems" 
            movies={comedyMovies} 
            icon="smile-o"
            accent="#4fc3f7"
          />
        </View>
      )}
      
      {/* Horror Movies */}
      {horrorMovies && (
        <View style={{ marginTop: 10 }}>
          <MemoizedMinimalMovieSection 
            title="Spine-Chilling Nightmares" 
            movies={horrorMovies} 
            icon="warning"
            accent="#ff5252"
          />
        </View>
      )}

      {/* Box Office Section - Hero */}
      {cashCowMovies && moneyPitMovies && (cashCowMovies.length > 0 || moneyPitMovies.length > 0) && (
        <View style={{ marginLeft: -20, marginTop: 10 }}>
          <MemoizedBoxOfficeHeroSection 
            cashCowMovies={cashCowMovies}
            moneyPitMovies={moneyPitMovies}
            title="Box Office"
          />
        </View>
      )}
      
      {/* Just Added Movies */}
      {justAddedMovies && (
        <View style={{ marginTop: 15 }}>
          <MemoizedMinimalMovieSection 
            title="Fresh Off The Reel" 
            movies={justAddedMovies} 
            icon="plus-circle"
          />
        </View>
      )}
      
      {/* Family Movies */}
      {familyMovies && (
        <View style={{ marginTop: 10 }}>
          <MemoizedMinimalMovieSection 
            title="Fun For Everyone" 
            movies={familyMovies} 
            icon="users"
            accent="#ba68c8"
          />
        </View>
      )}
      
      {/* Romance Movies */}
      {romanceMovies && (
        <View style={{ marginTop: 10 }}>
          <MemoizedMinimalMovieSection 
            title="Heart-Stirring Tales" 
            movies={romanceMovies} 
            icon="heart"
            accent="#f48fb1"
          />
        </View>
      )}
      
      {/* Trending Section - Hero */}
      {trendingMovies && (
        <View style={{ marginLeft: -20, marginRight: -20, marginTop: 10 }}>
          <MemoizedTrendingSection 
            movies={trendingMovies}
            title="Trending Movies"
          />
        </View>
      )}
      
      {/* Sci-Fi Movies */}
      {scifiMovies && (
        <View style={{ marginTop: 15 }}>
          <MemoizedMinimalMovieSection 
            title="Mind-Bending Futures" 
            movies={scifiMovies} 
            icon="space-shuttle"
            accent="#64b5f6"
          />
        </View>
      )}
      
      {/* Action Movies */}
      {actionMovies && (
        <View style={{ marginTop: 10 }}>
          <MemoizedMinimalMovieSection 
            title="Adrenaline Rushes" 
            movies={actionMovies} 
            icon="rocket"
            accent="#81c784"
          />
        </View>
      )}
      
      {/* Upcoming Movies Section - Hero */}
      {upcomingMovies && upcomingMovies.length > 0 && (
        <View style={{ marginLeft: -20, marginRight: -20, marginTop: 10 }}>
          <MemoizedUpcomingMoviesSection 
            movies={upcomingMovies}
            title="Coming Soon"
          />
        </View>
      )}
      
      {/* Adventure Movies */}
      {adventureMovies && (
        <View style={{ marginTop: 15 }}>
          <MemoizedMinimalMovieSection 
            title="Globe-Trotting Quests" 
            movies={adventureMovies} 
            icon="compass"
            accent="#ffb74d"
          />
        </View>
      )}
      
      {/* Thriller Movies */}
      {thrillerMovies && (
        <View style={{ marginTop: 10 }}>
          <MemoizedMinimalMovieSection 
            title="White-Knuckle Suspense" 
            movies={thrillerMovies} 
            icon="bolt"
            accent="#ffd54f"
          />
        </View>
      )}
      
      <View style={{ marginBottom: 20 }} />
    </ScrollView>
  ), [
    nowPlayingMovies, 
    trendingMovies,
    upcomingMovies,
    cashCowMovies,
    moneyPitMovies,
    justAddedMovies,
    dramaMovies,
    actionMovies,
    thrillerMovies,
    scifiMovies,
    comedyMovies,
    horrorMovies,
    romanceMovies,
    adventureMovies,
    familyMovies
  ]);

  return (
    <View className="flex-1 bg-primary">
      <Image
        source={images.bg1}
        className="absolute w-full z-0"
        resizeMode="cover"
      />

      {nowPlayingLoading || trendingLoading || upcomingLoading || boxOfficeLoading || minimalSectionsLoading ? (
        <View className="flex-1 bg-primary justify-center items-center">
          <ActivityIndicator size="large" color="#9486ab" className="mt-10" />
        </View>
      ) : nowPlayingError || trendingError || upcomingError || boxOfficeError || minimalSectionsError ? (
        <Text>Error: An error occurred while loading content</Text>
      ) : (
        <MainContent />
      )}
    </View>
  );
};

export default React.memo(Index);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // other styles
  },
  // other style definitions
});