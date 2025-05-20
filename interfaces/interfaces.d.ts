/**
 * Base Movie interface
 * Represents the basic movie data structure returned from TMDB API
 * Used in:
 * - components/MovieCard.tsx (for displaying movie cards in grids)
 * - components/HeroPoster.tsx (for hero section movie display)
 * - services/api.ts (as base for API responses)
 */
export interface Movie {
  id: number;                    // Unique identifier for the movie
  title: string;                 // Movie title
  adult: boolean;                // Whether the movie is adult content
  backdrop_path: string | null;  // Path to backdrop image
  genre_ids: number[];          // Array of genre IDs
  original_language: string;     // Original language code (e.g., 'en')
  original_title: string;        // Title in original language
  overview: string;              // Movie plot summary
  popularity: number;            // Popularity score
  poster_path: string;           // Path to poster image
  release_date: string;          // Release date (YYYY-MM-DD)
  video: boolean;                // Whether video content is available
  vote_average: number;          // Average rating
  vote_count: number;            // Number of votes
  all_backdrops: string[];      // Array of all backdrop image paths
  logo_path?: string | null;     // Path to the movie logo
}

/**
 * TrendingMovie interface
 * Represents a movie that is currently trending
 * Used in:
 * - components/TrendingCard.tsx (for trending movie display)
 * - app/(tabs)/index.tsx (in trending movies section)
 * - services/appwrite.ts (for trending data storage)
 */
export interface TrendingMovie {
  searchTerm: string;           // Search term associated with trending
  movie_id: number;             // Movie identifier
  title: string;                // Movie title
  count: number;                // Number of times searched/trending
  poster_url: string;           // URL to movie poster
}

/**
 * MovieDetails interface
 * Extended movie information including production details, cast, and formatted data
 * Used in:
 * - components/MovieTabBar.tsx (main movie details display)
 * - app/movie/[id].tsx (movie details page)
 * - services/api.ts (fetchMovieDetails response)
 */
export interface MovieDetails {
  adult: boolean;               // Adult content flag
  backdrop_path: string | null; // Backdrop image path
  belongs_to_collection: {      // Collection information if movie is part of a series
    id: number;
    name: string;
    poster_path: string;
    backdrop_path: string;
  } | null;
  budget: number;               // Movie budget in USD
  genres: {                     // Array of genre information
    id: number;
    name: string;
  }[];
  homepage: string | null;      // Official movie homepage URL
  id: number;                   // Unique movie ID
  imdb_id: string | null;       // IMDB identifier
  original_language: string;    // Original language code
  original_title: string;       // Original title
  overview: string | null;      // Plot summary
  popularity: number;           // Popularity score
  poster_path: string | null;   // Poster image path
  production_companies: {       // Companies involved in production
    id: number;
    logo_path: string | null;
    name: string;
    origin_country: string;
  }[];
  production_countries: {       // Countries where movie was produced
    iso_3166_1: string;
    name: string;
  }[];
  release_date: string;         // Release date
  revenue: number;              // Box office revenue in USD
  runtime: number | null;       // Movie duration in minutes
  spoken_languages: {           // Languages available in the movie
    english_name: string;
    iso_639_1: string;
    name: string;
  }[];
  status: string;               // Release status (e.g., "Released", "In Production")
  tagline: string | null;       // Movie tagline
  title: string;                // Movie title
  video: boolean;               // Video availability flag
  vote_average: number;         // Average rating
  vote_count: number;           // Number of votes
  certification: string;        // Movie rating certification (e.g., "PG-13")
  formattedRuntime: string;     // Formatted runtime string (e.g., "2h 15m")
  formattedBudget: string;      // Formatted budget string with currency
  formattedRevenue: string;     // Formatted revenue string with currency
  formattedProfit: string;      // Formatted profit/loss string with currency
  directors: {                  // Array of movie directors
    id: number;
    name: string;
  }[];
  writers: {                    // Array of movie writers with their roles
    id: number;
    name: string;
    job: string;
  }[];
  cast: {                       // Array of cast members
    id: number;
    name: string;
    character: string;
    profile_path: string | null;
  }[];
}

