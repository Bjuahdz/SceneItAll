// ─────────────────────────────────────────────────────────────────────────────
// Genre breakdown for the Home dashboard "Your taste" section.
//
// The user's top genres are derived from the movies they've saved. Favorites don't
// persist genre data, so we resolve it from TMDB and memoize per session:
//   • the id→name map is fetched once,
//   • each movie's genre ids are fetched at most once and cached.
//
// PERF NOTE: this is a one-time-per-movie detail call (cached for the session). The
// zero-call path is to persist `genre_ids` on a movie when it's first saved — a small
// addition to the favorites write flow worth doing if this list grows large.
// ─────────────────────────────────────────────────────────────────────────────
import { TMDB_CONFIG } from "./api";

export interface GenreCount {
  id: number;
  name: string;
  count: number;
  movieIds: number[]; // which of the tallied movies carry this genre (drives drill-down)
}

// id → display name, fetched once and reused for the whole session.
let genreMapPromise: Promise<Map<number, string>> | null = null;

const getGenreMap = (): Promise<Map<number, string>> => {
  if (!genreMapPromise) {
    genreMapPromise = fetch(`${TMDB_CONFIG.BASE_URL}/genre/movie/list?language=en`, {
      method: "GET",
      headers: TMDB_CONFIG.headers,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(
        (data) =>
          new Map<number, string>(
            (data.genres ?? []).map((g: { id: number; name: string }) => [g.id, g.name])
          )
      )
      .catch((err) => {
        genreMapPromise = null; // allow a retry on the next call
        throw err;
      });
  }
  return genreMapPromise;
};

// movie id → its metadata, cached so each movie is only ever fetched once per
// session. Credits ride the same detail request (append_to_response) and the
// collection/companies are in the base payload, so relationships cost zero
// extra API calls beyond the genre lookup we already make.

// A name we KNOW belongs to this film (with its TMDB id) — the ground truth the
// Phase 3 entity extractor matches transcripts against before ever asking an LLM.
// `kind` values are a subset of TakeEntityType in services/db.ts.
export interface KnownEntity {
  kind: "director" | "composer" | "actor" | "studio" | "collection";
  name: string;
  tmdbId: number | null;
}

export interface MovieMeta {
  genreIds: number[]; //        TMDB order — the film's first two genres are its display genres
  director: string | null;
  actors: string[]; //          top-billed (first 3)
  studio: string | null; //     first production company
  collection: string | null; // belongs_to_collection name
  roster: KnownEntity[]; //     director/composer/top cast/studio/collection WITH ids (Phase 3)
}

const movieMetaCache = new Map<number, MovieMeta>();

const getMovieMeta = async (movieId: number): Promise<MovieMeta> => {
  const cached = movieMetaCache.get(movieId);
  if (cached) return cached;
  try {
    const res = await fetch(
      `${TMDB_CONFIG.BASE_URL}/movie/${movieId}?append_to_response=credits`,
      {
        method: "GET",
        headers: TMDB_CONFIG.headers,
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const genreIds: number[] = Array.isArray(data.genres)
      ? data.genres.map((g: { id: number }) => g.id)
      : [];
    const crew: { id?: number; job?: string; name?: string }[] = data.credits?.crew ?? [];
    const cast: { id?: number; name?: string }[] = data.credits?.cast ?? [];
    const director = crew.find((c) => c.job === "Director");
    const composer = crew.find((c) => c.job === "Original Music Composer");
    const studio: { id?: number; name?: string } | undefined = data.production_companies?.[0];
    const collection: { id?: number; name?: string } | undefined =
      data.belongs_to_collection ?? undefined;

    // Ground-truth roster for transcript entity matching: known names WITH TMDB ids.
    // Cast goes deeper (8) than the display `actors` (3) — supporting players get
    // talked about too, and extra names cost nothing here.
    const roster: KnownEntity[] = [];
    if (director?.name) roster.push({ kind: "director", name: director.name, tmdbId: director.id ?? null });
    if (composer?.name) roster.push({ kind: "composer", name: composer.name, tmdbId: composer.id ?? null });
    for (const c of cast.slice(0, 8)) {
      if (c.name) roster.push({ kind: "actor", name: c.name, tmdbId: c.id ?? null });
    }
    if (studio?.name) roster.push({ kind: "studio", name: studio.name, tmdbId: studio.id ?? null });
    if (collection?.name) roster.push({ kind: "collection", name: collection.name, tmdbId: collection.id ?? null });

    const meta: MovieMeta = {
      genreIds,
      director: director?.name ?? null,
      actors: cast.slice(0, 3).map((c) => c.name ?? "").filter(Boolean),
      studio: studio?.name ?? null,
      collection: collection?.name ?? null,
      roster,
    };
    movieMetaCache.set(movieId, meta);
    return meta;
  } catch {
    return { genreIds: [], director: null, actors: [], studio: null, collection: null, roster: [] };
  }
};

/** Full metadata for a set of movies (explore relationships). Cached with genres. */
export const getMovieMetas = async (
  movieIds: number[]
): Promise<Map<number, MovieMeta>> => {
  const metas = await Promise.all(movieIds.map(getMovieMeta));
  const out = new Map<number, MovieMeta>();
  movieIds.forEach((id, i) => out.set(id, metas[i]));
  return out;
};

/**
 * Tally genres across a set of movies, most-common first. Each entry also carries
 * the ids of the movies that belong to it, so the UI can drill from a genre into
 * the actual films (a movie with several genres appears under each of them).
 *
 * Bounded by `maxMovies` so the cold-load cost stays predictable for large libraries;
 * the most recent saves dominate a user's current taste anyway. Returns the full sorted
 * breakdown — callers slice for "top N" and can use `.length` for distinct-genre count.
 */
export const getGenreBreakdown = async (
  movieIds: number[],
  maxMovies = 40
): Promise<GenreCount[]> => {
  const ids = movieIds.slice(0, maxMovies);
  const [genreMap, perMovie] = await Promise.all([
    getGenreMap(),
    Promise.all(ids.map(getMovieMeta)),
  ]);

  const members = new Map<number, number[]>();
  ids.forEach((movieId, i) => {
    for (const gid of perMovie[i].genreIds) {
      const list = members.get(gid);
      if (list) list.push(movieId);
      else members.set(gid, [movieId]);
    }
  });

  return Array.from(members.entries())
    .map(([id, movies]) => ({
      id,
      name: genreMap.get(id) ?? "",
      count: movies.length,
      movieIds: movies,
    }))
    .filter((g) => g.name !== "")
    .sort((a, b) => b.count - a.count);
};
