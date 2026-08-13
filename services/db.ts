// ─────────────────────────────────────────────────────────────────────────────
// Local on-device database (expo-sqlite).
//
// This is the persistence foundation for the journaling app. v1 only holds the
// `favorites` table, but it's the same DB that will later carry your takes, watch
// status, ratings, tags, etc. — so new features add tables here instead of bolting
// on another storage mechanism.
// ─────────────────────────────────────────────────────────────────────────────
import * as SQLite from "expo-sqlite";

import { deleteTakeAudio } from "./takeFiles";

// Minimal shape we persist for a saved movie — just enough to render a poster card
// in the Saved tab without re-fetching from TMDB.
export interface FavoriteMovie {
  id: number;
  title: string;
  poster_path: string | null;
  vote_average: number;
  release_date: string;
  saved_at?: number; // epoch ms; present on rows read from the DB (optional so callers can build the shape pre-save)
}

// Single shared connection. Opened once, lazily, and the schema is created on first
// use — every query awaits this so we never touch an uninitialized DB.
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// Add columns introduced after the first `takes` release so existing on-device DBs
// upgrade in place — CREATE TABLE IF NOT EXISTS won't alter a table that already exists.
const migrateTakes = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(takes)`);
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("is_spoiler")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN is_spoiler INTEGER NOT NULL DEFAULT 0`);
  }
  if (!have.has("tags")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN tags TEXT`);
  }
  if (!have.has("title")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN title TEXT`);
  }
  // Phase 3 (voice → structured memory) enrichment columns. JSON-in-TEXT like `tags`.
  if (!have.has("transcript_segments")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN transcript_segments TEXT`);
  }
  if (!have.has("entities")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN entities TEXT`);
  }
  if (!have.has("topics")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN topics TEXT`);
  }
  if (!have.has("summary")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN summary TEXT`);
  }
  if (!have.has("enrich_status")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN enrich_status TEXT NOT NULL DEFAULT 'pending'`);
  }
  if (!have.has("enriched_at")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN enriched_at INTEGER`);
  }
  if (!have.has("enrich_model")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN enrich_model TEXT`);
  }
  if (!have.has("enrich_error")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN enrich_error TEXT`);
  }
  if (!have.has("enrich_attempts")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN enrich_attempts INTEGER NOT NULL DEFAULT 0`);
  }
  // Phase 3e: when the insight stage last RAN for this take (regardless of whether
  // an insight was produced) — null means the stage is still owed.
  if (!have.has("insighted_at")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN insighted_at INTEGER`);
  }
  // Phase 3f: a rating the user SPOKE in the take ("8.7 out of 10"), normalized
  // to 0–10; null when none was stated. Extraction evidence, not a set rating.
  if (!have.has("spoken_rating")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN spoken_rating REAL`);
  }
  // Off-topic verdict from the extraction stage (null = never assessed / legacy,
  // 0 = about the movie, 1 = flagged — the entries UI asks the user keep-or-delete;
  // "keep" writes 0 so the question is asked exactly once).
  if (!have.has("off_topic")) {
    await db.execAsync(`ALTER TABLE takes ADD COLUMN off_topic INTEGER`);
  }
};

// Same guarded pattern for the insights table (shipped in 3e, extended in 3f —
// devices that created it before arc_type existed upgrade in place).
const migrateInsights = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(insights)`);
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("arc_type")) {
    await db.execAsync(`ALTER TABLE insights ADD COLUMN arc_type TEXT`);
  }
};

/**
 * Same guarded pattern for `search_history` — devices that created it during the
 * five-row era upgrade in place.
 *
 * · `hits`       — how many times this entity has been searched, ever. Every
 *                  re-search used to be DISCARDED: the primary key is
 *                  (entity_type, entity_id) and the write was INSERT OR REPLACE, so
 *                  looking someone up ten times left one row and one timestamp. The
 *                  frequency view Discover wants is worthless the day it ships and
 *                  good a month later, so the counting has to start before the UI
 *                  that reads it exists. Existing rows default to 1, which is the
 *                  honest floor — we know they were searched at least once.
 * · `session_id` — which search sitting this row belongs to, stamped in R2 when the
 *                  COMPOSE state gives sessions a beginning and an end. Nullable
 *                  because every row written before R2 has no session we can
 *                  reconstruct, and guessing one from timestamp gaps would be
 *                  fiction. The board's span gate reads this.
 */
