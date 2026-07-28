// ─────────────────────────────────────────────────────────────────────────────
// The taste fingerprint (Phase 3f) — the dashboard's data API.
//
// Screens never aggregate raw rows themselves: this module turns takes +
// insights + embeddings into ready-to-render fingerprint objects, entirely
// deterministically (no LLM, no network). Every field maps to a dashboard
// sentence: topics → "you keep talking about endings", people → "12 thoughts
// about Nolan films", ratings → "you called it a 10", arcs → the insight feed,
// edges → the constellation's evidence-backed lines.
//
// `computeFingerprint` is pure over plain inputs (Node-smoke-testable);
// `buildFingerprint` is the thin DB-backed loader screens actually call.
// ─────────────────────────────────────────────────────────────────────────────
import { cosineSimilarity } from "./retrieval";
import {
  getAllTakeEmbeddings,
  getInsights,
  getTakes,
  parseTakeEntities,
  parseTakeTopics,
  type InsightArcType,
  type TakeEntity,
  type TakeTopic,
  type TakeTopicId,
  type TopicStance,
} from "./db";

// ── Pure input shapes (pre-parsed rows) ───────────────────────────────────────
export interface FingerprintTakeInput {
  id: number;
  movie_id: number;
  movie_title: string;
  created_at: number;
  spoken_rating: number | null;
  entities: TakeEntity[] | null;
  topics: TakeTopic[] | null;
}

export interface FingerprintInsightInput {
  take_id: number;
  insight_text: string;
  arc_type: InsightArcType | null;
  created_at: number;
  related_take_ids: number[];
}

export interface FingerprintInput {
  takes: FingerprintTakeInput[];
  insights: FingerprintInsightInput[];
  vectors: { takeId: number; vector: number[] }[];
}

// ── Output shapes ─────────────────────────────────────────────────────────────
export interface TopicAggregate {
  topic: TakeTopicId;
  seconds: number; //   total across the journal
  share: number; //     of all attributed seconds
  stance: TopicStance; // seconds-weighted attitude across takes
  takeCount: number;
}

export interface PersonAggregate {
  name: string;
  tmdbId: number | null;
  type: string; //      director | actor | composer
  takeCount: number;
  movieCount: number;
  lastMentionedAt: number;
}

export interface MovieRatingAggregate {
  movieId: number;
  movieTitle: string;
  rating: number; //    latest spoken rating (0–10)
  at: number;
}

export interface ArcMoment {
  takeId: number;
  movieId: number;
  movieTitle: string;
  arcType: InsightArcType | null;
  text: string;
  createdAt: number;
  relatedTakeIds: number[];
}

export type EdgeReasonType = "insight" | "person" | "similar";
export interface MovieEdge {
  aMovieId: number;
  bMovieId: number;
  reasons: { type: EdgeReasonType; label: string }[];
  strength: number; // 0..~3, for line weight / pruning
}

export interface TasteFingerprint {
  takeCount: number;
  movieCount: number;
  totalAttributedSeconds: number;
  topics: TopicAggregate[]; //   seconds desc
  people: PersonAggregate[]; //  takeCount desc
  ratings: MovieRatingAggregate[]; // newest first
  arcs: ArcMoment[]; //          newest first
  edges: MovieEdge[]; //         strength desc, capped
}

const PERSON_TYPES = new Set(["director", "actor", "composer"]);
const SIMILAR_EDGE_MIN = 0.5;
const MAX_EDGES = 50;

// Seconds-weighted stance across takes: strongly one-sided → that side; genuine
// conflict → mixed; no attitude anywhere → neutral. "mixed" votes feed both sides.
const aggregateStance = (praised: number, criticized: number, mixed: number): TopicStance => {
  const p = praised + mixed / 2;
  const c = criticized + mixed / 2;
  if (p <= 0 && c <= 0) return "neutral";
  if (p >= c * 3) return "praised";
  if (c >= p * 3) return "criticized";
  return "mixed";
};

