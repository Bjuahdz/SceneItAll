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

    const moviesWithImages = await Promise.all(
      filteredMovies.map(async (movie: any) => {
        try {
          // Use the trending-specific function instead
          const imageData = await fetchTrendingMovieImages(movie.id.toString());
          
          return {
            ...movie,
            poster_path: imageData.poster_path || movie.poster_path,
            logo_path: imageData.logo_path
          };
        } catch (error) {
          console.error(`Error fetching images for movie ${movie.id}:`, error);
          return movie;
        }
      })
    );

    return moviesWithImages;
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

// Modified to fetch posters instead of backdrops for the hero section
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
    const posters = data.posters || [];
    const logos = data.logos || [];
    
    // Filter posters to ensure they have no language text
    const cleanPosters = posters.filter((poster: any) => !poster.iso_639_1);
    const cleanLogos = logos.filter((logo: any) => !logo.iso_639_1 || logo.iso_639_1 === 'en');
    
    // Select poster based on the rules:
    // - If more than 10 posters available, get the 5th one
    // - If even number of posters, get the last one
    // - If odd number, get the 3rd one (if available)
    let selectedPoster = null;
    
    if (cleanPosters.length > 0) {
      if (cleanPosters.length > 10) {
        // More than 10 posters available, get the 5th one
        selectedPoster = cleanPosters[4].file_path; // 0-based index, so 4 is the 5th poster
      } else if (cleanPosters.length % 2 === 0) {
        // Even number - get the last poster
        selectedPoster = cleanPosters[cleanPosters.length - 1].file_path;
      } else {
        // Odd number - get the 3rd poster if available, otherwise get the first
        selectedPoster = cleanPosters.length >= 3 
          ? cleanPosters[2].file_path 
          : cleanPosters[0].file_path;
      }
    }
    
    return {
      // Use poster for the hero section instead of backdrop
      backdrop: selectedPoster, 
      poster: cleanPosters.length > 0 ? cleanPosters[0].file_path : null,
      logo: cleanLogos.length > 0 ? cleanLogos[0].file_path : null
    };

  } catch (error) {
    console.error('Error fetching movie images:', error);
    return { backdrop: null, poster: null, logo: null };
  }
};

