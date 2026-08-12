// ─────────────────────────────────────────────────────────────────────────────
// Entity destination pages: person, collection, studio (TMDB "company").
//
// All three render the SAME shape — a hero that collapses, then a filmography sheet
// split into RELEASED and UPCOMING — so they share one normalized type here rather
// than three near-identical ones in three screens.
// ─────────────────────────────────────────────────────────────────────────────
import type { FilterState } from "@/hooks/useFilterState";
import { TMDB_CONFIG } from "./api";

const getJson = async (path: string, signal?: AbortSignal): Promise<any> => {
  const res = await fetch(`${TMDB_CONFIG.BASE_URL}${path}`, {
    method: "GET",
    headers: TMDB_CONFIG.headers,
    signal,
  });
  if (!res.ok) throw new Error(`TMDB request failed (${res.status})`);
  return res.json();
};

/**
 * Feature, short, or documentary.
 *
 * Shorts and documentaries are SEPARATED, never hidden — a person's credit list is
 * theirs and dropping half of it would be dishonest. But mixing Nolan's three
 * student shorts in among his features made the sheet read as noise and inflated his
 * headline count from 12 to 19, so each gets its own section.
 */
export type FilmCategory = "feature" | "short" | "documentary";

export interface EntityFilm {
  id: number;
  title: string;
  category: FilmCategory;
  /** "2023" for a released film. */
  year: string | null;
  /** "JUL 2026" for something unreleased — when is the useful fact, not what year. */
  releaseLabel: string | null;
  released: boolean;
  releaseDate: string | null;
  /** TMDB genre ids, straight off the credit. Empty when TMDB has none. */
  genreIds: number[];
  /** TMDB community score, 0–10. MEANINGLESS when `voteCount` is 0: an unrated
   *  film reports `vote_average: 0`, which is not a 0.0 film — every upcoming
   *  title would sink below any rating floor that read it as one. `voteCount`
   *  is what distinguishes "rated 0-ish" from "nobody has rated this". */
  voteAverage: number;
  voteCount: number;
  /**
   * Backdrop path, straight off the credit row — FREE, it was in every response
   * this mapper reads and was simply being dropped. Null is common (small films
   * have no backdrop) and means the expanded row renders the no-artwork panel,
   * exactly the search flow's rule. Added 2026-08-11 for the filmography
   * accordion: rows unroll into the same marquee card the search results use.
   */
  imagePath: string | null;
  /**
   * TELEVISION, and the only field here an entity credit never sets.
   *
   * Absent on every filmography row — `combined_credits` is not wired, so an
   * entity page holds films and nothing else. It exists for the SEARCH results
   * filter, where `/search/multi` genuinely returns shows alongside films and
   * the KIND control finally has something to separate. Optional rather than
   * required precisely so its absence keeps meaning "film", which is what every
   * existing caller already assumes.
   */
  isShow?: boolean;
}

