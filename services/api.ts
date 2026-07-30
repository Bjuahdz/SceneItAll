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
    // ONE request, not three. `append_to_response` folds the release-dates and credits
    // sub-resources into the same payload, so this costs a single round-trip instead of
    // three parallel ones — the Discover hero prefetches 7 movies, which was 21 requests
    // and is now 7. (services/genres.ts already used this pattern; the two agree now.)
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}?append_to_response=release_dates,credits`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Appended sub-resources arrive nested under their own keys, in exactly the shape
    // the standalone /release_dates and /credits endpoints returned. Peel them off so
    // the `...movieData` spread at the bottom yields the same MovieDetails as before —
    // no stray release_dates/credits keys leaking into the returned object.
    const {
      release_dates: releaseDatesData = { results: [] },
      credits: creditsData = { crew: [], cast: [] },
      ...movieData
    } = await response.json();

    // US certification — TMDB lists SEVERAL release entries per country (premiere,
    // limited, theatrical, digital, physical, TV) and many carry an EMPTY
    // certification. Taking entry [0] made films whose first entry is a festival
    // premiere read "NR" even though the theatrical entry right below holds the
    // real rating (same first-item-wins bug the trailer fetch had). Scan every US
    // entry with a non-empty certification, preferring the types most likely to
    // carry the actual board rating.
    const CERT_TYPE_PRIORITY = [3, 4, 2, 5, 6, 1]; // theatrical → digital → limited → physical → TV → premiere
    const certPriority = (type: number) => {
      const i = CERT_TYPE_PRIORITY.indexOf(type);
      return i === -1 ? CERT_TYPE_PRIORITY.length : i;
    };
    const usCerts = (
      releaseDatesData.results?.find((r: any) => r.iso_3166_1 === 'US')?.release_dates ?? []
    )
      .filter((d: any) => typeof d.certification === 'string' && d.certification.trim().length > 0)
      .sort((a: any, b: any) => certPriority(a.type) - certPriority(b.type));
    const certification = usCerts[0]?.certification.trim() || 'NR';

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

    // Get directors from credits, deduped by person (keep their headshot).
    const directorMap = new Map<number, { id: number; name: string; profile_path: string | null }>();
    creditsData.crew
      .filter((person: any) => person.job === 'Director')
      .forEach((d: any) => {
        if (!directorMap.has(d.id)) {
          directorMap.set(d.id, { id: d.id, name: d.name, profile_path: d.profile_path ?? null });
        }
      });
    const directors = Array.from(directorMap.values());

    // Get writers from credits, deduped by person with their jobs merged so that
    // someone credited as both "Screenplay" and "Story" surfaces as a single face.
    const writerMap = new Map<number, { id: number; name: string; profile_path: string | null; jobs: string[] }>();
    creditsData.crew
      .filter((person: any) => ['Screenplay', 'Writer', 'Story'].includes(person.job))
      .forEach((w: any) => {
        const existing = writerMap.get(w.id);
        if (existing) {
          if (!existing.jobs.includes(w.job)) existing.jobs.push(w.job);
        } else {
          writerMap.set(w.id, { id: w.id, name: w.name, profile_path: w.profile_path ?? null, jobs: [w.job] });
        }
      });
    const writers = Array.from(writerMap.values()).map((w) => ({
      id: w.id,
      name: w.name,
      job: w.jobs.join(', '),
      profile_path: w.profile_path,
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
// THE single source of truth for a movie's artwork — hero, cards, trending rail,
// the detail backdrop and the Extras galleries all read from here. Requesting
// `include_image_language=en,null` makes TMDB return just the English + textless
// variants instead of every localized poster: smaller, faster responses, and one
// 30-minute cache shared by every screen.
//
// Don't add a second /images request anywhere. The Extras tab used to fetch this
// endpoint twice more on its own (once for posters, once for backdrops), unfiltered
// and uncached, so opening a movie cost three round-trips to the same URL and the
// gallery ordered its posters differently from the hero. Everything is served off
// this one call now — take another field from it rather than fetching again.
export type MovieImages = {
  poster: string | null;        // best-ranked textless poster — hero + cards
  variantPoster: string | null; // runner-up, but ONLY if independently vetted (see
                                // MIN_VETTED_VOTES). null means "no safe alternative,
                                // reuse `poster`" — the detail hero relies on that.
  logo: string | null;          // english / no-language title logo file_path
  posters: string[];            // EVERY textless poster, best-ranked first — Extras
  backdrops: string[];          // every textless backdrop, TMDB order — Extras
};

// Picking the textless poster — why this is a ranking and not just `posters[0]`.
//
// `iso_639_1: null` is a CONTRIBUTOR LABEL, not a fact about the pixels. It only means
// "whoever uploaded this left the language blank", so full billing-block posters get
// filed under it all the time. The Odyssey shipped one with the title, both leads'
// names, the release date and the IMAX credits baked in, and it passed this filter
// legitimately (2026-07-28).
//
// Worse, TMDB returns posters sorted by `vote_average` DESC, and a poster with a
// single vote scores ~3.33 — above almost every properly-vetted poster on a new
// release, whose averages settle around 1–2.5 once real votes accumulate. So taking
// [0] was systematically biased toward the ONE upload nobody but its uploader had
// seen. That is exactly what the bad Odyssey poster was: 1 vote, 1063px wide, while
// the genuine textless teaser sat one slot below it with 4 votes at 2000px.
//
// So rank rather than trust the order:
//   · drop anything under MIN_POSTER_WIDTH — studio art is never that small, scrapes are
//   · score by a Bayesian weighted rating, so 1 vote @ 3.33 can't beat 4 votes @ 2.28
//   · break ties on resolution, which is what decides the case where nothing is voted on
//
// Resolution is ONLY a tie-break, deliberately: ranking it above votes swapped Fight
// Club's iconic soap poster for a blank sheet of wrapping paper that happened to be
// bigger. Votes are the signal; pixels are the coin-flip.
//
// This stays a heuristic over human labels — nothing short of reading the pixels can
// promise "no text" — but it now prefers the poster the community actually vetted.
const MIN_POSTER_WIDTH = 1000; // below this it's a scrape or a screenshot, not studio art
const VOTE_PRIOR = 3;          // votes a rating must earn before it stands on its own

// Votes a RUNNER-UP poster needs before the detail hero will show it instead of the
// cover. Two means at least one person besides the uploader has looked at it.
//
// This is the whole difference between `variantPoster` and the old `altPoster`. That
// one took posters[1] unconditionally, which by construction is the less-vetted image
// — KPop Demon Hunters served its full billing-block poster there, and Fight Club's
// runner-up is a blank sheet of wrapping paper. Both are ZERO-vote uploads, so a
// two-vote floor rejects exactly those while still allowing variety where the
// community has actually weighed in.
const MIN_VETTED_VOTES = 2;

// Returns the ranked poster OBJECTS (not just paths) — callers need vote_count to
// decide whether a runner-up is trustworthy enough to show.
const rankTextlessPosters = (allPosters: any[]): any[] => {
  const textless = (allPosters || []).filter(
    (p: any) => !p.iso_639_1 && p.width >= MIN_POSTER_WIDTH
  );
  if (textless.length === 0) return [];

  // Bayesian mean: pull every rating toward the set's own average until it has earned
  // enough votes to be believed on its own.
  const mean =
    textless.reduce((sum: number, p: any) => sum + p.vote_average, 0) / textless.length;
  const score = (p: any) =>
    (p.vote_count / (p.vote_count + VOTE_PRIOR)) * p.vote_average +
    (VOTE_PRIOR / (p.vote_count + VOTE_PRIOR)) * mean;

  return [...textless].sort((a: any, b: any) => score(b) - score(a) || b.width - a.width);
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

    // Every no-language poster, ranked by how well-vetted it is (see rankTextlessPosters
    // above — TMDB's own order is NOT trustworthy here). One request already contains
    // them all, so every field below costs zero extra API calls. Language posters are
    // ignored (baked-in text).
    const ranked = rankTextlessPosters(data.posters);
    const posters: string[] = ranked.map((p: any) => p.file_path);

    // The runner-up, offered ONLY when the community has actually vetted it. Null here
    // is meaningful: it tells the detail hero "there is no safe alternative, reuse the
    // cover" rather than silently handing back a worse image.
    const runnerUp = ranked[1];
    const variantPoster: string | null =
      runnerUp && runnerUp.vote_count >= MIN_VETTED_VOTES ? runnerUp.file_path : null;

    // Textless backdrops for the Extras gallery. Same language rule as posters — a
    // tagged backdrop has a title or credits burned into it. No ranking here: a
    // gallery wants breadth, and backdrops carry no vote signal worth sorting on.
    const backdrops: string[] = (data.backdrops || [])
      .filter((b: any) => !b.iso_639_1)
      .map((b: any) => b.file_path);

    // Logo: prefer no-language, else an English one (still clean over the poster).
    const logo =
      (data.logos || []).find((l: any) => !l.iso_639_1 || l.iso_639_1 === 'en')
        ?.file_path ?? null;

    const result: MovieImages = {
      poster: posters[0] ?? null,
      variantPoster,
      logo,
      posters,
      backdrops,
    };
    setImageCache(movieId, result);
    return result;
  } catch (error) {
    console.error(`Error fetching images for movie ${movieId}:`, error);
    return { poster: null, variantPoster: null, logo: null, posters: [], backdrops: [] };
  }
};


// Add this new function to fetch trailers
export const fetchMovieVideos = async (movieId: string): Promise<MovieVideo[]> => {
  try {
    // include_video_language keeps language-less uploads too — some films' only
    // trailers are tagged with no language and were silently dropped before.
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}/videos?include_video_language=en,null`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Graceful widening instead of a hard "official Trailer" gate: prefer official
    // trailers, fall back to ANY trailer, then to teasers. Movies whose only uploads
    // are unofficial cuts or teasers used to show "No trailers available" even though
    // TMDB clearly lists videos for them.
    const youtube: MovieVideo[] = (data.results ?? []).filter(
      (video: MovieVideo) => video.site === 'YouTube'
    );
    const officialTrailers = youtube.filter((v) => v.type === 'Trailer' && v.official);
    const anyTrailers = youtube.filter((v) => v.type === 'Trailer');
    const teasers = youtube.filter((v) => v.type === 'Teaser');
    const picked =
      officialTrailers.length > 0 ? officialTrailers : anyTrailers.length > 0 ? anyTrailers : teasers;

    return [...picked].sort((a: MovieVideo, b: MovieVideo) => {
      // Sort by published date (oldest first)
      return new Date(a.published_at).getTime() - new Date(b.published_at).getTime();
    });
  } catch (error) {
    console.error('Error fetching movie videos:', error);
    return [];
  }
};

