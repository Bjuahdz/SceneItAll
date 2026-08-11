// ─────────────────────────────────────────────────────────────────────────────
// Multi-entity search against TMDB.
//
// This is the REQUEST layer for the Search tab: it knows what to ask TMDB, how to
// cancel, and how to rank. It knows nothing about React or about how a row looks.
//
// Deliberately NOT built on services/useFetch.ts — that hook is mount-only, has no
// cancellation and no request identity, so a fast typist would race it and render a
// stale result set. Search owns its own request path for exactly that reason.
// ─────────────────────────────────────────────────────────────────────────────
import { TMDB_CONFIG } from "./api";
import type { RecentSearch, SearchEntityType } from "./db";
// The entity page's filter engine, reused rather than reimplemented — see THE
// RESULTS FILTER below. entities.ts imports nothing from here, so no cycle.
import { applyFilter, toFilm, type EntityFilm } from "./entities";
import {
  isMediaKind,
  SIZE_RANGE,
  type FilterState,
  type KindKey,
} from "@/hooks/useFilterState";

// THERE IS NO MINIMUM QUERY LENGTH. The old 4-character floor was built on real
// evidence — `multi?query=dun` contains no Dune and no Dunkirk (verified live
// 2026-07-29), because TMDB does not prefix-expand short queries — but it
// over-concluded: EXACT short titles come back fine, and the floor made X (2022),
// It, Up and A24 literally unsearchable (Bryan, 2026-08-01). Two things changed
// the math since the floor was set: rankForQuery's exact/prefix tier surfaces the
// real answer out of an otherwise junky short-query response, and the debounce
// means a 1–3 character query only spends requests when the user actually pauses
// on it. The floor survives in exactly one place — DYM_MIN_STEM — where its
// premise still holds.

// One row in the results ladder, whatever type it is. Camel-cased because this is a
// domain object; the snake_case `RecentSearch` is the SQL row it maps to on commit.
export interface SearchResult {
  entityType: SearchEntityType;
  id: number;
  title: string;
  /** Release / first-air year. Null for people, collections and studios. */
  year: string | null;
  /** `known_for_department` for a person. Films get their director only when a row
   *  is actually expanded — it is in no search response and costs a request each. */
  subtitle: string | null;
  /** Backdrop for film/tv/collection, profile for a person. Always null for a
   *  company: studios never render TMDB logos, the name set in Bricolage IS the
   *  wordmark (TMDB ships black- and white-on-transparent with no field to tell
   *  them apart, so there is no safe automatic fix). */
  imagePath: string | null;
  popularity: number;
  /** Person rows only — their notable titles, free in the same request. */
  knownFor?: string[];
  /** Collection/studio rows only — how many films it holds. NOT free: filled in by
   *  enrichSubmitted() once the user has actually submitted. Undefined means
   *  "not looked up", which renders as a bare type label rather than a fake zero. */
  filmCount?: number;
  /** Studio rows only, and ONLY when the film count came back zero — how many TV
   *  series TMDB attributes to it. A studio that makes television is a real studio
   *  (Bryan, 2026-08-10: TV "is something we are definitely going to integrate very
   *  deeply"), so this is what saves it from the shell prune. Undefined means the
   *  question was never asked, which is the case for every studio that HAS films. */
  showCount?: number;
  /** Company rows only — every TMDB id sharing this exact name, in the order TMDB
   *  returned them. /search/company hands back decoys, so the real one is resolved
   *  on submit rather than guessed at while typing. */
  candidateIds?: number[];
  /** Parallel to `candidateIds` — each candidate's origin_country. Kept so that when
   *  enrichment settles WHICH candidate is real, `basedIn` can be corrected to the
   *  winner's country. Without this the collapsed row keeps the FIRST candidate's —
   *  and for A24 the first candidate is a GB decoy, so the real US studio wore the
   *  wrong flag and fell out of any BASED IN · US filter. */
  candidateCountries?: (string | null)[];
  /** Company rows only — TMDB `origin_country`, a two-letter ISO code ("US", "GB").
   *  FREE: it is already on the /search/company row and was simply being dropped.
   *  Null when TMDB has none, which is common for small studios. */
  basedIn?: string | null;
  /* ── WHAT THE RESULTS FILTER NEEDS, AND WHAT IT COSTS: NOTHING. ─────────────
     `undefined` is what keeps a row out of a filtered list rather than a fake zero
     sneaking it through a rating floor.

     ⚠ THESE ARE NOT NEW REQUESTS, ON ANY KIND. Each field is read out of a
     response we already download:

       · FILM / SHOW — /search/multi returns genre_ids, vote_average, vote_count
         and release_date (first_air_date for tv) on every row.
       · PERSON — the same response nests `known_for`, each entry carrying its own
         genre_ids. A person's genres are the union across those entries: what
         they are known FOR, which is the only sense in which a person has one.
       · COLLECTION — /collection/{id}, already fetched by enrichSubmitted for the
         parts count, carries every part's genre_ids, release_date and rating.
       · STUDIO — /discover/movie?with_companies={id}, already fetched by
         enrichSubmitted for total_results, carries a page of that studio's films.

     So the filter still costs the THREE requests a search has always cost, plus
     the 2–3 enrichment requests a submit has always cost. If a control is ever
     added that these cannot answer, the honest move is to drop the control, not
     to spend a request per row. */
  genreIds?: number[];
  voteAverage?: number;
  voteCount?: number;
  /** Full ISO date, where `year` is only its first four characters. The decade
   *  control and the release sort both need the whole thing.
   *
   *  On a COLLECTION this is its newest part; on a STUDIO its newest RELEASED
   *  film. Both are "the last time this thing put something out", which is the
   *  only date either of them has that anyone would sort by. */
  releaseDate?: string | null;
}

const getJson = async (path: string, signal?: AbortSignal): Promise<any> => {
  const res = await fetch(`${TMDB_CONFIG.BASE_URL}${path}`, {
    method: "GET",
    headers: TMDB_CONFIG.headers,
    signal,
  });
  if (!res.ok) throw new Error(`TMDB request failed (${res.status})`);
  return res.json();
};

const year = (date: unknown): string | null =>
  typeof date === "string" && date.length >= 4 ? date.slice(0, 4) : null;