export interface EntityPage {
  kind: "person" | "collection" | "company";
  id: number;
  /** DIRECTOR / COLLECTION / STUDIO — the accent label above the name. */
  role: string;
  name: string;
  /** Hero artwork. Null is COMMON, not exceptional — 80% of a film's crew have no
   *  photo — and null means the page renders its no-artwork header instead. */
  imagePath: string | null;
  /** Long-form prose. People have bios, collections have overviews, studios have
   *  neither (A24's `description` is empty, which is typical). */
  overview: string | null;
  /** Two-column facts under the name. Empty when TMDB has nothing. */
  vitals: { label: string; value: string }[];
  films: EntityFilm[];
  /** The TRUE size of the catalogue, which for a studio is far larger than `films`.
   *  /discover paginates at 20, so the page shows a first page of a much longer
   *  list and must say so rather than reporting 20 as the total. */
  totalFilms: number;
  /** True when `films` is only the first page of a longer catalogue. */
  truncated: boolean;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Exported for unit tests — the date handling here is subtle enough to be worth
// pinning down, and it cannot be exercised without a device otherwise.
export const toFilm = (raw: any, opts?: { category?: FilmCategory }): EntityFilm | null => {
  if (!raw?.id) return null;
  const date: string | null = raw.release_date || null;
  const title = raw.title ?? raw.name ?? "";
  if (!title) return null;

  // No date at all is not "upcoming" — it is unknown. Treat it as released so it
  // does not invent a future for a film that may be decades old.
  const category: FilmCategory = opts?.category ?? "feature";
  const genreIds: number[] = Array.isArray(raw.genre_ids) ? raw.genre_ids : [];
  const voteAverage: number = typeof raw.vote_average === "number" ? raw.vote_average : 0;
  const voteCount: number = typeof raw.vote_count === "number" ? raw.vote_count : 0;

  if (!date) {
    return {
      id: raw.id,
      title,
      category,
      year: null,
      releaseLabel: null,
      released: true,
      releaseDate: null,
      genreIds,
      voteAverage,
      voteCount,
      imagePath: typeof raw.backdrop_path === "string" && raw.backdrop_path ? raw.backdrop_path : null,
    };
  }

  // Read the month off the STRING, never off a Date. `new Date("2026-01-01")` is
  // parsed as UTC midnight, so `.getMonth()` in any UTC-negative timezone reports
  // December — a January release would have rendered "DEC 2026", a month that never
  // existed for that title.
  const monthIndex = Number(date.slice(5, 7)) - 1;
  // Compare as strings too, for the same reason: no parsing, no offset.
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
  const released = date <= todayIso;
  return {
    id: raw.id,
    title,
    category,
    year: date.slice(0, 4),
    releaseLabel: `${MONTHS[monthIndex] ?? ""} ${date.slice(0, 4)}`.trim(),
    released,
    releaseDate: date,
    genreIds,
    voteAverage,
    voteCount,
    imagePath: typeof raw.backdrop_path === "string" && raw.backdrop_path ? raw.backdrop_path : null,
  };
};

/** Decade start year ("2014-05-01" → 2010), or null when the film has no date. */
export const decadeOf = (releaseDate: string | null): number | null => {
  if (!releaseDate) return null;
  const year = Number(releaseDate.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return Math.floor(year / 10) * 10;
};

/**
 * The decades THIS filmography spans, newest first — the DECADE control's option
 * list is derived, never a fixed range (Chris Pratt gets no 1920s). A future
 * decade appears exactly when a dated unreleased title sits in it, which is the
 * ruled behaviour; undated films contribute nothing rather than inventing one.
 */
export const decadesIn = (films: EntityFilm[]): number[] => {
  const decades = new Set<number>();
  for (const f of films) {
    const d = decadeOf(f.releaseDate);
    if (d !== null) decades.add(d);
  }
  return Array.from(decades).sort((a, b) => b - a);
};

/** Newest first — the order every entity board uses. */
const newestFirst = (a: EntityFilm, b: EntityFilm) =>
  (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");

/** `.filter(Boolean)` does not narrow in TS; this does. */
const compact = (rows: (EntityFilm | null)[]): EntityFilm[] =>
  rows.filter((f): f is EntityFilm => f !== null);

/* ────────────────────────────────────────────────────────────────────────────
   ▸ THE FILTER, AS PURE FUNCTIONS.

   They live here rather than in the sheet because TWO callers must agree to the
   film: the sheet counts with them to print "08 OF 48", and the page filters
   with them to show those eight. If those two ever ran different logic the
   count would be a lie, and it would be a lie nobody could see was a lie.

   Every control answers "leave this film in?" and an untouched control answers
   YES to everything — which is why FILTER_DEFAULTS produces the whole list
   unchanged rather than a special case anyone has to remember to write.
   ──────────────────────────────────────────────────────────────────────────── */

export const matchesFilter = (f: EntityFilm, s: FilterState): boolean => {
  if (s.status === "released" && !f.released) return false;
  if (s.status === "upcoming" && f.released) return false;

  // FILM keeps everything we hold — features, shorts and documentaries are all
  // films; the question this control asks is film-vs-television.
  //
  // ▸ `isShow` IS WHAT MAKES THIS HONEST ON BOTH SURFACES, with no branch and no
  // surface flag. On an entity page no row sets it, so SHOWS still matches
  // nothing ("0 OF 48" is the truth — combined_credits is not wired) and FILM
  // still keeps everything, exactly as before. On search results, where
  // /search/multi really does return television, the same two lines finally
  // separate the two piles. The control stopped being decoration without the
  // predicate learning where it was being called from.
  if (s.kind === "shows" && !f.isShow) return false;
  if (s.kind === "film" && f.isShow) return false;
  // ▸ AND A FILM IS NEVER A PERSON, A STUDIO OR A COLLECTION. Those three exist
  // only in the search results cycle (SEARCH_KIND_CYCLE) and are answered by
  // rows that are not films at all, so nothing here can match one — the search
  // side gates on entity type before this predicate ever sees a row. Stated
  // explicitly rather than left to fall through, because falling through would
  // mean asking for STUDIOS and being handed films.
  if (s.kind === "person" || s.kind === "studio" || s.kind === "collection") return false;

  if (s.decade !== null && decadeOf(f.releaseDate) !== s.decade) return false;

  // ⚠ THE UNRATED TRAP. A film nobody has rated reports vote_average 0, which is
  // not a 0.0 film — it is no film at all as far as a rating floor is concerned.
  // Reading it as a score would silently delete every upcoming title the moment
  // the knob left zero, which is the failure this field's voteCount exists to
  // prevent. No votes, no opinion: it cannot clear a floor it has no score for.
  if (s.minRating > 0 && (f.voteCount === 0 || f.voteAverage < s.minRating)) return false;

  // PICK ANY — the board's own word, so these are OR'd. Genres are a widening
  // choice, not a narrowing one: picking DRAMA and CRIME asks for both piles,
  // not for the films that are somehow both at once.
  if (s.genres.length > 0 && !f.genreIds.some((id) => s.genres.includes(id))) return false;

  return true;
};

/** The live count, without building the list to get it. */
export const countMatching = (films: EntityFilm[], s: FilterState): number => {
  let n = 0;
  for (const f of films) if (matchesFilter(f, s)) n++;
  return n;
};

/**
 * Filtered AND sorted, in that order — the page renders exactly this.
 *
 * ▸ WHAT WE DO NOT KNOW GOES LAST, IN BOTH DIRECTIONS. This is the same trap as
 *   the rating floor, and reversing the sort is what re-opens it. An unrated
 *   film reports `vote_average: 0` and an undated one has no date at all —
 *   neither is a small value, both are an ABSENT one. Multiplying a comparator
 *   by −1 (the obvious way to write a direction) flips them from the bottom of
 *   the list to the TOP, so asking for LOWEST RATED would answer with a stack
 *   of films nobody has rated, and OLDEST with films that have no date. They
 *   are pinned last instead, and only the films that can actually answer the
 *   question get reversed.
 *
 * ▸ Ties fall back to newest-first, which is the order the page has everywhere
 *   else.
 *
 * ▸ GENERIC over the row type so a caller may hand it something RICHER than an
 *   EntityFilm and get its own type back. The search results filter does exactly
 *   that — it passes rows carrying the SearchResult they were derived from — and
 *   that is what keeps one predicate and one set of comparators serving both
 *   surfaces instead of a second copy drifting out of agreement with this one.
 *   Nothing here constructs a row; it only filters and sorts what it was given,
 *   which is why widening the type is safe.
 */
export const applyFilter = <T extends EntityFilm>(films: T[], s: FilterState): T[] => {
  const kept = films.filter((f) => matchesFilter(f, s));
  const dir = s.desc ? 1 : -1;

  /**
   * ▸ RELEVANCE IS THE ORDER IT ARRIVED IN, and there is nothing to compute.
   *
   * Only the search surface can ask for it (SEARCH_SORT_CYCLE), and there the
   * incoming order IS the ranking — the reason the film you meant sits at 01.
   * So the sort is the absence of a sort, and DESC simply means "leave the
   * ranking alone". Reversing is offered for symmetry with the other two fields
   * rather than because worst-match-first is useful; `slice` keeps it from
   * mutating the caller's array, which the other two branches get for free from
   * `filter` having already copied.
   */
  if (s.sort === "relevance") return s.desc ? kept : kept.slice().reverse();

  if (s.sort === "rating") {
    return kept.sort((a, b) => {
      const ra = a.voteCount > 0 ? a.voteAverage : null;
      const rb = b.voteCount > 0 ? b.voteAverage : null;
      if (ra === null && rb === null) return newestFirst(a, b);
      if (ra === null) return 1;
      if (rb === null) return -1;
      return ra !== rb ? (rb - ra) * dir : newestFirst(a, b);
    });
  }

  return kept.sort((a, b) => {
    const da = a.releaseDate;
    const db = b.releaseDate;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da) * dir;
  });
};

export const shortPlace = (place: string | null): string | null => {
  if (!place) return null;
  // TMDB gives "Westminster, London, England, UK"; the two-column vitals row fits
  // city + country, so keep the ends and drop the middle.
  const parts = place.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return place.toUpperCase();
  return `${parts[0]}, ${parts[parts.length - 1]}`.toUpperCase();
};

// String slicing, not Date getters — see the note in toFilm(). Parsing "1970-07-30"
// as UTC and reading it back with local getters renders JUL 29 west of Greenwich.
export const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? ""} ${Number(d)}, ${y}`;
};

// Age at death for someone who has died, age today for someone living. Compared as
// Y/M/D integers pulled from the strings, so no timezone can shift the birthday.
export const ageFrom = (birthday: string, deathday: string | null): number => {
  const [by, bm, bd] = birthday.split("-").map(Number);
  let ey: number, em: number, ed: number;
  if (deathday) {
    [ey, em, ed] = deathday.split("-").map(Number);
  } else {
    const now = new Date();
    ey = now.getFullYear();
    em = now.getMonth() + 1;
    ed = now.getDate();
  }
  let age = ey - by;
  if (em < bm || (em === bm && ed < bd)) age -= 1;
  return age;
};

// Classifying a credit needs its RUNTIME, and `movie_credits` does not carry one.
// /discover is the only endpoint that can filter on it: `with_runtime.gte=40` is the
// conventional feature threshold (the Academy's own cutoff). Anything absent from
// that set is a short. Documentaries come free from `genre_ids`.
//
// Capped at 3 pages — a director's feature list never approaches 60, and for a very
// prolific actor the tail is obscure enough that mis-filing it costs nothing.
const FEATURE_MIN_RUNTIME = 40;
const ALLOWLIST_PAGES = 3;
const DOCUMENTARY_GENRE = 99;

const featureFilmIds = async (personId: number, signal?: AbortSignal): Promise<Set<number>> => {
  const ids = new Set<number>();
  for (let page = 1; page <= ALLOWLIST_PAGES; page += 1) {
    const res = await getJson(
      `/discover/movie?with_people=${personId}&with_runtime.gte=${FEATURE_MIN_RUNTIME}` +
        `&sort_by=primary_release_date.desc&page=${page}`,
      signal
    );
    for (const m of res?.results ?? []) if (m?.id) ids.add(m.id);
    if (page >= (res?.total_pages ?? 1)) break;
  }
  return ids;
};

/**
 * A person and their filmography.
 *
 * The filmography is scoped to their PRIMARY department, which is why Nolan reads
 * `12 FILMS` and not the 100+ his full credit list would give — the board's own
 * number is the proof: he has directed exactly 12 features.
 */
export const fetchPerson = async (id: number, signal?: AbortSignal): Promise<EntityPage> => {
  const [person, credits, featureIds] = await Promise.all([
    getJson(`/person/${id}`, signal),
    getJson(`/person/${id}/movie_credits`, signal),
    featureFilmIds(id, signal),
  ]);

  const dept: string = person?.known_for_department ?? "Acting";
  const raw =
    dept === "Directing"
      ? (credits?.crew ?? []).filter((c: any) => c.job === "Director")
      : dept === "Acting"
        ? (credits?.cast ?? [])
        : (credits?.crew ?? []).filter((c: any) => c.department === dept);

  // One person can hold several crew jobs on one film, so dedupe by film id.
  const byId = new Map<number, any>();
  for (const r of raw) if (r?.id && !byId.has(r.id)) byId.set(r.id, r);

  const films = compact(
    Array.from(byId.values()).map((r) => {
      const film = toFilm(r);
      if (!film) return null;

      // AN UNRELEASED CREDIT CANNOT BE CLASSIFIED BY LENGTH, so do not try.
      //
      // TMDB has no runtime for a film that has not come out, and `with_runtime.gte`
      // does not match a null — so /discover silently omits every announced title,
      // the allowlist below never contains it, and the "absent means short" rule
      // filed it as a SHORT. That is how Shrek 5 (JUN 2027) and Dune Part Three
      // ended up under SHORTS on Zendaya's page.
      //
      // It stays a feature until there is a runtime to say otherwise. UPCOMING is
      // where it belongs either way, and the worst case — a genuinely short film
      // that has not been released — corrects itself the moment it comes out.
      if (!film.released) return film;

      const isShort = !featureIds.has(r.id);
      const isDoc = (r.genre_ids ?? []).includes(DOCUMENTARY_GENRE);
      // A short documentary files as a SHORT — length is the more useful split when
      // the point is "this is a minor work".
      const category: FilmCategory = isShort ? "short" : isDoc ? "documentary" : "feature";
      return { ...film, category };
    })
  ).sort(newestFirst);

  // The LABEL line carries the date and the VALUE line carries the age — Bryan's
  // layout edit (Paper node UF8-0). Putting the date up on the muted label line is
  // what stops the left column overflowing into the birthplace beside it.
  const vitals: { label: string; value: string }[] = [];
  if (person?.birthday) {
    const age = ageFrom(person.birthday, person.deathday ?? null);
    // A dead person is not "AGE 56".
    vitals.push(
      person.deathday
        ? { label: `DIED: ${fmtDate(person.deathday)}`, value: `AGED ${age}` }
        : { label: `BORN: ${fmtDate(person.birthday)}`, value: `AGE ${age}` }
    );
  }
  const place = shortPlace(person?.place_of_birth ?? null);
  if (place) vitals.push({ label: "BIRTHPLACE", value: place });

  return {
    kind: "person",
    id,
    role: dept === "Directing" ? "DIRECTOR" : dept.toUpperCase(),
    name: person?.name ?? "",
    imagePath: person?.profile_path ?? null,
    overview: person?.biography?.trim() || null,
    vitals,
    films,
    // The headline count is FEATURES only. Counting shorts here is what turned
    // Nolan's 12 into 19; they are still on the page, just in their own section.
    totalFilms: films.filter((f) => f.category === "feature").length,
    truncated: false,
  };
};

/** A collection. One request — /collection/{id} carries its parts inline. */
export const fetchCollection = async (id: number, signal?: AbortSignal): Promise<EntityPage> => {
  const c = await getJson(`/collection/${id}`, signal);
  const films = compact((c?.parts ?? []).map(toFilm)).sort(newestFirst);

  const years = films.map((f) => f.year).filter(Boolean) as string[];
  const vitals: { label: string; value: string }[] = [];
  if (years.length > 0) {
    const span = `${years[years.length - 1]} – ${years[0]}`;
    vitals.push({
      label: films.some((f) => !f.released) ? "ONGOING" : "COMPLETE",
      value: span,
    });
  }

  return {
    kind: "collection",
    id,
    role: "COLLECTION",
    name: c?.name ?? "",
    imagePath: c?.backdrop_path ?? null,
    overview: c?.overview?.trim() || null,
    vitals,
    films,
    totalFilms: films.length, // a collection carries all its parts inline
    truncated: false,
  };
};

// ── Warming an entity page before it is asked for ────────────────────────────
//
// A person page costs five requests and they do not start until the route mounts, so
// the page sits empty for as long as they take — name, biography, vitals and the whole
// filmography arriving in one late lump. No transition can cover that; the fetch has to
// begin earlier.
//
// `prefetchEntity` is called on PRESS-IN, before the finger even lifts. That is worth
// several hundred milliseconds, it costs nothing extra (the page then reuses this exact
// promise instead of issuing its own), and it only ever fires on a real touch — not on
// a marquee merely being open, which would spend five requests on every submitted
// search whether or not anyone opened the top result.
const inflight = new Map<string, Promise<EntityPage>>();
const key = (kind: EntityPage["kind"], id: number) => `${kind}:${id}`;

/** Long enough to cover a tap, short enough that a page never shows stale data. */
const WARM_MS = 60_000;

const startFetch = (kind: EntityPage["kind"], id: number): Promise<EntityPage> =>
  kind === "person"
    ? fetchPerson(id)
    : kind === "collection"
      ? fetchCollection(id)
      : fetchCompany(id);

export const prefetchEntity = (kind: EntityPage["kind"], id: number): void => {
  const k = key(kind, id);
  if (inflight.has(k)) return;
  const p = startFetch(kind, id);
  // Passive catch so a warmed request nobody ends up opening cannot surface as an
  // unhandled rejection. Consumers still see the real failure — this does not replace
  // the promise, it only observes it.
  p.catch(() => {});
  inflight.set(k, p);
  setTimeout(() => inflight.delete(k), WARM_MS);
};

/**
 * The page's own loader: hands back the warmed request when there is one.
 *
 * The AbortSignal is deliberately ignored on a warm hit — the request is shared, so one
 * screen backing out must not cancel it out from under another, and letting a warmed
 * request finish costs nothing.
 */
export const loadEntity = (
  kind: EntityPage["kind"],
  id: number,
  signal?: AbortSignal
): Promise<EntityPage> => {
  const warm = inflight.get(key(kind, id));
  if (warm) return warm;
  return kind === "person"
    ? fetchPerson(id, signal)
    : kind === "collection"
      ? fetchCollection(id, signal)
      : fetchCompany(id, signal);
};

/**
 * A studio.
 *
 * Two requests. NOTE the hero is deliberately null: studios never render TMDB
 * logos. Their polarity is unknowable — A24's is black-on-transparent with an
 * average opaque luminance of 14.7/255, invisible on our ground, and TMDB ships
 * white-on-transparent logos with no field distinguishing the two. The name set in
 * Bricolage IS the wordmark.
 */
export const fetchCompany = async (id: number, signal?: AbortSignal): Promise<EntityPage> => {
  const [company, page] = await Promise.all([
    getJson(`/company/${id}`, signal),
    // POPULARITY, not release date. Sorting a studio's catalogue by newest-first
    // fills page 1 with announced and unreleased titles, so the RELEASED section
    // came back nearly empty and UPCOMING held almost everything — a wildly
    // unrepresentative picture of a studio like A24.
    getJson(`/discover/movie?with_companies=${id}&sort_by=popularity.desc`, signal),
  ]);

  const films = compact((page?.results ?? []).map(toFilm)).sort(newestFirst);
  // /discover paginates at 20. Reporting films.length as the studio's film count
  // made the page contradict the search row the user had just tapped ("75 FILMS" →
  // "20 FILMS"). total_results is in the same response and is the honest number.
  const totalFilms = typeof page?.total_results === "number" ? page.total_results : films.length;

  const vitals: { label: string; value: string }[] = [];
  if (company?.headquarters) vitals.push({ label: "HQ", value: String(company.headquarters).toUpperCase() });
  if (company?.origin_country) vitals.push({ label: "COUNTRY", value: String(company.origin_country).toUpperCase() });

  return {
    kind: "company",
    id,
    role: "STUDIO",
    name: company?.name ?? "",
    imagePath: null, // see the note above — never a TMDB logo
    overview: company?.description?.trim() || null,
    vitals,
    films,
    totalFilms,
    truncated: totalFilms > films.length,
  };
};
