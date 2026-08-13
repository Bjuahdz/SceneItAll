import { useCallback, useMemo, useRef, useState } from "react";

/**
 * THE FILTER'S STATE — one object, and the rules for reading it.
 *
 * Two things depend on this shape being exact, so it lives on its own rather
 * than inside the sheet:
 *   · the VERBS SLEEP UNTIL SOMETHING CHANGES (the board's own caption), which
 *     is `isDefault` and nothing more;
 *   · the live count in the header, which F4 computes by running these values
 *     over the entity's films.
 *
 * STATUS and KIND are CYCLES, not menus — one tap advances, the dots count
 * the cycle. Bryan's ruling: released/upcoming merged into one button rather
 * than two toggles, because they are the same question asked once.
 */

export const SORT_CYCLE = ["release", "rating"] as const;
/**
 * ▸ THE SEARCH SURFACE SORTS BY RELEVANCE FIRST (Bryan, 2026-08-05).
 *
 * An entity page has no natural order — a filmography is a complete list, so
 * RELEASE DATE is a fine place to start. Search results are different: they
 * arrive RANKED, which is the only reason the real Dune sits at 01. Reusing the
 * entity sheet's defaults would have re-sorted the whole list by year the moment
 * any filter was applied — even a genre tile no one asked to reorder anything —
 * and the best match would have moved to wherever its release year put it.
 *
 * So this surface gets a third option and starts on it. Entity pages never see
 * it: they keep SORT_CYCLE, and the cycle is passed into the sheet rather than
 * read from a global, so neither surface can inherit the other's vocabulary.
 */
export const SEARCH_SORT_CYCLE = ["relevance", "alpha", "release", "rating", "size"] as const;

/**
 * ▸ WHICH SORTS EACH KIND ACTUALLY OFFERS (Bryan, 2026-08-07 — Row F of the master
 * flow). The dots on the SORT bar count THIS, so the control says how many stops it
 * has before anyone taps it.
 *
 * Every stop here is answerable with data already on the row — see the SearchResult
 * comment in services/search.ts. Nothing in this table costs a request.
 *
 * ⚠ A–Z IS ON EVERY KIND, and it is the only one that is: every row has a name.
 * RELEASE DATE means something different per kind and that is deliberate — a film's
 * own date, a studio's newest RELEASED film, a collection's newest part. All three
 * are "when did this last put something out", which is the only date any of them has
 * that a person would sort by.
 *
 * ❌ NO "NEWEST RELEASE" STOP. Bryan: "release date already kind of handles newest to
 * oldest" — the direction row does that work, so a separate stop was a duplicate.
 *
 * ❌ NO AVG RATING ON STUDIOS. It would be the average of its films, which is a
 * different claim wearing the same control.
 */
export const SORT_STOPS: Record<KindKey, readonly SortKey[]> = {
  any: ["relevance", "alpha", "release", "rating"],
  film: ["relevance", "alpha", "release", "rating"],
  shows: ["relevance", "alpha", "release", "rating"],
  person: ["relevance", "alpha"],
  studio: ["relevance", "alpha", "release", "size"],
  collection: ["relevance", "alpha", "release", "rating", "size"],
};

/**
 * KNOWN FOR — a person's department, on the PEOPLE sheet only.
 *
 * ⚠ `any` IS THE FIRST STOP, and it is load-bearing. Defaulting to ACTING would hide
 * every director on a sheet that never said it was filtering.
 *
 * CREW is a CATCH-ALL, not a department: TMDB's known_for_department has a long tail
 * (Production, Sound, Camera, Editing, Art…) and four chips is what fits the row, so
 * everything outside the first three answers to CREW.
 */
export const KNOWN_FOR_CYCLE = ["any", "acting", "directing", "writing", "crew"] as const;
export type KnownForKey = (typeof KNOWN_FOR_CYCLE)[number];

/**
 * SIZE — how many films the thing holds. One field, two vocabularies, because the
 * question genuinely differs: a studio's catalogue is a MAGNITUDE (is this a boutique
 * or a major?), a collection's is a THRESHOLD (is this a real series or a pair?).
 *
 * The keys never collide, so one state field serves both and the sheet only ever
 * offers the ones its kind can answer. Bands rather than a number throughout —
 * nobody searches for a studio with exactly 37 films.
 */