// Accessibility / alternate cuts that shouldn't be THE trailer the player opens:
// audio-described, voiceover/narrated, sign-language, and dubbed versions. TMDB
// tags these as type "Trailer" + official, so name is the only signal. The Extras
// tab still lists them — this only steers the one-tap player pick.
const ALT_TRAILER = /audio\s?descri|described|voice\s?over|narrat|descriptive|sign\s?language|\basl\b|\bhoh\b|dubbed|\bdub\b|foreign/i;

/**
 * pickMainTrailer — from a movie's videos (as returned by fetchMovieVideos, sorted
 * oldest-first), choose the single best MAIN trailer to play: drop the accessibility
 * / alternate cuts, then prefer official trailers → any trailer → teaser, and among
 * those take the newest (usually the theatrical / final trailer). Returns undefined
 * only if there's nothing playable at all.
 */
export const pickMainTrailer = (videos: MovieVideo[]): MovieVideo | undefined => {
  if (!videos || videos.length === 0) return undefined;
  const main = videos.filter((v) => !ALT_TRAILER.test(v.name));
  const pool = main.length > 0 ? main : videos; // all were alt cuts → don't strand the user
  const officialTrailers = pool.filter((v) => v.type === 'Trailer' && v.official);
  const anyTrailers = pool.filter((v) => v.type === 'Trailer');
  const teasers = pool.filter((v) => v.type === 'Teaser');
  const best =
    officialTrailers.length > 0 ? officialTrailers : anyTrailers.length > 0 ? anyTrailers : teasers.length > 0 ? teasers : pool;
  return best[best.length - 1]; // newest of the chosen tier
};

