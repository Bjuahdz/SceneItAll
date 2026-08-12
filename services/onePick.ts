// ─────────────────────────────────────────────────────────────────────────────
// ONE PICK — the single recommendation at the foot of the default Search state.
//
// The signal is the user's OWN takes, not app-wide activity (which is cut, and
// unreachable anyway). The enrichment pipeline already extracts `entities` and
// `topics` from every take, so "who you actually talk about" is real local data.
//
// Bryan's steer: NOT just directors. Actors, filmmakers, composers — Zimmer counts.
// Whoever you mention most is the thread worth pulling.
//
// Cost: ONE TMDB request, and only when there is something honest to recommend.
// With no takes there is no pick, and the section is omitted rather than filled
// with trending films — that would turn Search into Discover.
// ─────────────────────────────────────────────────────────────────────────────
import { TMDB_CONFIG } from "./api";
import { getTakes, type TakeEntity } from "./db";

export interface Pick {
  movieId: number;
  title: string;
  posterPath: string | null;
  year: string | null;
  /** `2010 · VILLENEUVE` — the film's own line. */
  facts: string;
  /** `Because Villeneuve is your most recorded director.` */
  reason: string;
}

// Person-shaped entity types. A studio or a collection is a thing you liked, not a
// person whose other work we can go and find, so they are not pick material.
const PERSON_TYPES = new Set(["director", "actor", "composer"]);

// How the extracted type reads in the reason sentence.
const ROLE_WORD: Record<string, string> = {
  director: "director",
  actor: "actor",
  composer: "composer",
};

interface Ranked {
  name: string;
  type: string;
  tmdbId?: number;
  count: number;
}

/** Tally every person mentioned across every take, most-mentioned first. */
export const rankPeopleFromTakes = async (): Promise<Ranked[]> => {
  const takes = await getTakes();
  const tally = new Map<string, Ranked>();

  for (const take of takes) {
    let entities: TakeEntity[] = [];
    try {
      entities = take.entities ? (JSON.parse(take.entities as unknown as string) as TakeEntity[]) : [];
    } catch {
      continue; // a malformed blob is not worth failing a recommendation over
    }
    for (const e of entities) {
      if (!PERSON_TYPES.has(e.type) || !e.name) continue;
      // Key on the NAME, not the id — the same person is often extracted with an
      // id from one take and without one from another.
      const key = `${e.type}:${e.name.toLowerCase()}`;
      const prev = tally.get(key);
      if (prev) {
        prev.count += 1;
        prev.tmdbId = prev.tmdbId ?? e.tmdbId;
      } else {
        tally.set(key, { name: e.name, type: e.type, tmdbId: e.tmdbId, count: 1 });
      }
    }
  }

  return Array.from(tally.values()).sort((a, b) => b.count - a.count);
};

const getJson = async (path: string, signal?: AbortSignal): Promise<any> => {
  const res = await fetch(`${TMDB_CONFIG.BASE_URL}${path}`, {
    method: "GET",
    headers: TMDB_CONFIG.headers,
    signal,
  });
  if (!res.ok) throw new Error(`TMDB request failed (${res.status})`);
  return res.json();
};

/** Surname only — "Because VILLENEUVE is your most recorded director." */
const surname = (name: string): string => name.trim().split(/\s+/).slice(-1)[0].toUpperCase();

/**
 * Build the pick.
 *
 * `seenMovieIds` are films the user has already journaled — recommending one of
 * those back to them would be worthless, so they are excluded.
 *
 * Returns null whenever there is nothing honest to show: no takes, no extracted
 * people, no resolvable TMDB person, or no unseen film. The caller omits the whole
 * section in that case; design contract 8.
 */
export const buildOnePick = async (
  seenMovieIds: Set<number>,
  signal?: AbortSignal
): Promise<Pick | null> => {
  const ranked = await rankPeopleFromTakes();
  if (ranked.length === 0) return null;

  for (const person of ranked.slice(0, 3)) {
    try {
      // Resolve the person if enrichment did not already match them to a TMDB id.
      let personId = person.tmdbId;
      if (!personId) {
        const found = await getJson(
          `/search/person?query=${encodeURIComponent(person.name)}`,
          signal
        );
        personId = found?.results?.[0]?.id;
      }
      if (!personId) continue;

      // /discover with_people covers cast AND crew, which is exactly right when the
      // person might be a composer rather than a director.
      const page = await getJson(
        `/discover/movie?with_people=${personId}&sort_by=popularity.desc`,
        signal
      );
      const candidate = (page?.results ?? []).find(
        (m: any) => m?.id && !seenMovieIds.has(m.id) && m.poster_path
      );
      if (!candidate) continue;

      const year =
        typeof candidate.release_date === "string" && candidate.release_date.length >= 4
          ? candidate.release_date.slice(0, 4)
          : null;
      const role = ROLE_WORD[person.type] ?? "name";

      return {
        movieId: candidate.id,
        title: candidate.title ?? candidate.original_title ?? "",
        posterPath: candidate.poster_path ?? null,
        year,
        facts: [year, surname(person.name)].filter(Boolean).join(" · "),
        reason: `Because ${surname(person.name)} is your most recorded ${role}.`,
      };
    } catch {
      // Try the next-most-recorded person rather than failing the whole section.
      continue;
    }
  }
  return null;
};