export const STUDIO_SIZE_BANDS = ["1-5", "6-20", "21+"] as const;
export const COLLECTION_SIZE_BANDS = ["2+", "3+", "5+"] as const;
export type SizeBandKey =
  | (typeof STUDIO_SIZE_BANDS)[number]
  | (typeof COLLECTION_SIZE_BANDS)[number];

/** Inclusive bounds for each band. `Infinity` keeps the comparison one expression. */
export const SIZE_RANGE: Record<SizeBandKey, { min: number; max: number }> = {
  "1-5": { min: 1, max: 5 },
  "6-20": { min: 6, max: 20 },
  "21+": { min: 21, max: Infinity },
  "2+": { min: 2, max: Infinity },
  "3+": { min: 3, max: Infinity },
  "5+": { min: 5, max: Infinity },
};
export const STATUS_CYCLE = ["any", "released", "upcoming"] as const;
export const KIND_CYCLE = ["any", "film", "shows"] as const;
/**
 * ▸ THE ROWS ARE OF A KIND, AND THE KIND IS NAVIGATION (Bryan, 2026-08-05/07).
 *
 * An entity page holds one kind of row — credits — so the question there stops at
 * film-vs-television. A result set is mixed, and the question worth asking of it is
 * broader: films, shows, people, studios, collections. On results this is no longer
 * a control INSIDE the sheet at all — it is the kind row above the list, and the
 * sheet filters within whichever kind is showing.
 *
 * ⚠ COLLECTION, not "franchise" (Bryan, 2026-08-07). TMDB catalogues these as
 * collections and that is what someone has to type to find one — "Dark Knight
 * franchise" returns nothing, "Dark Knight Collection" returns it. The rows print
 * COLLECTION too, so the vocabulary is one word everywhere.
 */
export const SEARCH_KIND_CYCLE = [
  "any",
  "film",
  "shows",
  "person",
  "studio",
  "collection",
] as const;
/** The superset, so both cycles' members are valid keys. */
export type SortKey = (typeof SEARCH_SORT_CYCLE)[number];
export type StatusKey = (typeof STATUS_CYCLE)[number];
/** The superset, so both cycles' members are valid keys. */
export type KindKey = (typeof SEARCH_KIND_CYCLE)[number];

export type FilterState = {
  sort: SortKey;
  /**
   * Which end of the sort you start from. ONE boolean for both fields, because
   * it is one question — its WORDS change with the field (newest/oldest for
   * release, highest/lowest for rating) but its meaning never does.
   *
   * `true` is descending and is the default for both: the newest film and the
   * best-rated film are what anyone opens a filmography to see first.
   */
  desc: boolean;
  status: StatusKey;
  kind: KindKey;
  /** The decade's first year (1990, 2020…). `null` is ALL, and ALL is pinned. */
  decade: number | null;
  /** 0 means "no floor" — NOT "rated zero". See the unrated trap in entities.ts. */
  minRating: number;
  /** TMDB genre ids. Empty is "any genre", never "no genres". */
  genres: number[];
  /** PEOPLE only — which department. `"any"` is the neutral first chip. */
  knownFor: KnownForKey;
  /** STUDIOS only — a two-letter ISO country code. `null` is ANY. */
  basedIn: string | null;
  /** STUDIOS and COLLECTIONS — a key into SIZE_RANGE. `null` is ANY. */
  sizeBand: SizeBandKey | null;
};

export const FILTER_DEFAULTS: FilterState = {
  sort: "release",
  desc: true,
  status: "any",
  kind: "any",
  decade: null,
  minRating: 0,
  genres: [],
  knownFor: "any",
  basedIn: null,
  sizeBand: null,
};

/**
 * Are these two filters the same question? It has to answer for EVERY field — a
 * filter that changed something the check forgot would leave APPLY greyed out
 * over a real change, which is exactly the failure below.
 *
 * Genres compare as SETS: they are toggled, so [28, 18] and [18, 28] are the
 * same pick arrived at in a different order, and a length check plus membership
 * settles it without sorting either side.
 */
export function sameFilter(a: FilterState, b: FilterState): boolean {
  return (
    a.sort === b.sort &&
    a.desc === b.desc &&
    a.status === b.status &&
    a.kind === b.kind &&
    a.decade === b.decade &&
    a.minRating === b.minRating &&
    a.knownFor === b.knownFor &&
    a.basedIn === b.basedIn &&
    a.sizeBand === b.sizeBand &&
    a.genres.length === b.genres.length &&
    a.genres.every((g) => b.genres.includes(g))
  );
}