/**
 * MovieLanguage interface
 * Represents language information for a movie
 * Used in:
 * - services/api.ts (fetchMovieLanguages)
 * - components/MovieTabBar.tsx (language selection)
 */
export interface MovieLanguage {
  iso_639_1: string;           // ISO language code
  english_name: string;        // Language name in English
  name: string;               // Native language name
  type: 'Original' | 'Subtitled'; // Language type
}

/**
 * TrendingCardProps interface
 * Props for the TrendingCard component
 * Used in:
 * - components/TrendingCard.tsx
 * - app/(tabs)/index.tsx (trending section)
 */
export interface TrendingCardProps {
  movie: TrendingMovie;        // Trending movie data
  index: number;               // Position in trending list
}

/**
 * MovieActionButtonsProps interface
 * Props for the movie action buttons component
 * Used in:
 * - components/MovieActionButtons.tsx
 * - app/movie/[id].tsx (movie details page actions)
 */
export interface MovieActionButtonsProps {
  movieId: string;             // Movie identifier
  onLike: () => void;         // Like action handler
  onDislike: () => void;      // Dislike action handler
  onFavorite: () => void;     // Favorite action handler
  onWatch: () => void;        // Watch action handler
  onTrailer: () => void;      // Trailer view handler
  isLiked?: boolean;          // Current like state
  isDisliked?: boolean;       // Current dislike state
  isFavorite?: boolean;       // Current favorite state
  hasTrailer?: boolean;       // Whether trailer is available
  onStateChange?: (newState: { isLiked: boolean; isDisliked: boolean; isFavorite: boolean }) => void;
}

/**
 * MovieVideo interface
 * Represents video content associated with a movie
 * Used in:
 * - components/MovieTabBar.tsx (TrailersSection)
 * - app/movie/[id].tsx (video state management)
 * - services/api.ts (fetchMovieVideos)
 */
export interface MovieVideo {
  id: string;                 // Video identifier
  key: string;                // Video key (e.g., YouTube video ID)
  name: string;               // Video title
  site: string;               // Video platform (e.g., "YouTube")
  size: number;               // Video quality (e.g., 1080)
  type: string;               // Video type (e.g., "Trailer", "Teaser")
  official: boolean;          // Whether it's an official video
  published_at: string;       // Publication date
  videoUrl?: string;          // Optional full video URL
}

/**
 * TabType type
 * Defines available tabs in the movie details view
 * Used in:
 * - components/MovieTabBar.tsx (tab navigation)
 * - app/movie/[id].tsx (active tab state)
 */
export type TabType = 'details' | 'cast' | 'extras' | 'similar';

/**
 * MovieTabBarProps interface
 * Props for the MovieTabBar component
 * Used in:
 * - components/MovieTabBar.tsx
 * - app/movie/[id].tsx (tab bar implementation)
 */
export interface MovieTabBarProps {
  activeTab: TabType;         // Currently active tab
  setActiveTab: (tab: TabType) => void; // Tab change handler
  movie: MovieDetails;        // Movie details data
  onTrailerSelect: (videoKey: string) => void; // Trailer selection handler
  selectedVideo: string | null; // Currently selected video
  onCloseVideo: () => void;   // Video close handler
  scrollViewRef?: React.RefObject<ScrollView>; // Reference to scroll view
}

/**
 * Quality interface
 * Represents video quality options
 * Used in:
 * - components/MovieTabBar.tsx (video quality selection)
 * - components/TrailerPlayer.tsx (quality options)
 */
export interface Quality {
  label: string;              // Display label (e.g., "1080p")
  value: string;              // Quality value (e.g., "hd1080")
}

/**
 * CollapsibleSectionProps interface
 * Props for the CollapsibleSection component
 * Used in:
 * - components/MovieTabBar.tsx (collapsible sections)
 * - components/CollapsibleSection.tsx
 */
export interface CollapsibleSectionProps {
  title: string;              // Section title
  children: React.ReactNode;  // Full content when expanded
  previewContent: React.ReactNode; // Preview content when collapsed
  itemCount: number;          // Number of items in section
  hasContent: boolean;        // Whether section has content
}