// Separate function for trending/hero section to use different images
export const fetchTrendingMovieImages = async (movieId: string) => {
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
    const posters = data.posters || [];
    const logos = data.logos || [];
    
    // Clean posters (no language)
    const cleanPosters = posters.filter((poster: any) => !poster.iso_639_1);
    
    // For trending, always use the first clean poster (different from detail page)
    const trendingPoster = cleanPosters.length > 0 ? cleanPosters[0].file_path : null;
    
    // Get movie logos (English or no language)
    const cleanLogos = logos.filter((logo: any) => !logo.iso_639_1 || logo.iso_639_1 === 'en');
    
    return {
      poster_path: trendingPoster,
      logo_path: cleanLogos.length > 0 ? cleanLogos[0].file_path : null
    };
  } catch (error) {
    console.error(`Error fetching images for movie ${movieId}:`, error);
    return { poster_path: null, logo_path: null };
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

// Updated function for Cash Cow movies - no fake data, prioritize by year and finances
export const fetchCashCowMovies = async (limit: number = 8) => {
  try {
    // Increase the time range to 2 years to find more candidates
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    
    // Get current year for sorting priority
    const currentYear = new Date().getFullYear();
    
    // Format date to YYYY-MM-DD as required by TMDB API
    const minDate = twoYearsAgo.toISOString().split('T')[0];
    
    // Fetch multiple pages to ensure we get enough candidates
    let allMovies: any[] = [];
    
    // Fetch up to 4 pages to get a larger candidate pool
    for (let page = 1; page <= 4; page++) {
      const response = await fetch(
        `${TMDB_CONFIG.BASE_URL}/discover/movie?` +
        `sort_by=primary_release_date.desc&` + // Sort by most recent first
        `vote_count.gte=180&` + // Ensure sufficient votes
        `primary_release_date.gte=${minDate}&` +
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
      
      // If we have enough results, stop fetching more pages
      if (allMovies.length >= 80) {
        break;
      }
    }
    
    // Get detailed information to check budget and revenue
    const detailedMoviesPromises = allMovies.map(async (movie: any) => {
      try {
        const [detailsResponse, imagesResponse] = await Promise.all([
          fetch(
            `${TMDB_CONFIG.BASE_URL}/movie/${movie.id}`,
            {
              method: 'GET',
              headers: TMDB_CONFIG.headers,
            }
          ),
          fetch(
            `${TMDB_CONFIG.BASE_URL}/movie/${movie.id}/images`,
            {
              method: 'GET',
              headers: TMDB_CONFIG.headers,
            }
          )
        ]);

        if (!detailsResponse.ok || !imagesResponse.ok) {
          return null;
        }

        const [details, imagesData] = await Promise.all([
          detailsResponse.json(),
          imagesResponse.json()
        ]);
        
        // Get movie logos (English or no language)
        const logos = (imagesData.logos || [])
          .filter((logo: any) => !logo.iso_639_1 || logo.iso_639_1 === 'en');
        
        // Extract release year for sorting
        const releaseYear = new Date(movie.release_date).getFullYear();
        
        // Ensure we have both budget and revenue data
        if (details.budget > 1000000 && details.revenue > 1000000) {
          const profit = details.revenue - details.budget;
          // Only include profitable movies (revenue > budget)
          if (details.revenue > details.budget * 1.3) { // At least 30% profit
            return {
              ...movie,
              budget: details.budget,
              revenue: details.revenue,
              profit: profit,
              profitRatio: details.revenue / details.budget,
              logo_path: logos.length > 0 ? logos[0].file_path : null,
              backdrop_path: movie.backdrop_path || details.backdrop_path,
              releaseYear: releaseYear,
              yearPriority: releaseYear === currentYear ? 1 : 
                           releaseYear === currentYear - 1 ? 2 : 3
            };
          }
        }
        return null;
      } catch (error) {
        console.error(`Error fetching details for movie ${movie.id}:`, error);
        return null;
      }
    });
    
    // Wait for all promises to resolve
    const detailedMovies = await Promise.all(detailedMoviesPromises);
    
    // First filter out null values
    const validMovies = detailedMovies.filter(movie => movie !== null);
    
    // Calculate raw profit amount and ratio for sorting
    const moviesWithProfit = validMovies.map((movie: any) => ({
      ...movie,
      absoluteProfit: movie.revenue - movie.budget,
      profitRatio: movie.revenue / movie.budget
    }));
    
    // Sort movies - first by year, then by absolute profit amount
    const sortedMovies = moviesWithProfit.sort((a: any, b: any) => {
      // First sort by year priority
      if (a.yearPriority !== b.yearPriority) {
        return a.yearPriority - b.yearPriority;
      }
      
      // If same year priority, sort by absolute profit (highest first)
      return b.absoluteProfit - a.absoluteProfit;
    });
    
    return sortedMovies.slice(0, Math.min(limit, sortedMovies.length));
    
  } catch (error) {
    console.error('Error fetching cash cow movies:', error);
    throw error;
  }
};

// Updated function for Money Pit movies - no fake data, prioritize by year and finances
export const fetchMoneyPitMovies = async (limit: number = 8) => {
  try {
    // Increase the time range to 2 years to find more candidates
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    
    // Get current year for sorting priority
    const currentYear = new Date().getFullYear();
    
    // Format date to YYYY-MM-DD as required by TMDB API
    const minDate = twoYearsAgo.toISOString().split('T')[0];
    
    // Fetch multiple pages to ensure we get enough candidates
    let allResults: any[] = [];
    
    // Fetch up to 5 pages to get a larger candidate pool
    for (let page = 1; page <= 5; page++) {
      const response = await fetch(
        `${TMDB_CONFIG.BASE_URL}/discover/movie?` +
        `sort_by=primary_release_date.desc&` + // Sort by most recent first
        `vote_count.gte=50&` + // Keep minimum votes
        `primary_release_date.gte=${minDate}&` +
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
      
      // If we have enough results, stop fetching more pages
      if (allResults.length >= 100) { // Higher number to find enough money pits
        break;
      }
    }
    
    // Process a larger set of movies to find enough that meet criteria
    const moviesWithDetails = await Promise.all(
      allResults.map(async (movie: any) => {
        try {
          const [detailsResponse, imagesResponse] = await Promise.all([
            fetch(
              `${TMDB_CONFIG.BASE_URL}/movie/${movie.id}`,
              {
                method: 'GET',
                headers: TMDB_CONFIG.headers,
              }
            ),
            fetch(
              `${TMDB_CONFIG.BASE_URL}/movie/${movie.id}/images`,
              {
                method: 'GET',
                headers: TMDB_CONFIG.headers,
              }
            )
          ]);

          if (!detailsResponse.ok || !imagesResponse.ok) {
            return null;
          }

          const [details, imagesData] = await Promise.all([
            detailsResponse.json(),
            imagesResponse.json()
          ]);
          
          // Get movie logos (English or no language)
          const logos = (imagesData.logos || [])
            .filter((logo: any) => !logo.iso_639_1 || logo.iso_639_1 === 'en');
          
          // Extract release year for sorting
          const releaseYear = new Date(movie.release_date).getFullYear();
          
          // Only include if both budget and revenue are known and significant
          if (details.budget > 1000000 && details.revenue > 0) {
            const profit = details.revenue - details.budget;
            // Only include if it made a significant loss (revenue < budget)
            if (details.revenue < details.budget * 0.85) { // At least 15% loss
              return {
                ...movie,
                budget: details.budget,
                revenue: details.revenue,
                profit: profit,
                lossRatio: details.revenue / details.budget,
                logo_path: logos.length > 0 ? logos[0].file_path : null,
                backdrop_path: movie.backdrop_path || details.backdrop_path,
                releaseYear: releaseYear,
                yearPriority: releaseYear === currentYear ? 1 : 
                             releaseYear === currentYear - 1 ? 2 : 3
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
    
    // Filter out null results 
    const validMovies = moviesWithDetails.filter(movie => movie !== null);
    
    // Calculate absolute loss for sorting
    const moviesWithLoss = validMovies.map((movie: any) => ({
      ...movie,
      absoluteLoss: movie.budget - movie.revenue,
      lossRatio: movie.revenue / movie.budget
    }));
    
    // Sort movies - first by year, then by absolute loss amount
    const sortedMovies = moviesWithLoss.sort((a: any, b: any) => {
      // First sort by year priority
      if (a.yearPriority !== b.yearPriority) {
        return a.yearPriority - b.yearPriority;
      }
      
      // If same year priority, sort by absolute loss (highest first)
      return b.absoluteLoss - a.absoluteLoss;
    });
    
    return sortedMovies.slice(0, Math.min(limit, sortedMovies.length));
    
  } catch (error) {
    console.error('Error fetching money pit movies:', error);
    throw error;
  }
};