/**
 * The search surface's starting point: ordered by relevance, and ON FILMS.
 *
 * ▸ THERE IS NO ALL ANY MORE (Bryan, 2026-08-08): "the All tab is what I'm kind of
 * worried about, maybe adding more friction than needed." ALL's filter sheet was the
 * weakest of the six — no rating floor, no person question, and a note explaining
 * why — and a default whose sheet needs a disclaimer is a bad default. FILMS is the
 * first tab and the resting kind; the row above the results is how you reach the
 * rest, and each kind's sheet asks only what its rows can answer.
 *
 * `"any"` remains a legal KindKey — entity pages rest on it, and gateByKind treats
 * it as "everything" — the search surface just never starts there now.
 *
 * Spread from the entity defaults so a field added there can never be forgotten
 * here — only the values that genuinely differ are restated.
 */
export const SEARCH_FILTER_DEFAULTS: FilterState = {
  ...FILTER_DEFAULTS,
  sort: "relevance",
  kind: "film",
};

/**
 * Is this the untouched sheet? What RESET asks — is there anything to clear —
 * and what the nav's FILTER pill asks before wearing its accent.
 *
 * ⚠ TAKES ITS BASELINE, because "untouched" is now a per-surface question: a
 * results filter sorted by RELEASE DATE is a filter someone turned on, while the
 * identical state on an entity page is the page's own resting order. Defaulting
 * the parameter keeps every existing entity call site reading exactly as before.
 */
export function isDefault(s: FilterState, base: FilterState = FILTER_DEFAULTS): boolean {
  return sameFilter(s, base);
}

/**
 * The stops a SORT bar actually offers: the surface's cycle, narrowed to what this
 * kind can answer. The bar's dot count reads this too, so the control can never show
 * more dots than it has stops.
 */
export const sortStopsFor = (kind: KindKey, cycle: readonly SortKey[]): readonly SortKey[] =>
  cycle.filter((k) => SORT_STOPS[kind].includes(k));

/**
 * Move a filter to a new kind, dropping a sort the new kind cannot answer.
 *
 * ⚠ THE GUARD LIVES HERE, NOT IN THE CONTROL, because there are now two ways to
 * change kind — the kind row above the results, and `cycleKind` on an entity page —
 * and a sort surviving a move it cannot answer would order the list by a field none
 * of its rows has, silently, with the failing control off screen.
 */
export const withKind = (
  s: FilterState,
  kind: KindKey,
  cycle: readonly SortKey[] = SEARCH_SORT_CYCLE
): FilterState => {
  const stops = sortStopsFor(kind, cycle);
  return stops.includes(s.sort) ? { ...s, kind } : { ...s, kind, sort: "relevance", desc: true };
};

/** Next value in a cycle, wrapping. The dots elsewhere read the same array. */
export function nextIn<T extends readonly string[]>(cycle: T, current: T[number]): T[number] {
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length];
}

/**
 * @param defaults the surface's own baseline — what RESET returns to and what
 * `untouched` is measured against. Entity pages take FILTER_DEFAULTS; the search
 * results sheet takes SEARCH_FILTER_DEFAULTS, whose only difference is that it
 * starts on RELEVANCE.
 *
 * @param sortCycle which sort fields this surface offers. Passed in rather than
 * read from a global so an entity page can never cycle into RELEVANCE, which it
 * has no ranking to honour.
 *
 * @param kindCycle which kinds this surface can ask for. Entity pages stop at
 * film-vs-television; results add people, studios and collections.
 */
