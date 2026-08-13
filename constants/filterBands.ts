// ─────────────────────────────────────────────────────────────────────────────
// WHICH BANDS EACH KIND SHOWS, AND IN WHAT ORDER.
//
// Row I of the Paper master flow, as data. The sheet renders FROM this table rather
// than asking "what kind am I?" in six places — which is how the six sheets drifted
// apart the first time and had to be rebuilt (Bryan, 2026-08-07: "Why do we have it
// differently in the films, shows, and People Studio? ... It should follow everything
// from the All").
//
// ⚠ AN ABSENT BAND IS ABSENT, NOT DISABLED. A person has no release date, so PEOPLE
// simply has no MINIMUM RATING row — nothing greyed out, nothing inert. Degrade to
// fewer controls, never to dead ones.
// ─────────────────────────────────────────────────────────────────────────────
import { GENRES } from "@/constants/genreMarks";
import {
  COLLECTION_SIZE_BANDS,
  STUDIO_SIZE_BANDS,
  type FilterState,
  type KindKey,
  type SizeBandKey,
  type SortKey,
  type StatusKey,
} from "@/hooks/useFilterState";

export type FilterBand =
  | "sort"
  | "status"
  /** ⚠ ENTITY PAGES ONLY — STATUS and FORMAT sharing one row, two half-width
   *  cycles under two labels. It is ONE band but TWO numbers, which is the only
   *  reason `numberedBands` below exists. The search surface never uses it: kind
   *  is navigation there, so there is nothing to pair STATUS with. */
  | "statusKind"
  | "knownFor"
  | "decade"
  | "catalogue"
  | "size"
  | "rating"
  | "genre";

/**
 * ▸ SORT FIRST, GENRE LAST, ON EVERY KIND (Bryan, 2026-08-07, from a device
 * screenshot of the shipped entity sheet: "it looks better at the bottom than it does
 * at the top").
 *
 * The kind-specific band takes the slot where STATUS or MINIMUM RATING would be, so
 * the shape of the sheet never moves between kinds — only what fills it.
 *
 * ❌ NO `type` BAND. Kind is navigation now: the row above the results picks it, and
 * this sheet filters WITHIN whatever is showing.
 */
export const BANDS_FOR: Record<KindKey, readonly FilterBand[]> = {
  any: ["sort", "status", "decade", "genre"],
  film: ["sort", "status", "decade", "rating", "genre"],
  shows: ["sort", "status", "decade", "rating", "genre"],
  // No status, no decade, no rating — a person has none of them, and "decade" for a
  // person is ambiguous anyway (born? active? their films?).
  person: ["sort", "knownFor", "genre"],
  // CATALOGUE replaces MINIMUM RATING: a studio's rating would be the average of its
  // films, which is a different claim wearing the same control.
  studio: ["sort", "decade", "catalogue", "genre"],
  collection: ["sort", "decade", "size", "rating", "genre"],
};

/**
 * An ENTITY PAGE is not one of the six kinds — it filters one filmography, and its
 * composition predates all of this. Spelled out here rather than left implicit so
 * both surfaces render from one table and neither can quietly drift from the other.
 */
export const ENTITY_BANDS: readonly FilterBand[] = [
  "sort",
  "statusKind",
  "decade",
  "rating",
  "genre",
];

/** The shipped `SectionLabel` wording. GENRE carries its own hint because it is the
 *  only multi-select on the sheet and nothing else says so. */
const BAND_TITLE: Record<FilterBand, string> = {
  sort: "SORT BY",
  status: "STATUS",
  statusKind: "STATUS", // its second label is the surface's own word — see kindLabel
  knownFor: "KNOWN FOR",
  decade: "DECADE",
  catalogue: "CATALOGUE",
  size: "SIZE",
  rating: "MINIMUM RATING",
  genre: "GENRE — PICK ANY",
};

/**
 * `01 · SORT BY`. The number is POSITIONAL — it counts down the sheet you are on, so
 * MINIMUM RATING is 04 on films and does not exist at all on people. Derived from the
 * index rather than stored, so a band added or removed can never leave a gap.
 */
export const bandLabel = (band: FilterBand, index: number): string =>
  `${String(index + 1).padStart(2, "0")} · ${BAND_TITLE[band]}`;

/** Just the number, for the second half of a paired row. */
export const bandNumber = (index: number): string => String(index + 1).padStart(2, "0");

/**
 * ▸ WHICH BANDS HAVE A CONTROL TODAY.
 *
 * KNOWN FOR, CATALOGUE and SIZE are designed but not built — increments 05, 08 and
 * 09. A kind that lists one simply shows fewer bands until then, which still beats
 * showing four film controls that do nothing to a list of people.
 *
 * ⚠ THIS IS A LIST, NOT A CALL INTO THE RENDERER. Deciding it by invoking
 * `renderBand` inside a `useMemo` is what crashed the sheet on 2026-08-07: the
 * renderer reads values declared BELOW it, so during that memo they were still
 * undefined and `sortStops.indexOf` threw. Whether a band exists is a fact about the
 * design; it must not depend on render order.
 */
export const IMPLEMENTED_BANDS: ReadonlySet<FilterBand> = new Set<FilterBand>([
  "sort",
  "status", // increment 05 — its own full-width chip row
  "statusKind",
  "catalogue", // increment 08 — BASED IN + SIZE, tap-to-open
  "size", // increment 09 — a band of its own on COLLECTIONS
  "knownFor", // increment 09 — PEOPLE's department chips
  "decade",
  "rating",
  "genre",
]);