// /search/multi returns movies + TV + people in ONE request, each row carrying
// media_type. Rows with any other media_type are dropped rather than guessed at.
export const fromMultiRow = (row: any): SearchResult | null => {
  const popularity = typeof row.popularity === "number" ? row.popularity : 0;
  // The filterable facts, already paid for. Same defensive reads the entity
  // mapper uses (`toFilm`), for the same reason: TMDB omits fields rather than
  // nulling them, and a missing genre array must become [] and not undefined-
  // dot-something at the first filter.
  const genreIds: number[] = Array.isArray(row.genre_ids) ? row.genre_ids : [];
  const voteAverage: number = typeof row.vote_average === "number" ? row.vote_average : 0;
  const voteCount: number = typeof row.vote_count === "number" ? row.vote_count : 0;
  switch (row.media_type) {
    case "movie":
      return {
        entityType: "movie",
        id: row.id,
        title: row.title ?? row.original_title ?? "",
        year: year(row.release_date),
        subtitle: null,
        imagePath: row.backdrop_path ?? null,
        popularity,
        genreIds,
        voteAverage,
        voteCount,
        releaseDate: row.release_date || null,
      };
    case "tv":
      return {
        entityType: "tv",
        id: row.id,
        title: row.name ?? row.original_name ?? "",
        year: year(row.first_air_date),
        subtitle: null,
        imagePath: row.backdrop_path ?? null,
        popularity,
        genreIds,
        voteAverage,
        voteCount,
        // A show's "release" is when it FIRST AIRED. Mapped onto the same field
        // so one decade control and one date sort serve both — the alternative
        // is two fields that mean the same thing and a branch at every use.
        releaseDate: row.first_air_date || null,
      };
    case "person": {
      // ▸ A PERSON'S GENRES ARE THE UNION OF WHAT THEY ARE KNOWN FOR.
      //
      // `known_for` is already in this response — we were mapping it down to a
      // list of titles and dropping each entry's genre_ids. Nobody has a genre;
      // their WORK does, and "known for" is TMDB's own answer to which work
      // counts. Deduped, because three sci-fi credits is still one SCI-FI.
      const known: any[] = Array.isArray(row.known_for) ? row.known_for : [];
      const personGenres = Array.from(
        new Set(known.flatMap((k) => (Array.isArray(k?.genre_ids) ? k.genre_ids : [])))
      ) as number[];
      return {
        entityType: "person",
        id: row.id,
        title: row.name ?? "",
        year: null,
        subtitle: row.known_for_department ?? null,
        imagePath: row.profile_path ?? null,
        popularity,
        // Unchanged on purpose — still the titles, still `undefined` when TMDB
        // sent no array, because a row that renders "no notable work" is not the
        // same as one that renders an empty line.
        knownFor: Array.isArray(row.known_for)
          ? known.map((k: any) => k.title ?? k.name).filter(Boolean)
          : undefined,
        // Empty stays empty rather than becoming undefined: a person TMDB lists
        // no known work for genuinely matches no genre, and that is a different
        // fact from "we never looked".
        genreIds: personGenres,
      };
    }
    default:
      return null;
  }
};

const fromCollectionRow = (row: any): SearchResult => ({
  entityType: "collection",
  id: row.id,
  title: row.name ?? "",
  year: null,
  subtitle: null,
  imagePath: row.backdrop_path ?? null,
  // Collections carry no popularity field at all. Zero here is honest — it means
  // "unranked", and rankResults() keeps them in TMDB's own order rather than
  // pretending we scored them.
  popularity: 0,
});

export const fromCompanyRow = (row: any): SearchResult => ({
  entityType: "company",
  id: row.id,
  title: row.name ?? "",
  year: null,
  subtitle: null,
  imagePath: null, // see SearchResult.imagePath — never a TMDB logo
  popularity: 0,
  // FREE — already on this row. TMDB sends "" rather than omitting it when it has
  // no country, and an empty string would sort and group as its own bogus value,
  // so it is normalised to null here once instead of at every read.
  basedIn: typeof row.origin_country === "string" && row.origin_country ? row.origin_country : null,
});

// /search/company returns same-named DECOYS — "a24" yields id 293354 (zero films)
// AHEAD of the real A24 (41077, 75 films), and logo_path does not distinguish them
// because the decoy has one too.
//
// So collapse them into ONE row by name — the user sees "A24" once, and the NAME is
// what they are choosing — but KEEP every candidate id on that row. Picking the
// first id here would pick the decoy for the single most famous studio. Which id
// actually holds the films is settled on submit, where one /discover per candidate
// is affordable; per keystroke it would cost N requests for a row nobody may tap.
export const collapseSameNamedCompanies = (rows: SearchResult[]): SearchResult[] => {
  const byName = new Map<string, SearchResult>();
  for (const r of rows) {
    const key = r.title.trim().toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.candidateIds!.push(r.id);
      existing.candidateCountries!.push(r.basedIn ?? null);
    } else {
      byName.set(key, {
        ...r,
        candidateIds: [r.id],
        candidateCountries: [r.basedIn ?? null],
      });
    }
  }
  return Array.from(byName.values());
};

/**
 * Raw popularity, stable — the ranker for lists with NO meaningful query.
 *
 * DID YOU MEAN is the caller that needs this: its pool holds rows matched against
 * several MUTATED spellings, so tiering them by the original typo would file
 * everything under "loose" and add nothing. Typeahead ranks with rankForQuery.
 *
 * Sort is STABLE, so the unranked types (collections, companies at popularity 0)
 * hold TMDB's own order at the tail instead of being shuffled arbitrarily.
 */
export const rankResults = (rows: SearchResult[]): SearchResult[] =>
  rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.popularity - a.row.popularity || a.i - b.i)
    .map(({ row }) => row);

/**
 * Case- and accent-insensitive comparison form — "Beyoncé" folds to "beyonce".
 *
 * EXPORTED because it is the one definition of "matches": the ranker tiers with it
 * and ResultRow highlights with it. They diverged once — the highlighter compared
 * raw lowercase, so typing the final plain "e" of "beyonce" un-lit every Beyoncé
 * row while the search itself kept matching (device, 2026-08-01).
 */
export const foldForMatch = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// The match tiers, in rank order. Numeric so the sort can subtract them.
const TIER_PREFIX = 0; // starts with the query: "tom h" → "Tom Holland"
const TIER_WORD = 1; // a word inside a TITLE does: "tom h" → "…with Tom Hiddleston"
const TIER_LOOSE = 2; // TMDB's fuzz — the query never literally appears

// Leading articles are invisible to the prefix test. "The SpongeBob Movie: …" is
// what a user typing "sponge" means, and on device (2026-08-01) the article alone
// was demoting every big SpongeBob film below literal "Sponge…" junk. A linguistic
// fact, not a tuning: nobody starts typing a title at its article.
const stripArticle = (t: string): string => t.replace(/^(the|a|an)\s+/, "");

/**
 * WHERE the query matches, on the folded strings so case and accents are invisible
 * to it. The boundary test is ASCII on purpose: folding has already reduced
 * accented Latin to ASCII, and for unspaced scripts (CJK) treating every position
 * as a boundary errs toward the friendlier tier.
 *
 * PERSONS HAVE NO WORD TIER. A person's title IS their name, and people are
 * legitimately searched by ANY of their names — "villen" is how you find Denis
 * Villeneuve, and nobody types "Denis" to get there. So a match at the start of
 * any name-word counts as the full prefix tier. On device (2026-08-01) the
 * string-prefix-only rule ranked two obscure directors literally NAMED "Villen"
 * above Villeneuve, which is exactly backwards.
 */