// Watch providers (JustWatch data via TMDB) — what's streamable / rentable /
// buyable, per region. TMDB exposes availability only, no deep links, and the
// data source must be attributed to JustWatch wherever it's shown.
// https://developer.themoviedb.org/reference/movie-watch-providers
export type WatchProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
};

export type MovieWatchProviders = {
  region: string;
  link: string | null;
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
};

export const fetchWatchProviders = async (
  movieId: string,
  region: string = 'US'
): Promise<MovieWatchProviders | null> => {
  try {
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}/watch/providers`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    // Strictly the requested region (US by default) — no cross-region fallback.
    const entry = (data.results || {})[region];
    if (!entry) return null;

    return {
      region,
      link: entry.link ?? null,
      flatrate: entry.flatrate ?? [],
      rent: entry.rent ?? [],
      buy: entry.buy ?? [],
    };
  } catch (error) {
    console.error('Error fetching watch providers:', error);
    return null;
  }
};

// Similar movies for the detail page's SIMILAR tab. TMDB matches on genres +
// plot keywords (results can be loose — documented behavior), so we just keep
// the ones with a poster and cap the list.
// https://developer.themoviedb.org/reference/movie-similar
export const fetchSimilarMovies = async (movieId: string, limit: number = 8) => {
  try {
    const response = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}/recommendations?language=en-US&page=1`,
      {
        method: 'GET',
        headers: TMDB_CONFIG.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return (data.results || [])
      .filter((movie: any) => movie.poster_path)
      .slice(0, limit);
  } catch (error) {
    console.error('Error fetching similar movies:', error);
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