export const computeFingerprint = (input: FingerprintInput): TasteFingerprint => {
  const { takes, insights, vectors } = input;
  const takeById = new Map(takes.map((t) => [t.id, t]));

  // ── Topics ──
  const topicAcc = new Map<
    TakeTopicId,
    { seconds: number; praised: number; criticized: number; mixed: number; takes: Set<number> }
  >();
  let totalSeconds = 0;
  for (const t of takes) {
    for (const tt of t.topics ?? []) {
      const acc =
        topicAcc.get(tt.topic) ??
        { seconds: 0, praised: 0, criticized: 0, mixed: 0, takes: new Set<number>() };
      acc.seconds += tt.seconds;
      acc.takes.add(t.id);
      const stance = tt.stance ?? "neutral";
      if (stance === "praised") acc.praised += tt.seconds;
      else if (stance === "criticized") acc.criticized += tt.seconds;
      else if (stance === "mixed") acc.mixed += tt.seconds;
      topicAcc.set(tt.topic, acc);
      totalSeconds += tt.seconds;
    }
  }
  const topics: TopicAggregate[] = Array.from(topicAcc.entries())
    .map(([topic, a]) => ({
      topic,
      seconds: Math.round(a.seconds * 10) / 10,
      share: totalSeconds > 0 ? Math.round((a.seconds / totalSeconds) * 1000) / 1000 : 0,
      stance: aggregateStance(a.praised, a.criticized, a.mixed),
      takeCount: a.takes.size,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  // ── People (real people only — characters have no ids and are per-film) ──
  const personAcc = new Map<
    string,
    { name: string; tmdbId: number | null; type: string; takes: Set<number>; movies: Set<number>; last: number }
  >();
  for (const t of takes) {
    for (const e of t.entities ?? []) {
      if (!PERSON_TYPES.has(e.type)) continue;
      const key = e.tmdbId != null ? `id:${e.tmdbId}` : `name:${e.name.toLowerCase()}`;
      const acc =
        personAcc.get(key) ??
        { name: e.name, tmdbId: e.tmdbId ?? null, type: e.type, takes: new Set<number>(), movies: new Set<number>(), last: 0 };
      acc.takes.add(t.id);
      acc.movies.add(t.movie_id);
      acc.last = Math.max(acc.last, t.created_at);
      personAcc.set(key, acc);
    }
  }
  const people: PersonAggregate[] = Array.from(personAcc.values())
    .map((a) => ({
      name: a.name,
      tmdbId: a.tmdbId,
      type: a.type,
      takeCount: a.takes.size,
      movieCount: a.movies.size,
      lastMentionedAt: a.last,
    }))
    .sort((a, b) => b.takeCount - a.takeCount || b.lastMentionedAt - a.lastMentionedAt);

  // ── Ratings (latest spoken rating per movie) ──
  const ratingByMovie = new Map<number, MovieRatingAggregate>();
  for (const t of takes) {
    if (t.spoken_rating == null) continue;
    const cur = ratingByMovie.get(t.movie_id);
    if (!cur || t.created_at > cur.at) {
      ratingByMovie.set(t.movie_id, {
        movieId: t.movie_id,
        movieTitle: t.movie_title,
        rating: t.spoken_rating,
        at: t.created_at,
      });
    }
  }
  const ratings = Array.from(ratingByMovie.values()).sort((a, b) => b.at - a.at);

  // ── Arc feed ──
  const arcs: ArcMoment[] = insights
    .map((i) => {
      const t = takeById.get(i.take_id);
      return t
        ? {
            takeId: i.take_id,
            movieId: t.movie_id,
            movieTitle: t.movie_title,
            arcType: i.arc_type,
            text: i.insight_text,
            createdAt: i.created_at,
            relatedTakeIds: i.related_take_ids,
          }
        : null;
    })
    .filter((a): a is ArcMoment => a !== null)
    .sort((a, b) => b.createdAt - a.createdAt);

  // ── Edges (cross-movie only — the constellation's evidence-backed lines) ──
  const edgeAcc = new Map<string, MovieEdge>();
  const addReason = (
    movieA: number,
    movieB: number,
    reason: { type: EdgeReasonType; label: string },
    weight: number
  ): void => {
    if (movieA === movieB) return;
    const [a, b] = movieA < movieB ? [movieA, movieB] : [movieB, movieA];
    const key = `${a}:${b}`;
    const edge = edgeAcc.get(key) ?? { aMovieId: a, bMovieId: b, reasons: [], strength: 0 };
    if (!edge.reasons.some((r) => r.type === reason.type && r.label === reason.label)) {
      edge.reasons.push(reason);
      edge.strength = Math.min(3, edge.strength + weight);
    }
    edgeAcc.set(key, edge);
  };

  // insight edges — the AI explicitly drew these from the user's own words
  for (const i of insights) {
    const t = takeById.get(i.take_id);
    if (!t) continue;
    for (const rid of i.related_take_ids) {
      const r = takeById.get(rid);
      if (r) addReason(t.movie_id, r.movie_id, { type: "insight", label: i.arc_type ?? "connection" }, 1);
    }
  }
  // person edges — same real person discussed on both films
  const personMovies = new Map<string, { name: string; movies: Set<number> }>();
  for (const t of takes) {
    for (const e of t.entities ?? []) {
      if (!PERSON_TYPES.has(e.type) || e.tmdbId == null) continue;
      const key = `id:${e.tmdbId}`;
      const acc = personMovies.get(key) ?? { name: e.name, movies: new Set<number>() };
      acc.movies.add(t.movie_id);
      personMovies.set(key, acc);
    }
  }
  for (const { name, movies } of personMovies.values()) {
    const ids = Array.from(movies);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        addReason(ids[i], ids[j], { type: "person", label: name }, 0.6);
      }
    }
  }
  // similarity edges — the user talks about these films the same way
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const ta = takeById.get(vectors[i].takeId);
      const tb = takeById.get(vectors[j].takeId);
      if (!ta || !tb || ta.movie_id === tb.movie_id) continue;
      const score = cosineSimilarity(vectors[i].vector, vectors[j].vector);
      if (score >= SIMILAR_EDGE_MIN) {
        addReason(ta.movie_id, tb.movie_id, { type: "similar", label: "talked about alike" }, score * 0.8);
      }
    }
  }
  const edges = Array.from(edgeAcc.values())
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_EDGES);

  return {
    takeCount: takes.length,
    movieCount: new Set(takes.map((t) => t.movie_id)).size,
    totalAttributedSeconds: Math.round(totalSeconds * 10) / 10,
    topics,
    people,
    ratings,
    arcs,
    edges,
  };
};

// ── DB-backed loader — what screens actually call ─────────────────────────────
const parseIds = (raw: string): number[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
};

const parseVec = (raw: string): number[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export const buildFingerprint = async (): Promise<TasteFingerprint> => {
  const [takes, insights, embeddings] = await Promise.all([
    getTakes(),
    getInsights(),
    getAllTakeEmbeddings(),
  ]);
  return computeFingerprint({
    takes: takes.map((t) => ({
      id: t.id,
      movie_id: t.movie_id,
      movie_title: t.movie_title,
      created_at: t.created_at,
      spoken_rating: t.spoken_rating,
      entities: parseTakeEntities(t),
      topics: parseTakeTopics(t),
    })),
    insights: insights.map((i) => ({
      take_id: i.take_id,
      insight_text: i.insight_text,
      arc_type: i.arc_type,
      created_at: i.created_at,
      related_take_ids: parseIds(i.related_take_ids),
    })),
    vectors: embeddings.map((e) => ({ takeId: e.take_id, vector: parseVec(e.vector) })),
  });
};