export function useFilterState(
  defaults: FilterState = FILTER_DEFAULTS,
  sortCycle: readonly SortKey[] = SORT_CYCLE,
  kindCycle: readonly KindKey[] = KIND_CYCLE
) {
  const [state, setState] = useState<FilterState>(defaults);

  // Both surface parameters are held in refs so every callback below can stay
  // identity-stable across renders — these are handed down to controls, and a
  // changing identity there is churn on a sheet that is mid-animation.
  const baseRef = useRef(defaults);
  baseRef.current = defaults;
  const cycleRef = useRef(sortCycle);
  cycleRef.current = sortCycle;
  const kindRef = useRef(kindCycle);
  kindRef.current = kindCycle;

  // The FIELD is a cycle like the two beside it. The DIRECTION is not — both of
  // its words are on screen at once, so it is set, never advanced: you tap the
  // one you want rather than tapping until the one you want appears.
  /**
   * ⚠ LANDING ON A DIRECTIONLESS FIELD RESETS THE DIRECTION.
   *
   * RELEVANCE hides the direction control entirely (Bryan, 2026-08-05 — "let's
   * just leave it at Closest by default"), and a hidden control must not be able
   * to hold a value. Cycling rating→relevance while set to LOWEST would
   * otherwise leave the results silently reversed with nothing on screen saying
   * so, and — worse — would leave the filter unequal to SEARCH_FILTER_DEFAULTS,
   * so the nav's FILTER pill would stay lit over a filter the user had just
   * cycled all the way back out of and could not find the controls for.
   */
  const cycleSort = useCallback(
    () =>
      setState((s) => {
        // ⚠ THE STOPS ARE THE SURFACE'S CYCLE NARROWED BY THE KIND, and that one
        // expression covers both surfaces with no branch. An entity page passes
        // SORT_CYCLE and is always on a media kind, so nothing narrows and it
        // behaves exactly as before. The search surface passes SEARCH_SORT_CYCLE
        // and gets precisely the stops Row F lists for whatever kind is showing —
        // PEOPLE two, STUDIOS four, COLLECTIONS five.
        const stops = sortStopsFor(s.kind, cycleRef.current);
        if (stops.length < 2) return s; // a lone stop has nowhere to advance to
        const sort = nextIn(stops, s.sort);
        return { ...s, sort, desc: sort === "relevance" ? true : s.desc };
      }),
    []
  );
  const setDesc = useCallback((desc: boolean) => setState((s) => ({ ...s, desc })), []);
  const cycleStatus = useCallback(
    () => setState((s) => ({ ...s, status: nextIn(STATUS_CYCLE, s.status) })),
    []
  );
  /** The chip row SETS rather than advances — every answer is already on screen,
   *  so tapping one is a choice, not a step through a cycle. Entity pages keep
   *  `cycleStatus`; both write the same field. */
  const setStatus = useCallback(
    (status: StatusKey) => setState((s) => ({ ...s, status })),
    []
  );
  /**
   * ⚠ ASKING FOR PEOPLE PUTS THE SORT BACK TO RELEVANCE, for the same reason the
   * sort cycle resets the direction: a control that cannot answer must not be
   * left holding a value. RELEASE DATE and AVG RATING are questions only a film
   * can answer, so carrying either into a list of people would order it by a
   * field none of them has — silently, with the failing control about to be
   * taken off screen. (Inert on entity pages: their cycle never leaves the three
   * media kinds, so this branch cannot be reached there.)
   */
  const cycleKind = useCallback(
    () =>
      setState((s) => {
        return withKind(s, nextIn(kindRef.current, s.kind), cycleRef.current);
      }),
    []
  );
  const setDecade = useCallback((decade: number | null) => setState((s) => ({ ...s, decade })), []);
  const setMinRating = useCallback(
    (minRating: number) => setState((s) => ({ ...s, minRating })),
    []
  );
  const setKnownFor = useCallback(
    (knownFor: KnownForKey) => setState((s) => ({ ...s, knownFor })),
    []
  );
  /** KNOWN FOR is a CYCLE on the sheet (Bryan, 2026-08-08 — "tap on it and it
   *  rotates through the options... like the Sort by") — one tap advances, the dots
   *  count the stops. Five words did not survive as a chip row on 350pt. */
  const cycleKnownFor = useCallback(
    () => setState((s) => ({ ...s, knownFor: nextIn(KNOWN_FOR_CYCLE, s.knownFor) })),
    []
  );
  const setBasedIn = useCallback(
    (basedIn: string | null) => setState((s) => ({ ...s, basedIn })),
    []
  );
  const setSizeBand = useCallback(
    (sizeBand: SizeBandKey | null) => setState((s) => ({ ...s, sizeBand })),
    []
  );
  // Multi-select: tapping a chosen genre unchooses it. Empty means "any".
  const toggleGenre = useCallback(
    (id: number) =>
      setState((s) => ({
        ...s,
        genres: s.genres.includes(id) ? s.genres.filter((g) => g !== id) : [...s.genres, id],
      })),
    []
  );
  const reset = useCallback(() => setState(baseRef.current), []);

  const untouched = useMemo(() => isDefault(state, defaults), [state, defaults]);

  return {
    state,
    setState,
    cycleSort,
    setDesc,
    cycleStatus,
    setStatus,
    cycleKind,
    setDecade,
    setMinRating,
    setKnownFor,
    cycleKnownFor,
    setBasedIn,
    setSizeBand,
    toggleGenre,
    reset,
    untouched,
  };
}