/**
 * Pair each band with the number its label should print.
 *
 * ⚠ ROWS AND NUMBERS ARE NOT THE SAME COUNT. `statusKind` is one row wearing two
 * numbers, so an entity page's GENRE is 06 while it is only the fifth row. Walking a
 * counter is the only way to keep both true; deriving either from the array index
 * alone gets one of them wrong, which is the bug the old hard-coded labels had.
 */
export const numberedBands = (
  bands: readonly FilterBand[]
): { band: FilterBand; n: number }[] => {
  let n = 0;
  return bands.map((band) => {
    const at = n;
    n += band === "statusKind" ? 2 : 1;
    return { band, n: at };
  });
};

/**
 * ▸ TELEVISION'S WORD FOR IT IS AIRED (Bryan, 2026-08-07).
 *
 * Same `StatusKey`, same state, different label — the vocabulary is per kind, the
 * value is not. Anything that prints the applied filter reads this too, so the bar
 * says AIRED on shows and RELEASED on films without either of them branching.
 */
export const statusLabelsFor = (kind: KindKey): Record<StatusKey, string> => ({
  any: "ANY",
  released: kind === "shows" ? "AIRED" : "RELEASED",
  upcoming: "UPCOMING",
});

/**
 * The SIZE chips this kind offers. One state field, two vocabularies, because the
 * question genuinely differs: a studio's catalogue is a MAGNITUDE (boutique or
 * major?), a collection's is a THRESHOLD (a real series, or a pair?).
 */
export const sizeBandsFor = (kind: KindKey): readonly SizeBandKey[] =>
  kind === "studio" ? STUDIO_SIZE_BANDS : COLLECTION_SIZE_BANDS;

/**
 * ▸ THE SHEET DOES NOT SCROLL, so the bands have to fit — there is no ScrollView in
 * FilterSheet.tsx, which is what the `fit` factors are for. Genre is last and takes
 * whatever room is left, clipping its bottom row; that clip IS the scroll affordance
 * for the grid, not a layout bug.
 */

/**
 * ▸ WHAT IS CURRENTLY ON, AS A LIST OF WORDS YOU CAN TAKE BACK.
 *
 * The applied-filter bar prints one of these per active control, and tapping one
 * removes exactly that control — which is why each term carries its own `clear`
 * rather than the bar switching on a key. A term that cannot say how to undo itself
 * has no business being tappable.
 *
 * ⚠ EACH GENRE IS ITS OWN TERM, because genre is the only multi-select on the sheet:
 * `SCI-FI` and `DRAMA` are two things you chose and must be two things you can drop.
 * Everything else contributes at most one.
 *
 * ⚠ SORT COUNTS. It is not a narrowing control, but it IS a difference from the
 * resting state, and the bar's job is to account for every one of them — a list
 * silently reordered with nothing on screen saying so is the failure this prevents.
 */
export type AppliedTerm = {
  key: string;
  label: string;
  /** The state with this one control put back to its default. */
  clear: (s: FilterState) => FilterState;
};

export const appliedTerms = (
  s: FilterState,
  base: FilterState,
  kind: KindKey,
  sortLabels: Record<SortKey, string>
): AppliedTerm[] => {
  const out: AppliedTerm[] = [];
  const status = statusLabelsFor(kind);

  if (s.sort !== base.sort) {
    out.push({
      key: "sort",
      label: sortLabels[s.sort],
      clear: (x) => ({ ...x, sort: base.sort, desc: base.desc }),
    });
  }
  // The DIRECTION on its own — you can be sorted by RELEASE DATE the default way and
  // then flip it, which is a change the bar would otherwise never mention.
  if (s.sort === base.sort && s.desc !== base.desc) {
    out.push({
      key: "desc",
      label: s.desc ? "DESC" : "ASC",
      clear: (x) => ({ ...x, desc: base.desc }),
    });
  }
  if (s.status !== base.status) {
    out.push({
      key: "status",
      label: status[s.status],
      clear: (x) => ({ ...x, status: base.status }),
    });
  }
  if (s.knownFor !== base.knownFor) {
    out.push({
      key: "knownFor",
      label: s.knownFor.toUpperCase(),
      clear: (x) => ({ ...x, knownFor: base.knownFor }),
    });
  }
  if (s.decade !== base.decade && s.decade !== null) {
    out.push({
      key: "decade",
      label: `${s.decade}s`,
      clear: (x) => ({ ...x, decade: base.decade }),
    });
  }
  if (s.basedIn !== base.basedIn && s.basedIn !== null) {
    out.push({
      key: "basedIn",
      label: s.basedIn,
      clear: (x) => ({ ...x, basedIn: base.basedIn }),
    });
  }
  if (s.sizeBand !== base.sizeBand && s.sizeBand !== null) {
    out.push({
      key: "size",
      label: s.sizeBand,
      clear: (x) => ({ ...x, sizeBand: base.sizeBand }),
    });
  }
  if (s.minRating > base.minRating) {
    out.push({
      // `7.0+`, because the control is a FLOOR and a bare 7.0 reads as "rated 7.0".
      key: "rating",
      label: `${s.minRating.toFixed(1)}+`,
      clear: (x) => ({ ...x, minRating: base.minRating }),
    });
  }
  for (const id of s.genres) {
    out.push({
      key: `genre-${id}`,
      // An id with no entry in GENRES prints its number rather than vanishing:
      // visibly unfinished, never silently missing — the genre grid's own rule.
      label: GENRES.find((g) => g.id === id)?.label ?? String(id),
      clear: (x) => ({ ...x, genres: x.genres.filter((g) => g !== id) }),
    });
  }
  return out;
};