const matchTier = (entityType: SearchEntityType, title: string, q: string): number => {
  const t = foldForMatch(title);
  if (t.startsWith(q)) return TIER_PREFIX;
  if (entityType !== "person" && stripArticle(t).startsWith(q)) return TIER_PREFIX;
  // indexOf can no longer return 0 here, so t[idx - 1] always exists.
  for (let idx = t.indexOf(q); idx !== -1; idx = t.indexOf(q, idx + 1)) {
    if (!/[a-z0-9]/.test(t[idx - 1])) {
      return entityType === "person" ? TIER_PREFIX : TIER_WORD;
    }
  }
  return TIER_LOOSE;
};

/**
 * The normalization scale a row's popularity is measured on. Persons keep their
 * own — TMDB scores people in a different currency from titles, which is the
 * mismatch the normalization exists to fix. But movies and shows are the SAME
 * currency, and splitting them re-created the bug one type over: for "sponge" an
 * obscure show titled exactly "Sponge" scored 1.0 purely for being the best of a
 * junk TV field, and outranked SpongeBob films fifty times as popular. One shared
 * title scale deflates a junk field's champion to what it actually is.
 * (Collections and companies carry popularity 0 and ride the title scale inertly.)
 */
const popScale = (t: SearchEntityType): "person" | "title" =>
  t === "person" ? "person" : "title";

/**
 * The typeahead ranking: MATCH QUALITY decides the tier, popularity only ranks
 * within a tier — the standard shape for suggest ranking. Both halves exist because
 * raw popularity alone failed two specific ways on device (2026-07-31):
 *
 *   · "Tom H" ranked an airing show that merely CONTAINS "Tom Hiddleston" above Tom
 *     Holland, who IS what was typed so far. Match position was not a signal at
 *     all. Now: prefix > word-boundary > loose.
 *   · "Chris" ranked three talk shows above Chris Evans — the person/title scale
 *     mismatch. Within a tier every row is scored on its scale (see popScale), so
 *     the top person and the top title meet as equals at 1.0.
 *
 * What this deliberately does NOT do is crown exact matches: an obscure show
 * titled exactly "Sponge" is a prefix match the same as "SpongeBob…" is, and loses
 * to it on popularity inside the tier — the fuzzy-feeling behaviour worth keeping.
 * Raw popularity is the tie-break (the scales' 1.0s meet at every tier top), and
 * the stable index keeps zero-popularity types in TMDB's own order at each tier's
 * tail.
 *
 * KNOWN LIMIT, accepted for now: when a query's entire PERSON field is junk (for
 * "sponge", the best person TMDB has is an obscure "Sponge Man"), that field's
 * champion still normalizes to 1.0 and can sit a slot or two high. The derivable
 * cure — anchoring a person's credibility to the popularity of their known_for
 * credits, which the same response already carries — is queued as its own
 * increment if device testing says the junk actually intrudes.
 */