const migrateSearchHistory = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(search_history)`);
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("hits")) {
    await db.execAsync(`ALTER TABLE search_history ADD COLUMN hits INTEGER NOT NULL DEFAULT 1`);
  }
  if (!have.has("session_id")) {
    await db.execAsync(`ALTER TABLE search_history ADD COLUMN session_id INTEGER`);
  }
};

const getDb = (): Promise<SQLite.SQLiteDatabase> => {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("sceneitall.db").then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS app_prefs (
          key   TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS favorites (
          id            INTEGER PRIMARY KEY NOT NULL,
          title         TEXT NOT NULL,
          poster_path   TEXT,
          vote_average  REAL,
          release_date  TEXT,
          saved_at      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS takes (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          movie_id            INTEGER NOT NULL,
          movie_title         TEXT NOT NULL,
          poster_path         TEXT,
          kind                TEXT NOT NULL DEFAULT 'voice',
          audio_uri           TEXT,
          duration_ms         INTEGER,
          transcript          TEXT,
          is_spoiler          INTEGER NOT NULL DEFAULT 0,
          tags                TEXT,
          title               TEXT,
          created_at          INTEGER NOT NULL,
          transcript_segments TEXT,
          entities            TEXT,
          topics              TEXT,
          summary             TEXT,
          enrich_status       TEXT NOT NULL DEFAULT 'pending',
          enriched_at         INTEGER,
          enrich_model        TEXT,
          enrich_error        TEXT,
          enrich_attempts     INTEGER NOT NULL DEFAULT 0,
          insighted_at        INTEGER,
          spoken_rating       REAL
        );
        CREATE TABLE IF NOT EXISTS take_embeddings (
          take_id     INTEGER PRIMARY KEY NOT NULL,
          model       TEXT NOT NULL,
          dims        INTEGER NOT NULL,
          vector      TEXT NOT NULL,
          created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS insights (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          take_id           INTEGER NOT NULL,
          insight_text      TEXT NOT NULL,
          related_take_ids  TEXT NOT NULL,
          model             TEXT NOT NULL,
          created_at        INTEGER NOT NULL,
          arc_type          TEXT
        );
        CREATE TABLE IF NOT EXISTS search_history (
          entity_type   TEXT NOT NULL,
          entity_id     INTEGER NOT NULL,
          title         TEXT NOT NULL,
          year          TEXT,
          subtitle      TEXT,
          image_path    TEXT,
          searched_at   INTEGER NOT NULL,
          hits          INTEGER NOT NULL DEFAULT 1,
          session_id    INTEGER,
          PRIMARY KEY (entity_type, entity_id)
        );
      `);
      await migrateTakes(db);
      await migrateInsights(db);
      await migrateSearchHistory(db);
      return db;
    });
  }
  return dbPromise;
};

// Newest saves first (saved_at = epoch ms at insert time).
export const getFavorites = async (): Promise<FavoriteMovie[]> => {
  const db = await getDb();
  return db.getAllAsync<FavoriteMovie>(
    "SELECT id, title, poster_path, vote_average, release_date, saved_at FROM favorites ORDER BY saved_at DESC"
  );
};

// INSERT OR REPLACE = idempotent save (re-saving the same movie just refreshes it).
export const addFavorite = async (movie: FavoriteMovie): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO favorites (id, title, poster_path, vote_average, release_date, saved_at) VALUES (?, ?, ?, ?, ?, ?)",
    [movie.id, movie.title, movie.poster_path, movie.vote_average, movie.release_date, Date.now()]
  );
};

export const removeFavorite = async (id: number): Promise<void> => {
  const db = await getDb();
  await db.runAsync("DELETE FROM favorites WHERE id = ?", [id]);
};

