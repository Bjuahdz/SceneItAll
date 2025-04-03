interface Movie {
  id: number;
  title: string;
  adult: boolean;
  backdrop_path: string |null;
  genre_ids: number[];
  original_language: string;
  original_title: string;
  overview: string;
  popularity: number;
  poster_path: string;
  release_date: string;
  video: boolean;
  vote_average: number;
  vote_count: number;
  all_backdrops: string[];
}

interface TrendingMovie {
  searchTerm: string;
  movie_id: number;
  title: string;
  count: number;
  poster_url: string;
}

interface MovieDetails {
  adult: boolean;
  backdrop_path: string | null;
  belongs_to_collection: {
    id: number;
    name: string;
    poster_path: string;
    backdrop_path: string;
  } | null;
  budget: number;
  genres: {
    id: number;
    name: string;
  }[];
  homepage: string | null;
  id: number;
  imdb_id: string | null;
  original_language: string;
  original_title: string;
  overview: string | null;
  popularity: number;
  poster_path: string | null;
  production_companies: {
    id: number;
    logo_path: string | null;
    name: string;
    origin_country: string;
  }[];
  production_countries: {
    iso_3166_1: string;
    name: string;
  }[];
  release_date: string;
  revenue: number;
  runtime: number | null;
  spoken_languages: {
    english_name: string;
    iso_639_1: string;
    name: string;
  }[];
  status: string;
  tagline: string | null;
  title: string;
  video: boolean;
  vote_average: number;
  vote_count: number;
  certification: string;
  formattedRuntime: string;
  formattedBudget: string;
  formattedRevenue: string;
  formattedProfit: string;
  directors: {
    id: number;
    name: string;
  }[];
  writers: {
    id: number;
    name: string;
    job: string;
  }[];
  cast: {
    id: number;
    name: string;
    character: string;
    profile_path: string | null;
  }[];
}

interface MovieLanguage {
  iso_639_1: string;
  english_name: string;
  name: string;
  type: 'Original' | 'Subtitled';
}

interface TrendingCardProps {
  movie: TrendingMovie;
  index: number;
}

interface MovieActionButtonsProps {
  movieId: number;
  onLike?: () => void;
  onDislike?: () => void;
  onFavorite?: () => void;
  onWatch?: () => void;
  onTrailer?: () => void;
  isLiked?: boolean;
  isDisliked?: boolean;
  isFavorite?: boolean;
}


