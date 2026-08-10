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
 * ▸ THE MOST-SEARCHED LEDGER — revived 2026-08-09.
 *
 * One collection, one row per distinct query string, `count` bumped every time
 * that query is submitted and comes back with results. Frozen between the
 * discovery descope (2026-06-23) and today: the old Discover tab was the only
 * writer. The new writer is useSearch's ledger effect; Discover's legacy call
 * survives, adapted, until that tab is retired.
 *
 * The collection predates the five-kind search, so the attribute names are
 * movie-flavoured. Appwrite cannot rename attributes in place — they are
 * documented here instead of migrated:
 *
 *   searchTerm  — the query, verbatim (the row's identity).
 *   movie_id    — the TMDB id of the top result, WHATEVER its kind. Only unique
 *                 within a kind: person 550 and film 550 are different things,
 *                 which is why entity_type exists.
 *   title       — the top result's display name at write time.
 *   poster_url  — artwork url: BACKDROP for films/tv/collections, profile for
 *                 people, null for studios (a studio's wordmark is typography,
 *                 not an image — see SearchResult.imagePath).
 *   entity_type — which TMDB namespace movie_id lives in. Null on rows written
 *                 before 2026-08-09; those were all movies by construction, so
 *                 readers treat null as "movie".
 *   year        — release/first-air year at write time, null for kinds without
 *                 one. Stored so a future read (the Quick Searches blend) never
 *                 buys a TMDB request to rebuild a card's meta line.
 *
 * ⚠ FIRE-AND-FORGET BY CONTRACT. This is analytics, and analytics must never
 * cost the search UX anything: no throw, callers never await, errors are logged
 * quietly and swallowed. A lost count is just a lost count.
 *
 * Cost per submitted query: two Appwrite requests (lookup + write), zero TMDB.
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
      Query.equal("searchTerm", query),
    ]);

    if (result.documents.length > 0) {
      // The row keeps its original top result — a term's count is its history,
      // and rewriting the entity under it would orphan the counts.
      const row = result.documents[0];
      await database.updateDocument(DATABASE_ID, COLLECTION_ID, row.$id, {
        count: row.count + 1,
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

export const getTrendingMovies = async (): Promise<
  TrendingMovie[] | undefined
> => {
  try {
    const result = await database.listDocuments(DATABASE_ID, COLLECTION_ID, [
      Query.orderDesc("count"),
    ]);

    // Many terms can point at one entity ("dune", "dune part two") — keep each
    // entity once, at its highest-counted term. The key carries the kind because
    // movie_id alone collides across TMDB namespaces; legacy rows (null
    // entity_type) are movies by construction.
    const entityMap = new Map<string, TrendingMovie>();
    result.documents.forEach((doc: any) => {
      const row = doc as unknown as TrendingMovie;
      const key = `${doc.entity_type ?? "movie"}:${row.movie_id}`;
      if (!entityMap.has(key) || entityMap.get(key)!.count < row.count) {
        entityMap.set(key, row);
      }
    });

    return Array.from(entityMap.values()).slice(0, 8);
  } catch (error) {
    console.error(error);
    return undefined;
  }
};