export const rankForQuery = (rows: SearchResult[], query: string): SearchResult[] => {
  const q = foldForMatch(query.trim());
  if (!q) return rankResults(rows);

  const maxByScale = new Map<string, number>();
  for (const r of rows) {
    const scale = popScale(r.entityType);
    maxByScale.set(scale, Math.max(maxByScale.get(scale) ?? 0, r.popularity));
  }

  return rows
    .map((row, i) => {
      const max = maxByScale.get(popScale(row.entityType)) ?? 0;
      return {
        row,
        i,
        tier: matchTier(row.entityType, row.title, q),
        // LOG-scaled, because popularity is heavy-tailed and a linear ratio let
        // ONE inflated airing show flatten every other title on its scale:
        // "jennifer" put the Jennifer Hudson Show at 1.0 and squeezed Jennifer's
        // Body to ~0.1, sinking it to #11 under every actress (device,
        // 2026-08-01). On a log scale the same inflation compresses — the film
        // scores ~0.7 and lands back among the names. A standard transform for a
        // heavy-tailed quantity, not a tuned constant.
        score: max > 0 ? Math.log1p(row.popularity) / Math.log1p(max) : 0,
      };
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.score - a.score ||
        b.row.popularity - a.row.popularity ||
        a.i - b.i
    )
    .map(({ row }) => row);
};

export interface SearchResponse {
  results: SearchResult[];
  /** TMDB's own total across all three endpoints — the board's "1265 FOUND".
   *  This is the size of the haystack, not of the page we render. */
  total: number;
}

/* ────────────────────────────────────────────────────────────────────────────
   ▸ THE RESULTS FILTER (Bryan, V3 increment 3).

   ONE PREDICATE SERVES BOTH SURFACES. The entity page's filter already lives in
   entities.ts as pure functions, and the reason given there — "two callers must
   agree to the film, or the count is a lie nobody can see is a lie" — applies
   twice as hard now that a third caller exists. So nothing is reimplemented
   here: a film or show row is presented AS an EntityFilm and handed to the same
   `matchesFilter` / `applyFilter` the sheet counts with.

   ▸ DATES GO THROUGH `toFilm`, not through a second copy of the date handling.
   That function owns some genuinely subtle rules — an undated title is
   RELEASED rather than upcoming, and the month is read off the string because
   `new Date("2026-01-01").getMonth()` reports December in any UTC-negative
   timezone — and none of that is worth having twice.
   ──────────────────────────────────────────────────────────────────────────── */

/** A film or show result seen as an EntityFilm, still carrying the row it came
 *  from so the filtered output can be handed back as results rather than films. */
export type ResultFilm = EntityFilm & { row: SearchResult };

/**
 * The film and show rows, as filterable films. Everything else — people,
 * collections, studios — is absent by construction: none of them has a genre, a
 * rating or a release date, so none of them can answer a single control in that
 * sheet.
 *
 * Also what the sheet derives its DECADE row and GENRE tiles from, so both stay
 * adaptive to the actual result set exactly as they are to a filmography.
 */
export const resultFilms = (rows: SearchResult[]): ResultFilm[] => {
  const films: ResultFilm[] = [];
  for (const r of rows) {
    if (r.entityType !== "movie" && r.entityType !== "tv") continue;
    const f = toFilm({
      id: r.id,
      title: r.title,
      release_date: r.releaseDate ?? null,
      genre_ids: r.genreIds ?? [],
      vote_average: r.voteAverage ?? 0,
      vote_count: r.voteCount ?? 0,
    });
    if (f) films.push({ ...f, isShow: r.entityType === "tv", row: r });
  }
  return films;
};

/** Which result row answers to each non-ANY kind. */
const KIND_OF: Partial<Record<KindKey, SearchEntityType>> = {
  film: "movie",
  shows: "tv",
  person: "person",
  studio: "company",
  collection: "collection",
};

/**
 * ▸ IS ANYTHING BEING ASKED THAT ONLY A FILM CAN ANSWER?
 *
 * Status, decade, rating and genre obviously qualify. ⚠ SO DOES THE SORT, and
 * that is the non-obvious one: RELEASE DATE and AVG RATING are fields a person
 * or a studio simply does not have, so ordering a mixed list by either would be
 * ordering most of it by nothing. Counting sort here is what makes the whole
 * pipeline safe — whenever non-film rows are present the list is in its natural
 * ranking, so there is never a question of where to put a row with no date.
 *
 * KIND is deliberately absent: it is the KIND GATE, not a film question, and
 * it has already had its say by the time this is asked.
 */
const filmQuestionAsked = (s: FilterState): boolean =>
  s.sort !== "relevance" ||
  s.status !== "any" ||
  s.decade !== null ||
  s.minRating > 0 ||
  s.genres.length > 0;

/**
 * ⚠ THE NON-FILM CONTROLS ARE DELIBERATELY ABSENT FROM `filmQuestionAsked`.
 *
 * KNOWN FOR, BASED IN and SIZE only ever appear on a sheet whose kind is not a media
 * kind, so `filterResults` has already branched away before this predicate is
 * consulted. Listing them here would be dead code that reads as a rule.
 */

/**
 * The rows this filter admits, in the order it wants them.
 *
 * Three passes, and each one is allowed to be the last:
 *
 *  ① THE KIND GATE. FILMS / SHOWS / PEOPLE / STUDIOS / COLLECTIONS each keep one
 *    entity type; ANY keeps everything.
 *  ② ASKED FOR PEOPLE, STUDIOS OR COLLECTIONS? Then no film question can apply to
 *    what is left, and the sort is RELEVANCE by construction (see cycleKind),
 *    so the ranking stands as it is.
 *  ③ OTHERWISE, if nothing is being asked of the films either, the gate's output
 *    IS the answer — untouched ranking, people and studios still in place.
 *    Only when a film question is genuinely on the table do the rows become
 *    films, get filtered and sorted, and the non-films fall away (Bryan's
 *    ruling: they cannot answer, so they are not in the answer).
 */
/**
 * ① THE KIND GATE, on its own. Exported because the sheet needs the SAME slice the
 * filter will run on in order to build its option lists — offering a genre that no
 * visible row carries is the same lie as offering a decade nothing was made in.
 */
export const gateByKind = (rows: SearchResult[], kind: KindKey): SearchResult[] => {
  const entityType = KIND_OF[kind];
  return entityType ? rows.filter((r) => r.entityType === entityType) : rows;
};

/**
 * The genres actually present in these rows — the Chris Pratt rule, applied to a
 * result set instead of a filmography: a search for comedians has no business
 * offering WESTERN. Works on any kind, because increment 01 gave people, studios and
 * collections a `genreIds` of their own.
 */
export const genresIn = (rows: SearchResult[]): number[] =>
  Array.from(new Set(rows.flatMap((r) => r.genreIds ?? [])));

/** The countries these rows are based in — studios only, and only the ones actually
 *  present. Same rule as the genres: never a fixed list of 195. */
export const countriesIn = (rows: SearchResult[]): string[] =>
  Array.from(new Set(rows.map((r) => r.basedIn).filter((c): c is string => !!c))).sort();

/** The decades present in these rows, newest first — same shape as `decadesIn` for a
 *  filmography, reading the date increment 01 derived for each kind. */
export const decadesInRows = (rows: SearchResult[]): number[] => {
  const seen = new Set<number>();
  for (const r of rows) {
    const y = r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : NaN;
    if (Number.isFinite(y)) seen.add(Math.floor(y / 10) * 10);
  }
  return [...seen].sort((a, b) => b - a);
};

export const filterResults = (rows: SearchResult[], s: FilterState): SearchResult[] => {
  const gated = gateByKind(rows, s.kind);
  // ▸ FILMS and SHOWS go down the film pipeline — one kind of row, and `applyFilter`
  // is the same predicate the entity pages use, so the two surfaces cannot disagree.
  if (s.kind === "film" || s.kind === "shows") {
    if (!filmQuestionAsked(s)) return gated;
    return applyFilter(resultFilms(gated), s).map((f) => f.row);
  }
  // ▸ ④ EVERY OTHER KIND ANSWERS ON THE ROW ITSELF (2026-08-07/08).
  //
  // PEOPLE, STUDIOS and COLLECTIONS used to return the gate's output untouched,
  // because a person or a studio carried nothing to filter by. Increment 01 stopped
  // throwing those fields away, so they answer now — for free, out of responses we
  // already had.
  //
  // ⚠ AND SO DOES **ALL**, which is the fix for a real bug: ALL was running the film
  // pipeline, so picking a genre dropped every person, studio and collection from a
  // mixed list. Bryan searched JENNA, picked HORROR, and 1,213 people became one
  // film. The ALL board has always said the opposite — "SCI-FI keeps sci-fi films and
  // shows, people known for sci-fi, studios that make it and collections that contain
  // it. Nothing is silently dropped." A row that CANNOT answer a question that is
  // being asked still falls out (a person has no rating, so a rating floor excludes
  // them); a row that can, stays.
  return sortRows(gated.filter((r) => matchesRow(r, s)), s);
};

/** Does this non-film row survive the filter? Each clause is skipped when its control
 *  is at ANY, so an untouched sheet keeps everything without a special case. */
export const matchesRow = (r: SearchResult, s: FilterState): boolean => {
  // STATUS is a question only a dated thing can answer. On ALL that means films,
  // shows and the two kinds increment 01 gave a date to; a person has none, so
  // asking it excludes them — which is the honest answer, not a silent pass.
  if (s.status !== "any") {
    if (!r.releaseDate) return false;
    // Same rule as toFilm: compare the ISO strings, never through a Date.
    const released = r.releaseDate <= new Date().toISOString().slice(0, 10);
    if (s.status === "released" && !released) return false;
    if (s.status === "upcoming" && released) return false;
  }
  // GENRE — on people it is what they are KNOWN FOR; on studios and collections it
  // is what they MAKE. Multi-select is OR: pick SCI-FI and DRAMA and you want either.
  if (s.genres.length > 0) {
    const ids = r.genreIds ?? [];
    if (!s.genres.some((g) => ids.includes(g))) return false;
  }
  // KNOWN FOR — CREW is everything outside the three named departments, so it is
  // written as "not one of those" rather than as a list nobody can keep current.
  if (s.knownFor !== "any") {
    const dept = (r.subtitle ?? "").toLowerCase();
    const named = dept === "acting" || dept === "directing" || dept === "writing";
    if (s.knownFor === "crew" ? named : dept !== s.knownFor) return false;
  }
  if (s.basedIn !== null && r.basedIn !== s.basedIn) return false;
  if (s.sizeBand !== null) {
    // ⚠ A row we never enriched has NO count, and "unknown" is not "zero" — it must
    // fall out of a size filter rather than be scored as the smallest thing there is.
    if (r.filmCount === undefined) return false;
    const { min, max } = SIZE_RANGE[s.sizeBand];
    if (r.filmCount < min || r.filmCount > max) return false;
  }
  // DECADE and MINIMUM RATING reach studios and collections through the date and
  // rating increment 01 derived for them; a person has neither, so both are absent
  // from that sheet and these clauses never fire there.
  if (s.decade !== null) {
    const y = r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : NaN;
    if (!Number.isFinite(y) || Math.floor(y / 10) * 10 !== s.decade) return false;
  }
  // The unrated trap again: voteCount 0 means nobody has rated it, which is not a
  // 0.0 — it is no rating at all, and a floor must exclude it rather than compare.
  if (s.minRating > 0) {
    if (!r.voteCount || (r.voteAverage ?? 0) < s.minRating) return false;
  }
  return true;
};

/** Non-film rows, in the order the sort asks for. RELEVANCE is the incoming ranking,
 *  so it is the absence of a sort — `slice` keeps the reverse from mutating. */
export const sortRows = (rows: SearchResult[], s: FilterState): SearchResult[] => {
  if (s.sort === "relevance") return s.desc ? rows : rows.slice().reverse();
  const dir = s.desc ? 1 : -1;
  const out = rows.slice();
  if (s.sort === "alpha") {
    // localeCompare so accents file where a reader expects them; DESC is A→Z here
    // because A→Z is what anyone means by "alphabetical" before they mean anything.
    return out.sort((a, b) => a.title.localeCompare(b.title) * (s.desc ? 1 : -1));
  }
  if (s.sort === "size") {
    // A row with no count sinks, whichever way the sort points — see matchesRow.
    return out.sort((a, b) => {
      const ca = a.filmCount;
      const cb = b.filmCount;
      if (ca === undefined && cb === undefined) return 0;
      if (ca === undefined) return 1;
      if (cb === undefined) return -1;
      return (cb - ca) * dir;
    });
  }
  if (s.sort === "rating") {
    return out.sort((a, b) => {
      const ra = a.voteCount ? (a.voteAverage ?? 0) : null;
      const rb = b.voteCount ? (b.voteAverage ?? 0) : null;
      if (ra === null && rb === null) return 0;
      if (ra === null) return 1;
      if (rb === null) return -1;
      return (rb - ra) * dir;
    });
  }
  // RELEASE — a studio's newest released film, a collection's newest part.
  return out.sort((a, b) => {
    const da = a.releaseDate || null;
    const db = b.releaseDate || null;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da) * dir; // ISO dates compare as strings
  });
};

