import { Client, Databases, ID, Query } from "react-native-appwrite";
import { TrendingMovie } from "@/interfaces/interfaces";
import type { SearchEntityType } from "./db";

const DATABASE_ID = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID!;
const COLLECTION_ID = process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_ID!;

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject(process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID!);

const database = new Databases(client);

/**
 * ▸ THE MOST-SEARCHED LEDGER — revived 2026-08-09, made HONEST 2026-08-10.
 *
 * CLICK-RECORDED: a write happens only when the user OPENS something from a
 * search (search.tsx's onPickResult — typing rows, the hero's DETAILS, the
 * did-you-mean suggestions). The original revival wrote at the submit moment
 * and recorded the ranker's #1 guess — Bryan searched JURASSIC, chose the
 * Jurassic Park Collection, and the ledger logged Jurassic World Rebirth. A
 * tap is the user announcing intent; the database never guesses.
 *
 * THING-KEYED: the row's identity is the ENTITY — the (entity_type, movie_id)
 * pair — not the query text. Every phrasing that leads to the same choice
 * ("jur", "jura", "jurassic park") feeds the same row, so `count` is "times
 * this thing was chosen from any search", the number the trending cards
 * actually want. `searchTerm` is a breadcrumb: the latest wording that got
 * there. (The pre-2026-08-10 rows are the old shape — one row per phrase,
 * count smeared across spellings; see the legacy note below.)
 *
 * The collection predates the five-kind search, so the column names are
 * movie-flavoured. Appwrite cannot rename columns in place — documented here
 * instead of migrated:
 *
 *   searchTerm  — the LATEST query wording that reached this entity.
 *   movie_id    — the TMDB id of the chosen entity, WHATEVER its kind. Only
 *                 unique within a kind — the pair with entity_type is the key.
 *   title       — the entity's display name at first write.
 *   poster_url  — artwork url: BACKDROP for films/tv/collections, profile for
 *                 people, null for studios (a studio's wordmark is typography).
 *   entity_type — which namespace movie_id lives in ("movie" | "tv" | "person"
 *                 | "collection" | "company"; a future "book" needs no schema
 *                 change). Null on legacy rows — all movies by construction.
 *   year        — release/first-air year, null for kinds without one. Stored
 *                 so the future Quick Searches blend never buys a TMDB request
 *                 to rebuild a card's meta line.
 *
 * (There WAS a legacy-split quirk here — pre-2026-08-10 rows had null
 * entity_type and could never match the entity lookup. Moot since Bryan
 * deleted all 388 legacy rows from the console the same day: every row in the
 * table is click-era, entity_type always set. Readers still treat null as
 * "movie" defensively, but it should never occur.)
 *
 * ⚠ FIRE-AND-FORGET BY CONTRACT. This is analytics, and analytics must never
 * cost the search UX anything: no throw, callers never await, errors are
 * logged quietly and swallowed. A lost count is just a lost count.
 *
 * Cost per counted tap: two Appwrite requests (lookup + write), zero TMDB.
 * The per-session dedupe lives with the caller (THE LEDGER'S TAP GUARD in
 * search.tsx) — one write per thing per search session.
 */
export interface LedgerHit {
  entityType: SearchEntityType;
  id: number;
  title: string;
  year: string | null;
  imagePath: string | null;
}

export const updateSearchCount = async (query: string, hit: LedgerHit): Promise<void> => {
  try {
    const result = await database.listDocuments(DATABASE_ID, COLLECTION_ID, [
      Query.equal("entity_type", hit.entityType),
      Query.equal("movie_id", hit.id),
    ]);

    if (result.documents.length > 0) {
      const row = result.documents[0];
      await database.updateDocument(DATABASE_ID, COLLECTION_ID, row.$id, {
        count: row.count + 1,
        // The breadcrumb follows the latest journey; the identity never moves.
        searchTerm: query,
      });
    } else {
      await database.createDocument(DATABASE_ID, COLLECTION_ID, ID.unique(), {
        searchTerm: query,
        movie_id: hit.id,
        title: hit.title,
        count: 1,
        poster_url: hit.imagePath ? `https://image.tmdb.org/t/p/w500${hit.imagePath}` : null,
        entity_type: hit.entityType,
        year: hit.year,
      });
    }
  } catch (error) {
    // Analytics never bubbles — see the contract above.
    console.warn("Search ledger write skipped:", error);
  }
};

/**
 * ▸ TRENDING MOVIES IS FILMS-ONLY, BY RULING (Bryan, 2026-08-10): the ledger
 * now carries five kinds, but this section stays specialized to films —
 * "there's no need to try and put so much into one section when we already
 * have it specialized to the movies." A person or a studio must never appear
 * here; per-kind sections can ask their own question later. The filter is
 * asked SERVER-SIDE so the section's request says what the section means.
 */
export const getTrendingMovies = async (): Promise<
  TrendingMovie[] | undefined
> => {
  try {
    const result = await database.listDocuments(DATABASE_ID, COLLECTION_ID, [
      Query.equal("entity_type", "movie"),
      Query.orderDesc("count"),
    ]);

    // Thing-keyed rows are already one-per-entity; this dedupe survives as a
    // guard against create-race strays, keeping the higher-counted row.
    const entityMap = new Map<number, TrendingMovie>();
    result.documents.forEach((doc: any) => {
      const row = doc as unknown as TrendingMovie;
      if (!entityMap.has(row.movie_id) || entityMap.get(row.movie_id)!.count < row.count) {
        entityMap.set(row.movie_id, row);
      }
    });

    return Array.from(entityMap.values()).slice(0, 8);
  } catch (error) {
    console.error(error);
    return undefined;
  }
};
