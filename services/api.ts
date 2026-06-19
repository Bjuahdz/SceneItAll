import type { MovieDetails, MovieVideo } from '@/interfaces/interfaces';

export const TMDB_CONFIG={
    BASE_URL:'https://api.themoviedb.org/3', 
    API_KEY: process.env.EXPO_PUBLIC_MOVIE_API_KEY,
    headers:{
        accept:'application/json',
        Authorization:`Bearer ${process.env.EXPO_PUBLIC_MOVIE_API_KEY}`
    }
}

const uniqueByMovieId = <T extends { id: number }>(movies: T[]): T[] => (
  Array.from(new Map(movies.map(movie => [movie.id, movie])).values())
);

//Fetches movies for the movie card section and the search page
export const fetchMovies = async ({ query }: { query: string }) => {
  try {
    
    const endpoint = query
    ? `${TMDB_CONFIG.BASE_URL}/search/movie?query=${encodeURIComponent(query)}`
    : `${TMDB_CONFIG.BASE_URL}/discover/movie?sort_by=popularity.desc`;
    const response = await fetch(endpoint,{
        method: 'GET',
        headers: TMDB_CONFIG.headers,
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.results;
  } catch (error) {
    console.error('Fetch error details:', error);
    throw error;
  }
};
// Fetches the most popular recent movies for the hero carousel. Only movies that have
// a TEXTLESS (no-language) poster are kept, so the hero never shows baked-in titles.
export const fetchNowPlayingMovies = async () => {
  try {
    // Get current date and date from 2 months ago
    const currentDate = new Date();
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(currentDate.getMonth() - 2);

    // Format dates to YYYY-MM-DD as required by TMDB API
    const maxDate = currentDate.toISOString().split('T')[0];
    const minDate = twoMonthsAgo.toISOString().split('T')[0];
    
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/discover/movie?` +
      `sort_by=popularity.desc&` +
      `primary_release_date.gte=${minDate}&` +
      `primary_release_date.lte=${maxDate}`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    const filteredMovies = data.results
      .filter((movie: any) => 
        movie.poster_path && // Has a poster
        movie.vote_count > 100 && // Has significant votes
        new Date(movie.release_date) >= twoMonthsAgo && // Double check date range
        new Date(movie.release_date) <= currentDate
      )
      .slice(0, 7);

    // Attach clean artwork and keep ONLY movies that have a textless poster — no
    // fallback to the default `poster_path` (it usually has the title baked in, which
    // is exactly what we don't want in the hero).
    const moviesWithImages = await Promise.all(
      filteredMovies.map(async (movie: any) => {
        const { poster, logo } = await fetchMovieImages(movie.id.toString());
        if (!poster) return null;
        return { ...movie, poster_path: poster, logo_path: logo };
      })
    );

    return moviesWithImages.filter((movie: any) => movie !== null);
  } catch (error) {
    console.error('Error fetching popular movies:', error);
    throw error;
  }
};

//Fetches movie details for any movie
export const fetchMovieDetails = async (movieId: string): Promise<MovieDetails> => {
  try {
    // Fetch movie details, release dates, and credits in parallel
    const [movieResponse, releaseDatesResponse, creditsResponse] = await Promise.all([
      fetch(`${TMDB_CONFIG.BASE_URL}/movie/${movieId}`, {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }),
      fetch(`${TMDB_CONFIG.BASE_URL}/movie/${movieId}/release_dates`, {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }),
      fetch(`${TMDB_CONFIG.BASE_URL}/movie/${movieId}/credits`, {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      })
    ]);

    if (!movieResponse.ok || !releaseDatesResponse.ok || !creditsResponse.ok) {
      throw new Error(`HTTP error! status: ${movieResponse.status}`);
    }

    const [movieData, releaseDatesData, creditsData] = await Promise.all([
      movieResponse.json(),
      releaseDatesResponse.json(),
      creditsResponse.json()
    ]);

    // Get US certification
    const usRelease = releaseDatesData.results?.find(
      (r: any) => r.iso_3166_1 === 'US'
    );
    const certification = usRelease?.release_dates?.[0]?.certification || 'NR';

    // Format runtime
    const hours = Math.floor(movieData.runtime / 60);
    const minutes = movieData.runtime % 60;
    const formattedRuntime = `${hours}h ${minutes}m`;

    // Calculate profit
    const profit = movieData.revenue - movieData.budget;

    // Format currency
    const formatCurrency = (amount: number) => {
      if (amount === 0) return 'N/A';
      
      // Handle negative numbers
      const isNegative = amount < 0;
      const absAmount = Math.abs(amount);
      
      let result;
      if (absAmount >= 1000000000) {
        result = `$${(absAmount / 1000000000).toFixed(1)}B`;
      } else if (absAmount >= 1000000) {
        result = `$${(absAmount / 1000000).toFixed(1)}M`;
      } else if (absAmount >= 1000) {
        result = `$${(absAmount / 1000).toFixed(1)}K`;
      } else {
        result = `$${absAmount}`;
      }
      
      return isNegative ? `-${result}` : result;
    };

    // Get directors and writers from credits
    const directors = creditsData.crew
      .filter((person: any) => person.job === 'Director')
      .map((director: any) => ({
        id: director.id,
        name: director.name
      }));

    const writers = creditsData.crew
      .filter((person: any) => ['Screenplay', 'Writer', 'Story'].includes(person.job))
      .map((writer: any) => ({
        id: writer.id,
        name: writer.name,
        job: writer.job
      }));

    // Get cast members
    const cast = creditsData.cast
      .map((actor: any) => ({
        id: actor.id,
        name: actor.name,
        character: actor.character,
        profile_path: actor.profile_path
      }));

    return {
      ...movieData,
      certification,
      formattedRuntime,
      formattedBudget: formatCurrency(movieData.budget),
      formattedRevenue: formatCurrency(movieData.revenue),
      formattedProfit: formatCurrency(profit),
      directors,
      writers,
      cast,
    };
  } catch (error) {
    console.error('Error fetching movie details:', error);
    throw error;
  }
};

// ── Movie images ────────────────────────────────────────────────────────────
// Single source of truth for a movie's artwork. The hero + cards must only ever
// show TEXTLESS (no-language) posters, with an English-or-textless title logo on
// top. Requesting `include_image_language=en,null` makes TMDB return just those
// variants instead of every localized poster — smaller, faster responses, and one
// shared cache for every screen that needs artwork.
export type MovieImages = {
  poster: string | null;    // primary textless poster — hero + cards (best-voted)
  altPoster: string | null; // a DIFFERENT textless poster for the detail view, so it
                            // doesn't just repeat the cover (falls back to `poster`)
  logo: string | null;      // english / no-language title logo file_path
};

export const fetchMovieImages = async (movieId: string): Promise<MovieImages> => {
  if (imageCache.has(movieId) && isCacheValid(movieId)) {
    return imageCache.get(movieId)!;
  }

  try {
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}/images?include_image_language=en,null`,
      { method: 'GET', headers: TMDB_CONFIG.headers }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // All textless posters, in TMDB's vote order (best first). This one request
    // already contains every no-language poster, so we can hand out a primary AND an
    // alternate with zero extra API calls. Language posters are ignored (baked-in text).
    const posters: string[] = (data.posters || [])
      .filter((p: any) => !p.iso_639_1)
      .map((p: any) => p.file_path);

    // Logo: prefer no-language, else an English one (still clean over the poster).
    const logo =
      (data.logos || []).find((l: any) => !l.iso_639_1 || l.iso_639_1 === 'en')
        ?.file_path ?? null;

    const result: MovieImages = {
      poster: posters[0] ?? null,
      // Second-best poster for variety on the detail page; if there's only one, reuse it.
      altPoster: posters[1] ?? posters[0] ?? null,
      logo,
    };
    setImageCache(movieId, result);
    return result;
  } catch (error) {
    console.error(`Error fetching images for movie ${movieId}:`, error);
    return { poster: null, altPoster: null, logo: null };
  }
};

interface MovieLanguage {
  iso_639_1: string;
  english_name: string;
  name: string;
  type: 'Original' | 'Spoken' | 'Dubbed' | 'Subtitled';
}

// Language name mapping for common languages
const languageNames: { [key: string]: { english: string, native: string } } = {
  en: { english: 'English', native: 'English' },
  es: { english: 'Spanish', native: 'Español' },
  fr: { english: 'French', native: 'Français' },
  de: { english: 'German', native: 'Deutsch' },
  it: { english: 'Italian', native: 'Italiano' },
  ja: { english: 'Japanese', native: '日本語' },
  ko: { english: 'Korean', native: '한국어' },
  zh: { english: 'Chinese', native: '中文' },
  hi: { english: 'Hindi', native: 'हिन्दी' },
  ru: { english: 'Russian', native: 'Русский' },
  pt: { english: 'Portuguese', native: 'Português' },
  //Add more languages as needed
};

export const fetchMovieLanguages = async (movieId: string): Promise<MovieLanguage[]> => {
  try {
    // Fetch movie details for original language
    const movieResponse = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!movieResponse.ok) {
      throw new Error(`HTTP error! status: ${movieResponse.status}`);
    }

    const movieData = await movieResponse.json();
    const languages: MovieLanguage[] = [];

    // Add original language
    const originalLang = movieData.original_language;
    languages.push({
      iso_639_1: originalLang,
      english_name: languageNames[originalLang]?.english || originalLang.toUpperCase(),
      name: languageNames[originalLang]?.native || originalLang.toUpperCase(),
      type: 'Original'
    });

    // Add available subtitles (using spoken_languages as this is more accurate)
    movieData.spoken_languages.forEach((lang: any) => {
      if (lang.iso_639_1 !== movieData.original_language) {
        languages.push({
          iso_639_1: lang.iso_639_1,
          english_name: lang.english_name || languageNames[lang.iso_639_1]?.english || lang.iso_639_1.toUpperCase(),
          name: lang.name || languageNames[lang.iso_639_1]?.native || lang.iso_639_1.toUpperCase(),
          type: 'Subtitled'
        });
      }
    });

    return languages;
  } catch (error) {
    console.error('Error fetching movie languages:', error);
    return [];
  }
};


// Add this new function to fetch trailers
export const fetchMovieVideos = async (movieId: string): Promise<MovieVideo[]> => {
  try {
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}/videos`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Filter for official trailers only
    const videos = data.results
      .filter((video: MovieVideo) => 
        video.type === 'Trailer' && // Only trailers, no teasers
        video.site === 'YouTube' &&
        video.official // Only official trailers
      )
      .sort((a: MovieVideo, b: MovieVideo) => {
        // Sort by published date (oldest first)
        return new Date(a.published_at).getTime() - new Date(b.published_at).getTime();
      });

    return videos;
  } catch (error) {
    console.error('Error fetching movie videos:', error);
    return [];
  }
};

//  function to fetch movies by genre IDs
export const fetchMoviesByGenre = async (genreId: number | number[], limit: number = 10) => {
  try {
    // Handle both single genre ID and array of genre IDs
    const genreParam = Array.isArray(genreId) ? genreId.join(',') : genreId.toString();
    
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/discover/movie?` +
      `with_genres=${genreParam}&` +
      `sort_by=popularity.desc&` +
      `page=1&` +
      `vote_count.gte=100`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.results.slice(0, limit);
  } catch (error) {
    console.error('Error fetching movies by genre:', error);
    throw error;
  }
};