/**
 * One search across every entity type the tab supports.
 *
 * Cost: exactly THREE requests, issued in parallel — /search/multi covers films,
 * shows and people together, then one each for collections and studios. Rejects with
 * an AbortError if `signal` fires; callers treat that as "superseded", not "failed".
 */
export const searchEntities = async (
  query: string,
  signal?: AbortSignal
): Promise<SearchResponse> => {
  const q = encodeURIComponent(query);
  const [multi, collections, companies] = await Promise.all([
    getJson(`/search/multi?query=${q}`, signal),
    getJson(`/search/collection?query=${q}`, signal),
    getJson(`/search/company?query=${q}`, signal),
  ]);

  const rows: SearchResult[] = [
    ...(multi?.results ?? []).map(fromMultiRow).filter(Boolean),
    ...(collections?.results ?? []).map(fromCollectionRow),
    ...collapseSameNamedCompanies((companies?.results ?? []).map(fromCompanyRow)),
  ].filter((r: SearchResult) => r.title.length > 0);

  const total =
    (multi?.total_results ?? 0) +
    (collections?.total_results ?? 0) +
    (companies?.total_results ?? 0);

  return { results: rankForQuery(rows, query), total };
};

// How many collection/studio rows we will spend a request on after a submit. A real
// query yields two or three of them, so this is a backstop against a pathological
// one, not a routine truncation — but it IS a cap, so it is named and logged rather
// than silently applied.
const ENRICH_LIMIT = 8;

/**
 * ▸ THE ON-TAB ALLOWANCE — when the user is STANDING on STUDIOS or COLLECTIONS,
 * the whole visible list gets priced, and this is only the runaway backstop.
 *
 * Round two of the WARNER bug (Bryan's screenshot, 2026-08-10 19:46): round one
 * aimed the budget at the kind on screen but kept ENRICH_LIMIT — WARNER has ~18
 * studio rows, the first 8 in TMDB's arbitrary pre-order got priced, and Warner
 * Bros. Pictures sat at row 9: unpriced, unranked, bare label. The tail contained
 * the answer, so the tail has to go. A search page yields at most ~20 name-rows,
 * so this cap exists for pathology, not routine — when it DOES truncate, it logs.
 */
const ON_TAB_LIMIT = 24;

/**
 * ▸ THE PRICE BOOK — a catalogue, once bought, is remembered for the app session.
 *
 * Companies keyed by collapsed name + candidate set (the same identity the row
 * itself has — see collapseSameNamedCompanies); collections by id. His own test
 * sequence is the proof of value: WARN priced Warner Bros. Pictures at 3,022
 * films, then WARNER — a different query, same studio — had to buy it again and
 * could not afford to. With the book, the second query reuses the first query's
 * receipts and costs only the names it has never seen. Strictly fewer requests,
 * never more. Session-scoped module state, same practice as quickTrending's cache;
 * catalogue sizes move on the scale of months, an app session is hours.
 */
type EnrichPatch = Partial<SearchResult>;
const companyPriceBook = new Map<string, EnrichPatch>();
const collectionPriceBook = new Map<number, EnrichPatch>();
const companyPriceKey = (r: SearchResult): string =>
  `${r.title.trim().toLowerCase()}|${(r.candidateIds ?? [r.id]).join(",")}`;

/** Today, as TMDB wants it (YYYY-MM-DD). Sliced off the ISO string rather than
 *  built from local getters — `new Date().getMonth()` is a day out either side of
 *  midnight in a UTC-offset zone, and this bounds a query, not a display. */
const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** Union of the genre ids across a page of films, deduped and order-stable. */
export const unionGenreIds = (films: any[]): number[] =>
  Array.from(new Set(films.flatMap((f) => (Array.isArray(f?.genre_ids) ? f.genre_ids : []))));

