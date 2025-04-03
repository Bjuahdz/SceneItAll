export const TMDB_CONFIG={
    BASE_URL:'https://api.themoviedb.org/3', 
    API_KEY: process.env.EXPO_PUBLIC_MOVIE_API_KEY,
    headers:{
        accept:'application/json',
        Authorization:`Bearer ${process.env.EXPO_PUBLIC_MOVIE_API_KEY}`
    }
}


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
//Fetches the top 5 movies for the hero poster: based on popularity and release year
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

    const moviesWithCleanPosters = await Promise.all(
      filteredMovies.map(async (movie: any) => {
        try {
          const imagesResponse = await fetch(
            `${TMDB_CONFIG.BASE_URL}/movie/${movie.id}/images`,
            {
              method: 'GET',
              headers: TMDB_CONFIG.headers,
            }
          );

          if (!imagesResponse.ok) {
            return movie;
          }

          const imagesData = await imagesResponse.json();
          const cleanPosters = (imagesData.posters || [])
            .filter((poster: any) => !poster.iso_639_1);

          return {
            ...movie,
            poster_path: cleanPosters.length > 0 
              ? cleanPosters[0].file_path 
              : movie.poster_path
          };
        } catch (error) {
          console.error(`Error fetching posters for movie ${movie.id}:`, error);
          return movie;
        }
      })
    );

    return moviesWithCleanPosters;
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
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(amount);
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

// Combine backdrop and logo fetch into a single API call
export const fetchMovieImages = async (movieId: string) => {
  try {
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}/images`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const backdrops = data.backdrops || [];
    const logos = data.logos || [];
    
    // Process both backdrops and logos in one go
    const cleanBackdrops = backdrops.filter((backdrop: any) => !backdrop.iso_639_1);
    const cleanLogos = logos.filter((logo: any) => !logo.iso_639_1 || logo.iso_639_1 === 'en');
    
    return {
      backdrop: cleanBackdrops.length > 0 
        ? cleanBackdrops[cleanBackdrops.length > 7 ? 7 : cleanBackdrops.length - 1].file_path 
        : null,
      logo: cleanLogos.length > 0 ? cleanLogos[0].file_path : null
    };

  } catch (error) {
    console.error('Error fetching movie images:', error);
    return { backdrop: null, logo: null };
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