// Fetch upcoming movies that haven't been released yet
export const fetchUpcomingMovies = async (limit: number = 5) => {
  try {
    // Get current date and date 3 months in the future
    const currentDate = new Date();
    const threeMonthsLater = new Date();
    threeMonthsLater.setMonth(currentDate.getMonth() + 3);

    // Format dates to YYYY-MM-DD as required by TMDB API
    const today = currentDate.toISOString().split('T')[0];
    const maxDate = threeMonthsLater.toISOString().split('T')[0];
    
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/discover/movie?` +
      `sort_by=popularity.desc&` +
      `primary_release_date.gte=${today}&` + // From today
      `primary_release_date.lte=${maxDate}&` +
      `with_original_language=en`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Extra check to ensure movies haven't been released yet
    const todayTime = currentDate.getTime();
    
    const filteredMovies = data.results
      .filter((movie: any) => {
        // Basic requirement checks
        const hasRequiredFields = movie.poster_path && movie.backdrop_path && movie.overview;
        
        // Check release date is in the future
        const releaseDate = new Date(movie.release_date);
        const isUpcoming = releaseDate.getTime() > todayTime;
        
        return hasRequiredFields && isUpcoming;
      })
      .slice(0, limit);

    return filteredMovies;
  } catch (error) {
    console.error('Error fetching upcoming movies:', error);
    throw error;
  }
};

// ── Box office (Cash Cows / Money Pits) ──────────────────────────────────────
// Budget & revenue live ONLY on the /movie/{id} detail endpoint, so every candidate
// costs one detail call. To stay lean we (1) keep the candidate pool small, (2) fetch
// NO artwork — the Box Office chart needs only title / date / budget / revenue — and
// (3) cache the finished list so revisiting the tab doesn't re-scan.
const SECTION_CACHE_DURATION = 60 * 60 * 1000; // 60 minutes
const sectionCache = new Map<string, { data: any[]; expiry: number }>();

const getSection = (key: string): any[] | null => {
  const hit = sectionCache.get(key);
  return hit && Date.now() < hit.expiry ? hit.data : null;
};

const setSection = (key: string, data: any[]) => {
  sectionCache.set(key, { data, expiry: Date.now() + SECTION_CACHE_DURATION });
};

// (Box Office no longer fetches title logos — the chart needs no artwork. The shared
// fetchMovieImages cache still serves the hero, cards, and detail pages.)

// Cash Cows — biggest box-office winners (revenue well above budget).
export const fetchCashCowMovies = async (limit: number = 6) => {
  const cached = getSection(`cashCow:${limit}`);
  if (cached) return cached;

  try {
    // Look back 1 year — recent box office only.
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    // Format date to YYYY-MM-DD as required by TMDB API
    const minDate = oneYearAgo.toISOString().split('T')[0];
    
    // Fetch multiple pages to ensure we get enough candidates
    let allMovies: any[] = [];
    
    // Highest box-office earners first → almost all are profitable, so a small
    // candidate pool is enough to fill the section.
    const today = new Date().toISOString().split('T')[0];
    for (let page = 1; page <= 3 && allMovies.length < limit * 4; page++) {
      const response = await fetch(
        `${TMDB_CONFIG.BASE_URL}/discover/movie?` +
        `sort_by=revenue.desc&` + // Biggest box-office earners first
        `vote_count.gte=200&` + // Ensure sufficient votes
        `primary_release_date.gte=${minDate}&` +
        `primary_release_date.lte=${today}&` + // Skip unreleased (no revenue yet)
        `page=${page}`,
        {
          method: 'GET',
          headers: TMDB_CONFIG.headers,
        }
      );
      
      if (!response.ok) {
        break;
      }
      
      const data = await response.json();
      allMovies = [...allMovies, ...data.results];
      
      // Stop once we have a big enough candidate pool to fill the section.
      if (allMovies.length >= limit * 4) {
        break;
      }
    }
    
    const uniqueMovies = uniqueByMovieId(allMovies).slice(0, limit * 4);

    // Get detailed information to check budget and revenue
    const detailedMoviesPromises = uniqueMovies.map(async (movie: any) => {
      try {
        const detailsResponse = await fetch(
          `${TMDB_CONFIG.BASE_URL}/movie/${movie.id}`,
          {
            method: 'GET',
            headers: TMDB_CONFIG.headers,
          }
        );

        if (!detailsResponse.ok) {
          return null;
        }

        const details = await detailsResponse.json();

        // Cash cows = earned well over their budget. Artwork is added later for just
        // the few we display, so we don't fetch images for every candidate here.
        if (details.budget > 1000000 && details.revenue > 1000000) {
          if (details.revenue > details.budget * 1.3) { // At least 30% profit
            return {
              ...movie,
              budget: details.budget,
              revenue: details.revenue,
              backdrop_path: movie.backdrop_path || details.backdrop_path,
            };
          }
        }
        return null;
      } catch (error) {
        console.error(`Error fetching details for movie ${movie.id}:`, error);
        return null;
      }
    });
    
    const detailedMovies = await Promise.all(detailedMoviesPromises);

    // Rank purely by the size of the profit gap — the biggest cash cows of the past
    // year, regardless of exactly when in the year they released.
    const ranked = detailedMovies
      .filter((movie: any) => movie !== null)
      .sort((a: any, b: any) => (b.revenue - b.budget) - (a.revenue - a.budget))
      .slice(0, limit);

    // No artwork fetch — the chart needs only title / date / budget / revenue.
    setSection(`cashCow:${limit}`, ranked);
    return ranked;
    
  } catch (error) {
    console.error('Error fetching cash cow movies:', error);
    throw error;
  }
};

// Money Pits — biggest box-office flops (revenue well below budget).
export const fetchMoneyPitMovies = async (limit: number = 6) => {
  const cached = getSection(`moneyPit:${limit}`);
  if (cached) return cached;

  try {
    // Look back 1 year — recent box office only.
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    // Format date to YYYY-MM-DD as required by TMDB API
    const minDate = oneYearAgo.toISOString().split('T')[0];
    
    // Fetch multiple pages to ensure we get enough candidates
    let allResults: any[] = [];
    
    // No "biggest loss" sort exists, so scan recent, well-known theatrical releases
    // (enough votes to have reliable budget/revenue) and let the detail check below
    // surface the flops. Capped so we never fan out to hundreds of detail calls.
    const today = new Date().toISOString().split('T')[0];
    for (let page = 1; page <= 6 && allResults.length < limit * 12; page++) {
      const response = await fetch(
        `${TMDB_CONFIG.BASE_URL}/discover/movie?` +
        `sort_by=primary_release_date.desc&` + // Most recent first
        `vote_count.gte=100&` + // Well-known enough to have budget/revenue data
        `primary_release_date.gte=${minDate}&` +
        `primary_release_date.lte=${today}&` + // Skip unreleased (no revenue yet)
        `page=${page}`,
        {
          method: 'GET',
          headers: TMDB_CONFIG.headers,
        }
      );
      
      if (!response.ok) {
        break;
      }
      
      const data = await response.json();
      allResults = [...allResults, ...data.results];
      
      // Stop once the candidate pool is big enough to fill the section.
      if (allResults.length >= limit * 12) {
        break;
      }
    }
    
    const uniqueMovies = uniqueByMovieId(allResults).slice(0, limit * 12);

    // Process a larger set of movies to find enough that meet criteria
    const moviesWithDetails = await Promise.all(
      uniqueMovies.map(async (movie: any) => {
        try {
          const detailsResponse = await fetch(
            `${TMDB_CONFIG.BASE_URL}/movie/${movie.id}`,
            {
              method: 'GET',
              headers: TMDB_CONFIG.headers,
            }
          );

          if (!detailsResponse.ok) {
            return null;
          }

          const details = await detailsResponse.json();

          // Money pits = took in well under their budget. Artwork is added later for
          // just the few we display, so we don't fetch images for every candidate here.
          if (details.budget > 1000000 && details.revenue > 0) {
            if (details.revenue < details.budget * 0.85) { // At least 15% loss
              return {
                ...movie,
                budget: details.budget,
                revenue: details.revenue,
                backdrop_path: movie.backdrop_path || details.backdrop_path,
              };
            }
          }
          return null;
        } catch (error) {
          console.error(`Error fetching details for movie ${movie.id}:`, error);
          return null;
        }
      })
    );
    
    // Rank purely by the size of the loss gap — the biggest flops of the past year.
    const ranked = moviesWithDetails
      .filter((movie: any) => movie !== null)
      .sort((a: any, b: any) => (b.budget - b.revenue) - (a.budget - a.revenue))
      .slice(0, limit);

    // No artwork fetch — the chart needs only title / date / budget / revenue.
    setSection(`moneyPit:${limit}`, ranked);
    return ranked;
    
  } catch (error) {
    console.error('Error fetching money pit movies:', error);
    throw error;
  }
};

// Centralized image cache to prevent redundant API calls
const imageCache = new Map<string, MovieImages>();
const cacheExpiry = new Map<string, number>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Helper function to check if cache is valid
const isCacheValid = (movieId: string): boolean => {
  const expiry = cacheExpiry.get(movieId);
  return expiry ? Date.now() < expiry : false;
};

// Helper function to set cache
const setImageCache = (movieId: string, data: MovieImages) => {
  imageCache.set(movieId, data);
  cacheExpiry.set(movieId, Date.now() + CACHE_DURATION);
};

// Clean up expired cache entries
const cleanupExpiredCache = () => {
  const now = Date.now();
  for (const [movieId, expiry] of cacheExpiry.entries()) {
    if (now > expiry) {
      imageCache.delete(movieId);
      cacheExpiry.delete(movieId);
    }
  }
};

// Run cleanup every 5 minutes
setInterval(cleanupExpiredCache, 5 * 60 * 1000);