/** The newest release date in a list, or null if none of them carry one. */
export const newestDate = (films: any[]): string | null => {
  let newest: string | null = null;
  for (const f of films) {
    const d = typeof f?.release_date === "string" && f.release_date ? f.release_date : null;
    if (d && (newest === null || d > newest)) newest = d; // ISO dates compare as strings
  }
  return newest;
};

/**
 * Everything a COLLECTION row can be filtered and sorted by, read off the parts we
 * already downloaded for the count. Pure, and exported, because the averaging below
 * is the one piece of arithmetic in this increment that can be wrong quietly.
 */
export const collectionFacts = (
  parts: any[]
): Pick<SearchResult, "filmCount" | "genreIds" | "releaseDate" | "voteAverage" | "voteCount"> => {
  // ⚠ THE UNRATED TRAP, the same one entities.ts warns about. A part nobody has
  // rated reports vote_average 0, and averaging that in would drag a collection
  // under any rating floor purely because one of its films has not come out yet.
  // Only rated parts count toward the average.
  const rated = parts.filter((p) => (p?.vote_count ?? 0) > 0);
  return {
    filmCount: parts.length,
    genreIds: unionGenreIds(parts),
    releaseDate: newestDate(parts),
    voteAverage:
      rated.length > 0
        ? rated.reduce((sum, p) => sum + (p?.vote_average ?? 0), 0) / rated.length
        : 0,
    // The number of PARTS carrying a rating, not the sum of their votes — this
    // field answers "is there a rating here at all", and summing would claim a
    // confidence the average does not have.
    voteCount: rated.length,
  };
};

/**
 * Everything a STUDIO row can be filtered and sorted by, read off the discover page
 * we already downloaded for the count.
 *
 * `films` is ONE page of the studio's most recent work — enough to say what it makes,
 * and all we will ever see of a 400-film catalogue without paying for pages nobody
 * asked for. `films[0]` is its newest release because the query is sorted and bounded.
 */
export const studioFacts = (
  films: any[],
  totalResults: number
): Pick<SearchResult, "filmCount" | "genreIds" | "releaseDate"> => ({
  filmCount: totalResults,
  genreIds: unionGenreIds(films),
  releaseDate: (typeof films[0]?.release_date === "string" && films[0].release_date) || null,
});

/**
 * Fill in the film counts the boards ask for (`COLLECTION · 3 FILMS`), settle which
 * of several same-named studios is the real one, AND keep the filterable facts that
 * are already sitting in those two responses.
 *
 * ⚠ NO NEW REQUESTS. This is the same one-request-per-row it has always been; the
 * difference is that the bodies are now read for everything they hold instead of one
 * integer each. A collection's parts carry genres, dates and ratings; a studio's
 * discover page carries a page of its films. Both were being parsed and discarded.
 *
 * Paid ONLY on submit. While typing this would cost one request per collection and
 * studio row on every keystroke — the same trade already settled for a film's
 * director, which is fetched for the row that is expanded and never across a list.
 *
 * For a company the jobs are still one request: /discover?with_companies={id}
 * returns total_results, which is simultaneously the film count AND the decoy test —
 * a candidate with zero films is not the studio the user meant.
 *
 * ⚠ THE STUDIO COUNT NOW MEANS "FILMS RELEASED" (Bryan, 2026-08-07). Adding
 * `primary_release_date.lte=today` is what makes `results[0]` the newest film anyone
 * has actually seen rather than something dated three years out — but the same bound
 * narrows total_results, so `STUDIO · 412 FILMS` excludes the unreleased. That is the
 * more honest number and it was his call. One consequence to know: a studio whose
 * every film is still unreleased now scores zero and reads as a decoy, so it falls
 * through to a bare label. Degraded, not wrong, and vanishingly rare.
 *
 * Returns a NEW array; rows that could not be resolved come back untouched, so a
 * failure here degrades to a bare type label rather than a wrong number.
 */