// Dev-panel blank slate. Returns how many rows went, so the caller can say so.
export const deleteAllFavorites = async (): Promise<number> => {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number }>("SELECT id FROM favorites");
  await db.runAsync("DELETE FROM favorites");
  return rows.length;
};

// ── App preferences ──────────────────────────────────────────────────────────
// A key/value strip in the same database, so a dev toggle survives a reload without
// pulling in a storage dependency for one boolean.
export const readPrefs = async (): Promise<Record<string, string>> => {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM app_prefs");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

export const writePref = async (key: string, value: string): Promise<void> => {
  const db = await getDb();
  await db.runAsync("INSERT OR REPLACE INTO app_prefs (key, value) VALUES (?, ?)", [key, value]);
};

// ── Search history (the Search tab's recents ledger) ──────────────────────────
// A real table rather than JSON in `app_prefs` because recents need three things a
// string blob can't give: ordering, an entity type, and dedupe by entity.
//
// New table, so no ALTER migration exists or is needed — CREATE TABLE IF NOT EXISTS
// in getDb() creates it on the next open for devices that already have the DB.

// TMDB's own vocabulary, deliberately. The UI labels (FILM / SHOW / DIRECTOR /
// COLLECTION / STUDIO) are derived at render — DIRECTOR in particular is not a type
// at all, it's a person whose `known_for_department` is "Directing". Storing the
// API's noun keeps one translation point instead of a lossy round-trip.
export type SearchEntityType = "movie" | "tv" | "person" | "collection" | "company";

// Everything the recents ledger needs to draw itself with ZERO network calls —
// the default state is the first thing the user sees, so it must not wait on TMDB.
export interface RecentSearch {
  entity_type: SearchEntityType;
  entity_id: number;
  title: string;
  /** Release year ("2021") for films/shows; a span or null for the other types. */
  year: string | null;
  /** Director for a film/show, `known_for_department` for a person, else null. */
  subtitle: string | null;
  /** Backdrop for film/tv/collection, profile for a person, null for a company
   *  (studios never render TMDB logos — polarity is unknowable). */
  image_path: string | null;
  searched_at?: number; // epoch ms; present on rows read from the DB
  /** How many times this entity has ever been searched. Present on rows read from
   *  the DB; omitted on the entry handed to `recordRecentSearch`, which owns it. */
  hits?: number;
  /** The search sitting this row belongs to — see `migrateSearchHistory`. Null on
   *  every row written before R2. */
  session_id?: number | null;
}

/**
 * ▸ A READ CAP, NOT A STORAGE CAP. That is the whole change in R1.
 *
 * This used to be 5 and was enforced on WRITE: every commit deleted everything past
 * row five, so there was no archive behind the list — the table held exactly what the
 * screen showed. That made the number impossible to raise later, because the history
 * to raise it INTO had already been thrown away.
 *
 * Nothing is deleted now. `search_history` keeps one row per entity you have ever
 * searched, forever; a heavy user accumulates a few thousand rows of short text,
 * which SQLite does not notice. This constant only bounds how many the app reads
 * into memory at once.
 *
 * 60 is deliberately interim. The open ruling is whether the recents board caps at
 * ~20 with a SHOW ALL or scrolls indefinitely (see "Rulings needed before R4"), and
 * 60 forecloses neither — it is twelve times the old ceiling, which is plenty to
 * exercise the skyline packer, while staying far below the point where rendering
 * needs virtualising.
 */
export const RECENTS_LIMIT = 60;

/**
 * `searched_at DESC` is the real ordering. `rowid DESC` is only a tiebreak.
 *
 * ⚠ That tiebreak changed meaning in R1 and the difference is worth knowing. Under
 * INSERT OR REPLACE a refreshed row was deleted and re-inserted, so it earned a fresh
 * (higher) rowid and the tiebreak tracked recency for free. The upsert below updates
 * in PLACE to preserve `hits`, so a re-searched row keeps its original rowid — the
 * tiebreak is no longer recency-meaningful.
 *
 * It is still DETERMINISTIC, which is the property that actually matters: the recents
 * board's layout is a pure function of this order, so an unstable sort would let the
 * board rearrange itself between launches — the one thing the packer must never do.
 * Two rows can only tie here by sharing a millisecond, which two entity opens by hand
 * cannot manage, so either resolution is defensible; being stable is not optional.
 */
export const getRecentSearches = async (): Promise<RecentSearch[]> => {
  const db = await getDb();
  return db.getAllAsync<RecentSearch>(
    `SELECT entity_type, entity_id, title, year, subtitle, image_path,
            searched_at, hits, session_id
       FROM search_history
      ORDER BY searched_at DESC, rowid DESC
      LIMIT ?`,
    [RECENTS_LIMIT]
  );
};

/**
 * A RANDOM draw from the whole archive, for the dev-panel demo arrivals.
 *
 * The table keeps one row per entity ever searched (see RECENTS_LIMIT — a read cap,
 * not a storage cap), which is exactly the pool a fake session should sample: real
 * entities with real artwork the cache has likely met before, zero network, zero
 * fabrication. `ORDER BY RANDOM()` re-rolls per call, so every seeded session is a
 * different composition.
 */
export const sampleSearchHistory = async (limit: number): Promise<RecentSearch[]> => {
  const db = await getDb();
  return db.getAllAsync<RecentSearch>(
    `SELECT entity_type, entity_id, title, year, subtitle, image_path,
            searched_at, hits, session_id
       FROM search_history
      ORDER BY RANDOM()
      LIMIT ?`,
    [limit]
  );
};

/**
 * Upsert against the (entity_type, entity_id) primary key. That key IS the dedupe:
 * re-searching something you already looked up refreshes its stamp and moves it to
 * the top rather than adding a second row.
 *
 * ⚠ NOT `INSERT OR REPLACE` any more, and the distinction is the point. REPLACE
 * deletes the conflicting row and inserts a fresh one, which would reset `hits` to 1
 * on every re-search — the counter would read "1" forever and we would have shipped
 * the same bug in a new column. `ON CONFLICT DO UPDATE` mutates the existing row, so
 * `hits = hits + 1` actually accumulates.
 *
 * The metadata is refreshed from `excluded` rather than left alone, because artwork
 * paths and a film's director do change on TMDB, and the newer fetch is the better one.
 */
export const recordRecentSearch = async (entry: RecentSearch): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO search_history
       (entity_type, entity_id, title, year, subtitle, image_path,
        searched_at, hits, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET
       title       = excluded.title,
       year        = excluded.year,
       subtitle    = excluded.subtitle,
       image_path  = excluded.image_path,
       searched_at = excluded.searched_at,
       session_id  = excluded.session_id,
       hits        = hits + 1`,
    [
      entry.entity_type,
      entry.entity_id,
      entry.title,
      entry.year ?? null,
      entry.subtitle ?? null,
      entry.image_path ?? null,
      entry.searched_at ?? Date.now(),
      entry.session_id ?? null,
    ]
  );
  // NO PRUNE. The five-row trim that used to live here is gone — see RECENTS_LIMIT.
};

// Dev-panel blank slate, same contract as deleteAllFavorites — returns how many went.
export const deleteAllRecentSearches = async (): Promise<number> => {
  const db = await getDb();
  const rows = await db.getAllAsync<{ entity_id: number }>("SELECT entity_id FROM search_history");
  await db.runAsync("DELETE FROM search_history");
  return rows.length;
};

// ── Takes (the "What's your take?" journal entries) ───────────────────────────
// Append-only (many per movie, opinions over time). Movie title/poster are denormalized
// like favorites so a takes list / Home feed renders without re-fetching from TMDB.

// ── Enrichment contract (Phase 3: voice → structured memory) ──────────────────
// A take moves through: pending → transcribed → enriched, or → failed (retryable,
// capped by enrich_attempts) / audio_missing (terminal — legacy temp URI died).
export type EnrichStatus = "pending" | "transcribed" | "enriched" | "failed" | "audio_missing";

// One transcription segment with wall-clock offsets in SECONDS (from Whisper
// verbose_json). Time-spent-per-topic is computed from these — store, don't drop.
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * ⚠ NOT RENAMED WITH THE REST OF THE VOCABULARY, ON PURPOSE (2026-08-07).
 *
 * The search surface moved FRANCHISE → COLLECTION everywhere. This one did NOT,
 * because `"franchise"` here is a VALUE ALREADY WRITTEN INTO SQLITE by the takes
 * enrichment pipeline — renaming the union without migrating the rows would leave
 * every stored mention unmatched by a reader that no longer knows the word. It is
 * also the data agent's schema, not the search surface's.
 *
 * Renaming it is its own increment: a migration (`UPDATE take_entities SET type =
 * 'collection' WHERE type = 'franchise'`) plus the writers in services/claude.ts,
 * services/genres.ts and services/entityMatch.ts, in one commit. Until then this
 * word staying put is a deliberate seam, not a missed rename.
 */
export type TakeEntityType =
  | "director"
  | "actor"
  | "character"
  | "studio"
  | "franchise"
  | "movie"
  | "composer";

// A person/studio/collection/etc. the user mentioned in a take. `tmdbId` is set when
// the mention was matched against the movie's known TMDB metadata (services/genres.ts
// roster); LLM-extracted extras (characters, other movies) usually carry none.
export interface TakeEntity {
  type: TakeEntityType;
  name: string;
  tmdbId?: number;
  confidence: number; // 0..1 — 1 exact text match … lower for fuzzy/LLM guesses
}

// The fixed topic taxonomy — WHAT the user discusses. Aliases are folded in by the
// classifier (soundtrack→music, cinematography/CGI→visuals, villain→characters).
export const TAKE_TOPICS = [
  "acting",
  "story",
  "ending",
  "visuals",
  "music",
  "pacing",
  "humor",
  "world-building",
  "characters",
  "dialogue",
  "emotional-impact",
] as const;
export type TakeTopicId = (typeof TAKE_TOPICS)[number];

// Sentiment is only ever ATTACHED to a topic (Bryan unlocked this 2026-07-16 once
// topics existed — "praised the score, criticized the pacing", never a bare mood).
export type TopicStance = "praised" | "criticized" | "mixed" | "neutral";

// Time spent talking about one topic within a take. `seconds` comes from segment
// timestamps; `share` is seconds / total attributed seconds. THE core memory signal.
// `stance` is absent on takes enriched before 3f (treat as "neutral").
export interface TakeTopic {
  topic: TakeTopicId;
  share: number;
  seconds: number;
  stance?: TopicStance;
}

export interface Take {
  id: number;
  movie_id: number;
  movie_title: string;
  poster_path: string | null;
  kind: string; // 'voice' (later: 'text')
  audio_uri: string | null;
  duration_ms: number;
  transcript: string | null; // flat text; null until transcription lands
  is_spoiler: number; // 0 | 1 — flagged from the capture menu's "Mark as spoiler"
  tags: string | null; // JSON array of tag strings, or null
  title: string | null; // user-given name, set from the ENTRIES tab (null = show the date)
  created_at: number;
  // Enrichment payloads — JSON-in-TEXT (same convention as `tags`); parse with the
  // parseTake* helpers below.
  transcript_segments: string | null; // JSON TranscriptSegment[]
  entities: string | null; //            JSON TakeEntity[]
  topics: string | null; //              JSON TakeTopic[]
  summary: string | null; //             one-sentence memory summary (indexing, not prose)
  enrich_status: EnrichStatus;
  enriched_at: number | null; //         epoch ms of the LLM pass
  enrich_model: string | null; //        model id that produced entities/topics/summary
  enrich_error: string | null; //        last failure, for debugging/retry visibility
  enrich_attempts: number; //            failed attempts so far (queue caps retries)
  insighted_at: number | null; //        epoch ms the insight stage ran (null = still owed)
  spoken_rating: number | null; //       rating the user SAID (0–10, normalized); null = none stated
  off_topic: number | null; //           1 = extraction flagged it as not about this movie (keep-or-delete)
}

// One stored embedding per take (Phase 3e). Vector is JSON number[] — searched
// with JS cosine on-device; migrates to sqlite-vec only at the dev-build gate.
export interface TakeEmbedding {
  take_id: number;
  model: string;
  dims: number;
  vector: string; // JSON number[]
}

// An opinion-arc note generated when a new take resonates with past ones
// ("two weeks ago X bothered you; tonight you called it a masterpiece").
export type InsightArcType = "shift" | "deepening" | "pattern";

export interface Insight {
  id: number;
  take_id: number;
  insight_text: string;
  related_take_ids: string; // JSON number[] — the prior takes it drew on
  model: string;
  created_at: number;
  arc_type: InsightArcType | null; // null on pre-3f rows
}

// Safe accessors for the JSON-in-TEXT payloads (bad JSON → null, never a throw).
const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};
export const parseTakeSegments = (t: Take): TranscriptSegment[] | null =>
  parseJson<TranscriptSegment[]>(t.transcript_segments);
export const parseTakeEntities = (t: Take): TakeEntity[] | null =>
  parseJson<TakeEntity[]>(t.entities);
export const parseTakeTopics = (t: Take): TakeTopic[] | null => parseJson<TakeTopic[]>(t.topics);

export interface NewTake {
  movie_id: number;
  movie_title: string;
  poster_path: string | null;
  audio_uri: string | null;
  duration_ms: number;
  kind?: string;
  is_spoiler?: boolean;
  tags?: string[];
}

export const addTake = async (take: NewTake): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO takes (movie_id, movie_title, poster_path, kind, audio_uri, duration_ms, is_spoiler, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      take.movie_id,
      take.movie_title,
      take.poster_path,
      take.kind ?? "voice",
      take.audio_uri,
      take.duration_ms,
      take.is_spoiler ? 1 : 0,
      take.tags && take.tags.length ? JSON.stringify(take.tags) : null,
      Date.now(),
    ]
  );
};

// All takes (newest first), or just one movie's when `movieId` is given.
export const getTakes = async (movieId?: number): Promise<Take[]> => {
  const db = await getDb();
  if (movieId !== undefined) {
    return db.getAllAsync<Take>(
      "SELECT * FROM takes WHERE movie_id = ? ORDER BY created_at DESC",
      [movieId]
    );
  }
  return db.getAllAsync<Take>("SELECT * FROM takes ORDER BY created_at DESC");
};

// DEV-PHASE FULL RESET: remove every take row AND its audio file. Favorites are
// untouched. Only reachable through the guarded EXPO_PUBLIC_DEV_WIPE_TAKES flow
// in services/enrichment.ts — never called from product UI.
export const deleteAllTakes = async (): Promise<number> => {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; audio_uri: string | null }>(
    "SELECT id, audio_uri FROM takes"
  );
  await db.runAsync("DELETE FROM takes");
  await db.runAsync("DELETE FROM take_embeddings");
  await db.runAsync("DELETE FROM insights");
  for (const r of rows) deleteTakeAudio(r.audio_uri);
  return rows.length;
};

export const deleteTake = async (id: number): Promise<void> => {
  const db = await getDb();
  // Audio files in our permanent dir go with the row (temp URIs are the OS's);
  // embeddings and insights are derived data and go with it too.
  const row = await db.getFirstAsync<{ audio_uri: string | null }>(
    "SELECT audio_uri FROM takes WHERE id = ?",
    [id]
  );
  await db.runAsync("DELETE FROM takes WHERE id = ?", [id]);
  await db.runAsync("DELETE FROM take_embeddings WHERE take_id = ?", [id]);
  await db.runAsync("DELETE FROM insights WHERE take_id = ?", [id]);
  deleteTakeAudio(row?.audio_uri);
};

// Rename a take from the ENTRIES tab. Null clears the title (row falls back to its date).
export const updateTakeTitle = async (id: number, title: string | null): Promise<void> => {
  const db = await getDb();
  await db.runAsync("UPDATE takes SET title = ? WHERE id = ?", [title, id]);
};

// Toggle a take's spoiler flag from the ENTRIES tab (spoiler marking lives there now,
// not in the capture flow).
export const updateTakeSpoiler = async (id: number, isSpoiler: boolean): Promise<void> => {
  const db = await getDb();
  await db.runAsync("UPDATE takes SET is_spoiler = ? WHERE id = ?", [isSpoiler ? 1 : 0, id]);
};

// ── Enrichment pipeline writes (driven by services/enrichment.ts) ─────────────

// Point a take at its rescued/moved audio file (legacy temp-URI sweep).
export const updateTakeAudioUri = async (id: number, uri: string): Promise<void> => {
  const db = await getDb();
  await db.runAsync("UPDATE takes SET audio_uri = ? WHERE id = ?", [uri, id]);
};

// Terminal state for legacy takes whose temp audio died before it could be
// transcribed. The row (and its metadata) stays; there's just nothing to play/enrich.
export const markTakeAudioMissing = async (id: number): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    "UPDATE takes SET enrich_status = 'audio_missing', enrich_error = NULL WHERE id = ?",
    [id]
  );
};

// ── The vault (what Search needs to know about your own library) ─────────────
// One row per film you have written about, with how many takes it holds.
//
// This backs two things at once and is queried as ONE statement for that reason:
//   · the entry star — a film is starred when it appears here at all;
//   · the sub-4-character path — below the TMDB floor we prefix-match this list
//     instead of spending a request that cannot return the right answer anyway.
export interface VaultFilm {
  movie_id: number;
  movie_title: string;
  take_count: number;
  last_take_at: number;
}

// MAX(created_at) sits in the SELECT list, not just the ORDER BY, deliberately:
// with exactly one min/max aggregate present SQLite defines the bare `movie_title`
// as coming from THAT row, so the title is the most recent one rather than an
// arbitrary pick from the group.
export const getVaultFilms = async (): Promise<VaultFilm[]> => {
  const db = await getDb();
  return db.getAllAsync<VaultFilm>(
    `SELECT movie_id, movie_title, COUNT(*) AS take_count, MAX(created_at) AS last_take_at
       FROM takes
      GROUP BY movie_id
      ORDER BY last_take_at DESC`
  );
};

// Stage 1 output: flat transcript + timestamped segments → status 'transcribed'.
export const updateTakeTranscript = async (
  id: number,
  transcript: string,
  segments: TranscriptSegment[]
): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    "UPDATE takes SET transcript = ?, transcript_segments = ?, enrich_status = 'transcribed', enrich_error = NULL WHERE id = ?",
    [transcript, JSON.stringify(segments), id]
  );
};

// Stage 2 output: entities + topics + summary (+ spoken rating) → status 'enriched'.
export const updateTakeEnrichment = async (
  id: number,
  data: {
    entities: TakeEntity[];
    topics: TakeTopic[];
    summary: string;
    model: string;
    spokenRating: number | null;
    offTopic: boolean;
  }
): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    `UPDATE takes SET entities = ?, topics = ?, summary = ?, enrich_model = ?,
       spoken_rating = ?, off_topic = ?, enriched_at = ?, enrich_status = 'enriched', enrich_error = NULL
     WHERE id = ?`,
    [
      JSON.stringify(data.entities),
      JSON.stringify(data.topics),
      data.summary,
      data.model,
      data.spokenRating,
      data.offTopic ? 1 : 0,
      Date.now(),
      id,
    ]
  );
};

// The user vouched for a flagged take — clear the off-topic mark for good, so the
// keep-or-delete question is asked exactly once.
export const clearTakeOffTopic = async (id: number): Promise<void> => {
  const db = await getDb();
  await db.runAsync(`UPDATE takes SET off_topic = 0 WHERE id = ?`, [id]);
};

// 3f reprocess: clear the LLM-derived fields on transcribed takes so the queue
// re-extracts with the current schema/prompt. Transcripts, embeddings, insights,
// and insighted_at all survive — only stage 2 re-runs. Returns affected count.
export const resetEnrichmentForReprocess = async (): Promise<number> => {
  const db = await getDb();
  const result = await db.runAsync(
    `UPDATE takes SET entities = NULL, topics = NULL, summary = NULL,
       spoken_rating = NULL, enriched_at = NULL, enrich_model = NULL,
       enrich_error = NULL, enrich_attempts = 0, enrich_status = 'transcribed'
     WHERE transcript IS NOT NULL AND enrich_status IN ('enriched', 'failed')`
  );
  return result.changes ?? 0;
};

// Any stage failed: record why and bump the attempt counter. Transcript (if stage 1
// already succeeded) is kept, so the retry resumes at the LLM stage, not from scratch.
export const markTakeEnrichFailure = async (id: number, error: string): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    "UPDATE takes SET enrich_status = 'failed', enrich_error = ?, enrich_attempts = enrich_attempts + 1 WHERE id = ?",
    [error.slice(0, 500), id]
  );
};

// The work queue: everything not yet fully processed and not permanently parked,
// oldest first so the backlog drains in capture order. Enriched takes re-enter
// when they still owe an embedding or the insight stage (field/row-derived, so
// backfill of pre-3e takes happens automatically) — EXCEPT takes flagged
// off-topic: those stop costing anything the moment they're flagged. If the user
// rules KEEP IT (off_topic → 0), this same clause naturally re-admits them for
// the stages they skipped. `maxAttempts` stops retry storms on takes that will
// never succeed (corrupt file, hard 4xx).
export const getTakesForEnrichment = async (maxAttempts: number): Promise<Take[]> => {
  const db = await getDb();
  return db.getAllAsync<Take>(
    `SELECT t.* FROM takes t
      LEFT JOIN take_embeddings e ON e.take_id = t.id
      WHERE (
        t.enrich_status IN ('pending', 'transcribed', 'failed')
        OR (
          t.enrich_status = 'enriched'
          AND (t.off_topic IS NULL OR t.off_topic = 0)
          AND (e.take_id IS NULL OR t.insighted_at IS NULL)
        )
      )
        AND t.enrich_attempts < ?
      ORDER BY t.created_at ASC`,
    [maxAttempts]
  );
};

// ── Embeddings + insights (Phase 3e) ──────────────────────────────────────────

export const upsertTakeEmbedding = async (
  takeId: number,
  model: string,
  vector: number[]
): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO take_embeddings (take_id, model, dims, vector, created_at) VALUES (?, ?, ?, ?, ?)",
    [takeId, model, vector.length, JSON.stringify(vector), Date.now()]
  );
};

export const hasTakeEmbedding = async (takeId: number): Promise<boolean> => {
  const db = await getDb();
  const row = await db.getFirstAsync<{ take_id: number }>(
    "SELECT take_id FROM take_embeddings WHERE take_id = ?",
    [takeId]
  );
  return !!row;
};

// The whole vector corpus — journal scale (hundreds–low-thousands) makes loading
// it all and scoring in JS a milliseconds job; sqlite-vec waits for the dev-build gate.
export const getAllTakeEmbeddings = async (): Promise<TakeEmbedding[]> => {
  const db = await getDb();
  return db.getAllAsync<TakeEmbedding>(
    "SELECT take_id, model, dims, vector FROM take_embeddings"
  );
};

export const markTakeInsighted = async (id: number): Promise<void> => {
  const db = await getDb();
  await db.runAsync("UPDATE takes SET insighted_at = ? WHERE id = ?", [Date.now(), id]);
};

export const addInsight = async (data: {
  take_id: number;
  insight_text: string;
  related_take_ids: number[];
  model: string;
  arc_type: InsightArcType | null;
}): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO insights (take_id, insight_text, related_take_ids, model, created_at, arc_type) VALUES (?, ?, ?, ?, ?, ?)",
    [
      data.take_id,
      data.insight_text,
      JSON.stringify(data.related_take_ids),
      data.model,
      Date.now(),
      data.arc_type,
    ]
  );
};

// All insights (newest first), or just the ones attached to one take.
export const getInsights = async (takeId?: number): Promise<Insight[]> => {
  const db = await getDb();
  if (takeId !== undefined) {
    return db.getAllAsync<Insight>(
      "SELECT * FROM insights WHERE take_id = ? ORDER BY created_at DESC",
      [takeId]
    );
  }
  return db.getAllAsync<Insight>("SELECT * FROM insights ORDER BY created_at DESC");
};
