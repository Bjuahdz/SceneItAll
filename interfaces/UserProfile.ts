export interface MovieQuote {
  id: string;
  quote: string;
  movieId: number;
  movieTitle: string;
  timestamp: Date;
}

export interface MovieRanking {
  movieId: number;
  movieTitle: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  posterPath: string;
}

export interface Friend {
  id: string;
  username: string;
  avatarUrl: string;
  favoriteGenres: string[];
  viewerType: string;
}

export interface ViewerType {
  type: string;
  description: string;
  icon: string;
  criteria: {
    genreThresholds: Record<string, number>;
    minimumWatched: number;
  };
}

export interface UserProfile {
  id: string;
  username: string;
  avatarUrl: string;
  backdropUrl: string;
  favoriteMovies: {
    movieId: number;
    title: string;
    posterPath: string;
  }[];
  movieRankings: MovieRanking[];
  pinnedQuotes: MovieQuote[];
  friends: Friend[];
  viewerTypes: string[];
  watchedGenres: Record<string, number>;
  totalMoviesWatched: number;
} 