export const enrichSubmitted = async (
  results: SearchResult[],
  kind: KindKey,
  signal?: AbortSignal
): Promise<SearchResult[]> => {
  // ▸ THE BUDGET IS AIMED AT THE KIND ON SCREEN (Bryan, 2026-08-10). It used to
  // take the first ENRICH_LIMIT collection-and-studio rows in GLOBAL rank order,
  // which spent requests two ways he objected to: on collections while you were
  // looking at FILMS and might never open that tab, and — worse — it let one kind
  // eat the other's budget. Searching WARNER, the collections above them consumed
  // it before Warner Bros. Pictures at row 5 was reached, so the studio with 3,022
  // films was the one row that never got a number. Priced per kind, its whole
  // allowance is available to the list you are actually reading.
  const want = KIND_OF[kind];
  const priceable: SearchEntityType[] =
    want === "collection" || want === "company"
      ? [want]
      : // "any" has no kind row to stand on (entity pages only) — price both.
        kind === "any"
        ? ["collection", "company"]
        : [];
  // FILMS, SHOWS and PEOPLE carry everything they need in the search response.
  // Standing on one of them costs nothing at all.
  if (priceable.length === 0) return results;

  const rows = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => priceable.includes(r.entityType));
  if (rows.length === 0) return results;

  // Receipts first — a name already in the price book costs nothing to know.
  const fromBook = rows
    .map(({ r, i }) => {
      const held =
        r.entityType === "collection"
          ? collectionPriceBook.get(r.id)
          : companyPriceBook.get(companyPriceKey(r));
      return held ? { i, patch: held } : null;
    })
    .filter((x): x is { i: number; patch: EnrichPatch } => x !== null);
  const bought = new Set(fromBook.map(({ i }) => i));

  // Then the spend, capped by where the user is standing: ON the kind's own tab
  // the whole list is owed its numbers (ON_TAB_LIMIT is a runaway backstop); the
  // "any" path keeps the old conservative slice. The cap counts MISSES only —
  // receipts are free and must never crowd out a fetch.
  const cap = priceable.length === 1 ? ON_TAB_LIMIT : ENRICH_LIMIT;
  const misses = rows.filter(({ i }) => !bought.has(i));
  const targets = misses.slice(0, cap);
  if (misses.length > targets.length) {
    // No silent caps: name what was dropped, so a pathological list is a log line
    // and not a mystery ranking.
    console.log(
      `enrichSubmitted: capped at ${cap}, ${misses.length - targets.length} row(s) left unpriced`
    );
  }

  if (targets.length === 0 && fromBook.length === 0) return results;

  const resolved = await Promise.all(
    targets.map(async ({ r, i }) => {
      try {
        if (r.entityType === "collection") {
          const detail = await getJson(`/collection/${r.id}`, signal);
          if (!Array.isArray(detail?.parts)) return { i, patch: null };
          const patch = collectionFacts(detail.parts);
          collectionPriceBook.set(r.id, patch);
          return { i, patch };
        }
        // Company: ask EVERY same-named candidate and keep the one with the MOST
        // films. This used to stop at the first candidate with ANY films — built
        // when the A24 decoy had zero. Then TMDB attributed one comedy special to
        // the decoy (id 293354, GB, 1 film) and "A24" resolved to it instead of the
        // real studio (41077, US, 111 films) — verified live 2026-08-08. A decoy
        // can pick up a stray credit; it cannot pick up the catalogue.
        //
        // Same worst case as before: same-named candidates run two or three, and
        // the old walk already paid one request each when the early ones were
        // empty. Sorted newest-first and bounded to today, so results[0] IS the
        // studio's latest release.
        const today = todayISO();
        const ids = r.candidateIds ?? [r.id];
        let best: { id: number; count: number; films: any[]; at: number } | null = null;
        for (let c = 0; c < ids.length; c++) {
          const page = await getJson(
            `/discover/movie?with_companies=${ids[c]}` +
              `&sort_by=primary_release_date.desc&primary_release_date.lte=${today}`,
            signal
          );
          const count = page?.total_results ?? 0;
          if (count > 0 && (best === null || count > best.count)) {
            best = {
              id: ids[c],
              count,
              films: Array.isArray(page?.results) ? page.results : [],
              at: c,
            };
          }
        }
        if (best === null) {
          // ▸ NO FILMS IS NOT YET NO CATALOGUE — ASK TELEVISION BEFORE DELETING.
          //
          // The count above comes from /discover/MOVIE, so a studio that makes
          // only series scores zero and used to be pruned as a shell. Bryan,
          // 2026-08-10: TV-only studios stay, because the show side of the app is
          // built and waiting. So a zero-film studio gets one more question.
          //
          // ⚠ THE COST IS PAID ONLY WHERE IT DECIDES SOMETHING. This runs for the
          // rows we were about to DELETE and for no others — a studio with films
          // never reaches here. Deleting a real studio to save one request is the
          // wrong trade; spending one to avoid that is the right one.
          let shows: { id: number; count: number; at: number } | null = null;
          for (let c = 0; c < ids.length; c++) {
            const page = await getJson(`/discover/tv?with_companies=${ids[c]}`, signal);
            const count = page?.total_results ?? 0;
            if (count > 0 && (shows === null || count > shows.count)) {
              shows = { id: ids[c], count, at: c };
            }
          }
          // filmCount 0 still marks "no films" for the row's label and the sort;
          // showCount is what tells the prune this is a television studio, not a
          // shell. Both zero = nothing to show anyone, and the prune takes it —
          // and the shell verdict is a receipt too: a name priced at nothing must
          // not be re-priced every time it turns up in a result set.
          if (shows === null) {
            const patch = { filmCount: 0 };
            companyPriceBook.set(companyPriceKey(r), patch);
            return { i, patch };
          }
          const tvPatch = {
            id: shows.id,
            basedIn: r.candidateCountries?.[shows.at] ?? r.basedIn ?? null,
            filmCount: 0,
            showCount: shows.count,
          };
          companyPriceBook.set(companyPriceKey(r), tvPatch);
          return { i, patch: tvPatch };
        }
        const patch = {
          id: best.id,
          // The WINNER'S country, not the first candidate's — see candidateCountries.
          basedIn: r.candidateCountries?.[best.at] ?? r.basedIn ?? null,
          ...studioFacts(best.films, best.count),
        };
        companyPriceBook.set(companyPriceKey(r), patch);
        return { i, patch };
      } catch (e) {
        if (isAbort(e)) throw e; // a cancellation must propagate, not be swallowed
        return { i, patch: null };
      }
    })
  );

  const out = results.slice();
  // Receipts land first, live fetches second — if a fetch somehow re-priced a name
  // the book already held, the fresher number wins the row.
  for (const { i, patch } of fromBook) out[i] = { ...out[i], ...patch };
  for (const { i, patch } of resolved) if (patch) out[i] = { ...out[i], ...patch };
  // ▸ THE PRUNE. A studio with neither films nor series is a shell — a name with no
  // catalogue behind it (WARNER RECORDS is a record label) — and shells were
  // crowding real studios off the list. Only rows enrichment POSITIVELY scored
  // empty are dropped: a row that errored, or sat past ENRICH_LIMIT, keeps its
  // undefined count and STAYS, because "we did not ask" must degrade to a bare
  // label and never to a disappearance. That distinction is the whole reason this
  // cannot simply drop rows with no number on them.
  return out.filter(
    (r) => !(r.entityType === "company" && r.filmCount === 0 && !(r.showCount && r.showCount > 0))
  );
};

/**
 * ▸ CATALOGUE DECIDES THE ORDER — for the two kinds that arrive with no ranking
 * signal at all (Bryan, device, 2026-08-10).
 *
 * Films, shows and people all come back carrying TMDB popularity. Companies and
 * collections come back carrying NOTHING — `fromCompanyRow` and `fromCollectionRow`
 * both write `popularity: 0` honestly, because there is no such field. So inside the
 * match tier every studio ties with every other studio, and the tie-break falls
 * through to TMDB's own arbitrary order. That is why the top "Warner" studio flipped
 * between two of his searches: `warn` happened to list Warner Bros. Pictures first,
 * `warner` happened to list Warner Premiere first, and neither ordering consulted
 * anything real. It was never a ranking — it was a coin toss.
 *
 * The size of what a studio or a collection actually holds IS the signal, and by
 * the time this runs we have bought it. So the rows are re-seated by catalogue.
 *
 * ⚠ RE-SEATED IN PLACE, ONE KIND AT A TIME. Each kind's rows are sorted among
 * THEMSELVES and written back into the same index slots, so films, shows and people
 * keep the ranking they earned. Rows we never priced sort to that kind's tail in
 * their original order — an unpriced row must not claim a position it has not
 * proved, and must not lose one either.
 *
 * A TV-only studio ranks on its series count: catalogue is catalogue.
 */
const catalogueSize = (r: SearchResult): number | undefined => {
  if (r.filmCount === undefined && r.showCount === undefined) return undefined;
  return Math.max(r.filmCount ?? 0, r.showCount ?? 0);
};

export const orderByCatalogue = (rows: SearchResult[]): SearchResult[] => {
  const out = rows.slice();
  for (const type of ["company", "collection"] as const) {
    const slots: number[] = [];
    for (let i = 0; i < out.length; i++) if (out[i].entityType === type) slots.push(i);
    if (slots.length < 2) continue;
    const seated = slots
      .map((slot, order) => ({ row: out[slot], order }))
      .sort((a, b) => {
        const ca = catalogueSize(a.row);
        const cb = catalogueSize(b.row);
        // Unpriced rows hold their relative order at the tail.
        if (ca === undefined && cb === undefined) return a.order - b.order;
        if (ca === undefined) return 1;
        if (cb === undefined) return -1;
        if (cb !== ca) return cb - ca;
        return a.order - b.order;
      });
    seated.forEach(({ row }, k) => {
      out[slots[k]] = row;
    });
  }
  return out;
};

/**
 * DID YOU MEAN — suggestions for a query that returned nothing.
 *
 * TMDB has no fuzzy search and no native did-you-mean; their own staff have said so
 * on their forum. But their search uses ngram matching, which is exactly why a
 * TRUNCATED query still matches while a MISSPELLED one does not:
 *   `intersteller` → 0 results, but `interstell` → 36, top = Interstellar
 *   `villenueve`   → 0 results, but `villen`     → Denis Villeneuve
 * (Both verified live 2026-07-30.)
 *
 * So: chop characters off the right and re-query. Two rules learned the hard way —
 *   · POOL ACROSS LEVELS instead of taking the first level that returns anything.
 *     One truncation step can surface an obscure near-exact match (`villenue` →
 *     "Clarissa Villenueva") ahead of the famous one.
 *   · Never truncate below DYM_MIN_STEM — under four characters the right answer
 *     is absent from the response entirely (`dun` has no Dune in it), so a shorter
 *     stem only poisons the pool.
 *
 * Cost is 1–3 requests and is paid ONLY in the failure case — when the user already
 * has nothing, which is the one moment an extra request is clearly worth it.
 */
const DYM_LEVELS = 3; // how many truncation steps may spend a request
const DYM_RESULTS = 3;
// The one place the old 4-character floor lives on. LIVE queries search at any
// length (an exact "X" comes back and the ranking surfaces it); truncation STEMS
// are different — they are never exact, so below four characters they only ever
// retrieve junk.
const DYM_MIN_STEM = 4;

export const didYouMean = async (
  query: string,
  signal?: AbortSignal
): Promise<SearchResult[]> => {
  const pool: SearchResult[] = [];
  const seen = new Set<string>();
  let levelsSpent = 0;

  for (let len = query.length - 1; len >= DYM_MIN_STEM; len--) {
    if (levelsSpent >= DYM_LEVELS) break;
    levelsSpent += 1;

    let rows: SearchResult[] = [];
    try {
      const data = await getJson(
        `/search/multi?query=${encodeURIComponent(query.slice(0, len))}`,
        signal
      );
      rows = (data?.results ?? []).map(fromMultiRow).filter(Boolean) as SearchResult[];
    } catch (e) {
      if (isAbort(e)) throw e;
      break; // a failed suggestion is not worth surfacing an error for
    }

    for (const r of rows) {
      const key = `${r.entityType}-${r.id}`;
      if (seen.has(key) || !r.title) continue;
      seen.add(key);
      pool.push(r);
    }
    // Keep going one more level even after a hit — see the pooling rule above.
    if (pool.length >= DYM_RESULTS * 4) break;
  }

  return rankResults(pool).slice(0, DYM_RESULTS);
};

// ── QUICK SEARCHES — compose's trending cards. ───────────────────────────────
// The Q3 board (CHOSEN 2026-08-08): three tappable cards in compose's dead air,
// each one a pre-typed query. Content is TMDB's daily movie trending — Bryan's
// brief was "what's popular, what's trending, what people are searching for the
// most". (The Appwrite most-searched ledger is the OTHER half of that sentence
// and is PARKED: only the old Discover tab ever wrote to it, so its data froze
// the day search moved off that surface. Reviving the write is its own increment.)

/** One quick-search card: exactly what the card renders, nothing more. */
export interface QuickTrend {
  id: number;
  title: string;
  year: string | null;
  /** Never null — a card with no poster is not worth a slot, see the mapper. */
  posterPath: string;
}

export const QUICK_TREND_COUNT = 3;

/** Pure and exported for the test file: trending rows in, at most
 *  QUICK_TREND_COUNT cards out. Posterless rows are dropped rather than rendered
 *  as empty frames — the card's whole pitch is the artwork. */
export const mapQuickTrending = (rows: any[]): QuickTrend[] =>
  rows
    .filter((r) => typeof r?.poster_path === "string" && r.poster_path.length > 0 && r?.title)
    .slice(0, QUICK_TREND_COUNT)
    .map((r) => ({
      id: r.id,
      title: String(r.title),
      year: year(r.release_date),
      posterPath: r.poster_path,
    }));

/** ⚠ ONE REQUEST PER APP SESSION — the cache is the frugality mechanism, the same
 *  role the debounce plays for typed queries. Both the resolved list and the
 *  in-flight promise are held, so N compose visits (or a re-mount race) still
 *  spend exactly one request. A failure resolves to [] and is NOT cached as
 *  success: the next compose visit may retry, which is the honest reading of
 *  "the network was down, not the feature". */
let quickTrendCache: QuickTrend[] | null = null;
let quickTrendInflight: Promise<QuickTrend[]> | null = null;

export const quickTrending = (): Promise<QuickTrend[]> => {
  if (quickTrendCache) return Promise.resolve(quickTrendCache);
  if (quickTrendInflight) return quickTrendInflight;
  quickTrendInflight = getJson("/trending/movie/day")
    .then((data) => {
      quickTrendCache = mapQuickTrending(data?.results ?? []);
      return quickTrendCache;
    })
    .catch(() => [] as QuickTrend[])
    .finally(() => {
      quickTrendInflight = null;
    });
  return quickTrendInflight;
};

/**
 * A film's director. In NO search response — not /search/movie, not /search/multi's
 * movie rows — so it is one request, spent only on the row the user actually
 * expanded. Never call this across a list.
 *
 * Returns the surname, which is what the marquee's `2017 · VILLENEUVE` lane wants.
 * Null when there is no director credited (documentaries, some TV) rather than a
 * guess from the crew list.
 */
export const fetchDirectorSurname = async (
  movieId: number,
  signal?: AbortSignal
): Promise<string | null> => {
  const credits = await getJson(`/movie/${movieId}/credits`, signal);
  const director = (credits?.crew ?? []).find((c: any) => c.job === "Director");
  if (!director?.name) return null;
  return String(director.name).trim().split(/\s+/).slice(-1)[0].toUpperCase();
};

/** An AbortError is a cancellation we caused, not a failure worth showing anyone. */
export const isAbort = (e: unknown): boolean =>
  e instanceof Error && (e.name === "AbortError" || e.message.includes("Aborted"));

/** Domain row → the SQL shape the recents ledger persists. */
export const toRecentSearch = (r: SearchResult): RecentSearch => ({
  entity_type: r.entityType,
  entity_id: r.id,
  title: r.title,
  year: r.year,
  subtitle: r.subtitle,
  image_path: r.imagePath,
});
