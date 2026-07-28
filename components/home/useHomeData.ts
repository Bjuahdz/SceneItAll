import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildFingerprint, type ArcMoment, type TasteFingerprint } from "@/services/fingerprint";
import {
  getTakes,
  parseTakeEntities,
  parseTakeTopics,
  type FavoriteMovie,
  type Take,
} from "@/services/db";
import { onEnrichmentChanged } from "@/services/enrichment";
import { getGenreBreakdown, getMovieMetas } from "@/services/genres";
import { useFavorites } from "@/contexts/FavoritesContext";
import {
  agoShort,
  fmtDur,
  hueForRank,
  EMPTY_SKY,
  EMPTY_CLOUD,
  type CloudData,
  type CloudTheme,
  type KindId,
  type SkyData,
  type SkyEdge,
  type SkyGenre,
  type SkyMovie,
} from "./skyModel";

// ─────────────────────────────────────────────────────────────────────────────
// The dashboard's data layer. Reads the fingerprint (never raw aggregation in
// the component tree) plus the takes list, resolves each film's genre through
// getMovieMetas, and shapes both the sky model and the ledger.
//
// Refresh contract (handoff §State management): load on mount AND inside
// onEnrichmentChanged — enrichment lands 30–90s after a save and the page must
// absorb it live. Nothing derived is cached beyond the session.
// ─────────────────────────────────────────────────────────────────────────────

export interface TimelineRow {
  takeId: number;
  title: string;
  hue: string;
  ago: string;
  distilling: boolean;
}

export interface LedgerData {
  films: number;
  takes: number;
  spoken: string; //     fmtDur(totalAttributedSeconds)
  nights: number; //     distinct calendar days across takes
  timeline: TimelineRow[];
  peak: { title: string; rating: number } | null;
  floor: { title: string; rating: number } | null;
  ratedCount: number;
  /** A specific saved film for the empty-state nudge (never a generic CTA). */
  nudgeFilm: string | null;
}

export interface HomeData {
  ready: boolean;
  cloud: CloudData;
  sky: SkyData;
  ledger: LedgerData;
  arcs: ArcMoment[];
  takes: Take[];
  fp: TasteFingerprint | null;
  /** Take id that just arrived/enriched — drives the one-shot absorb glow. */
  absorbTakeId: number | null;
}

const EMPTY_LEDGER: LedgerData = {
  films: 0,
  takes: 0,
  spoken: "0m",
  nights: 0,
  timeline: [],
  peak: null,
  floor: null,
  ratedCount: 0,
  nudgeFilm: null,
};

const yearOf = (fav: FavoriteMovie | undefined): string =>
  fav?.release_date ? fav.release_date.slice(0, 4) : "";

export function useHomeData(): HomeData {
  const { favorites } = useFavorites();
  const [ready, setReady] = useState(false);
  const [cloud, setCloud] = useState<CloudData>(EMPTY_CLOUD);
  const [sky, setSky] = useState<SkyData>(EMPTY_SKY);
  const [ledger, setLedger] = useState<LedgerData>(EMPTY_LEDGER);
  const [arcs, setArcs] = useState<ArcMoment[]>([]);
  const [takes, setTakes] = useState<Take[]>([]);
  const [fp, setFp] = useState<TasteFingerprint | null>(null);
  const [absorbTakeId, setAbsorbTakeId] = useState<number | null>(null);

  const favsRef = useRef(favorites);
  favsRef.current = favorites;
  const seenRef = useRef<Set<number> | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [nextFp, allTakes] = await Promise.all([buildFingerprint(), getTakes()]);
      if (!aliveRef.current) return;

      const favById = new Map(favsRef.current.map((f) => [f.id, f]));
      const movieIds = Array.from(new Set(allTakes.map((t) => t.movie_id)));

      // Genre resolution: the breakdown gives ranked genre names; the metas give
      // each film's primary TMDB genre. A film belongs to exactly ONE nebula.
      // Only the genre HUES need TMDB; the ledger, crown and receipts are pure
      // local data. A network failure must never blank the whole dashboard, so
      // the breakdown degrades to a single unsorted nebula instead of throwing.
      const [breakdown, metas] = await Promise.all([
        movieIds.length
          ? getGenreBreakdown(movieIds, Math.max(40, movieIds.length)).catch(() => [])
          : Promise.resolve([]),
        movieIds.length ? getMovieMetas(movieIds) : Promise.resolve(new Map()),
      ]);
      if (!aliveRef.current) return;

      const rankByGenreId = new Map<number, number>();
      breakdown.forEach((g, i) => rankByGenreId.set(g.id, i));

      const genreIndexOf = (movieId: number): number => {
        const primary = metas.get(movieId)?.genreIds?.[0];
        if (primary != null && rankByGenreId.has(primary)) return rankByGenreId.get(primary)!;
        // fall back to the highest-ranked breakdown genre that contains the film
        for (let i = 0; i < breakdown.length; i++) {
          if (breakdown[i].movieIds.includes(movieId)) return i;
        }
        return 0;
      };

      // Per-movie roll-ups from the takes list.
      const takeCountBy = new Map<number, number>();
      const titleBy = new Map<number, string>();
      const posterBy = new Map<number, string | null>();
      for (const t of allTakes) {
        takeCountBy.set(t.movie_id, (takeCountBy.get(t.movie_id) ?? 0) + 1);
        if (!titleBy.has(t.movie_id)) titleBy.set(t.movie_id, t.movie_title);
        if (!posterBy.has(t.movie_id)) posterBy.set(t.movie_id, t.poster_path);
      }
      const ratingBy = new Map(nextFp.ratings.map((r) => [r.movieId, r.rating]));

      // ---- sky model input ----
      const assigned = new Map<number, number>(); // movieId → genre rank
      movieIds.forEach((id) => assigned.set(id, genreIndexOf(id)));

      const usedRanks = Array.from(new Set(Array.from(assigned.values()))).sort((a, b) => a - b);
      const genres: SkyGenre[] = usedRanks.map((rank) => {
        const members = movieIds.filter((id) => assigned.get(id) === rank);
        const rs = members.map((id) => ratingBy.get(id)).filter((r): r is number => r != null);
        return {
          key: breakdown[rank]?.name ?? `genre-${rank}`,
          label: breakdown[rank]?.name ?? "Unsorted",
          hue: hueForRank(rank),
          n: members.length,
          avg: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
        };
      });
      const keyByRank = new Map(usedRanks.map((rank, i) => [rank, genres[i].key]));

      const movies: SkyMovie[] = movieIds.map((id) => {
        const fav = favById.get(id);
        return {
          id,
          genreKey: keyByRank.get(assigned.get(id) ?? 0) ?? genres[0]?.key ?? "",
          takeCount: takeCountBy.get(id) ?? 0,
          rated: ratingBy.has(id),
          title: titleBy.get(id) ?? fav?.title ?? "Untitled",
          year: yearOf(fav),
          rating: ratingBy.get(id) ?? null,
          posterPath: posterBy.get(id) ?? fav?.poster_path ?? null,
        };
      });

      const inSky = new Set(movieIds);
      const edges: SkyEdge[] = nextFp.edges
        .filter((e) => inSky.has(e.aMovieId) && inSky.has(e.bMovieId) && e.reasons.length > 0)
        .map((e) => ({
          a: e.aMovieId,
          b: e.bMovieId,
          type: e.reasons[0].type as KindId, // 'outlier' has no fp source today
          label: e.reasons[0].label,
          strength: e.strength,
        }));

      // ---- ledger ----
      const nights = new Set(allTakes.map((t) => new Date(t.created_at).toDateString())).size;
      const timeline: TimelineRow[] = allTakes.slice(0, 3).map((t) => ({
        takeId: t.id,
        title: t.title ?? t.movie_title,
        hue: hueForRank(assigned.get(t.movie_id) ?? 0),
        ago: agoShort(t.created_at),
        distilling: t.enrich_status !== "enriched",
      }));

      const rated = [...nextFp.ratings].sort((a, b) => b.rating - a.rating);
      const peak = rated.length ? { title: rated[0].movieTitle, rating: rated[0].rating } : null;
      const floor =
        rated.length > 1
          ? { title: rated[rated.length - 1].movieTitle, rating: rated[rated.length - 1].rating }
          : null;

      const untouched = favsRef.current.find((f) => !inSky.has(f.id));

      // ---- live absorb: flag a take we haven't rendered before ----
      const ids = new Set(allTakes.map((t) => t.id));
      if (seenRef.current) {
        const fresh = allTakes.find((t) => !seenRef.current!.has(t.id));
        if (fresh) setAbsorbTakeId(fresh.id);
      }
      seenRef.current = ids;

      // ---- cloudbank themes (reference §10): one opinion arc → one theme ----
      // The fingerprint ships no pre-named themes, so the label is the arc's
      // TYPE and the body is arc.text VERBATIM. Each film is claimed by the
      // first (newest) arc that mentions it.
      const movieOfTake = new Map(allTakes.map((t) => [t.id, t.movie_id]));
      const takeById = new Map(allTakes.map((t) => [t.id, t]));

      // A personalised title for each theme, derived deterministically from what
      // the user actually talked about (never a model call): the arc's takes'
      // dominant TOPIC by seconds, else the person they share, else the type.
      const titleForArc = (a: (typeof nextFp.arcs)[number]): string => {
        const ids = [a.takeId, ...a.relatedTakeIds];
        const secondsByTopic = new Map<string, number>();
        const takesByEntity = new Map<string, number>();
        for (const id of ids) {
          const tk = takeById.get(id);
          if (!tk) continue;
          for (const tp of parseTakeTopics(tk) ?? []) {
            secondsByTopic.set(tp.topic, (secondsByTopic.get(tp.topic) ?? 0) + tp.seconds);
          }
          const seen = new Set<string>();
          for (const e of parseTakeEntities(tk) ?? []) {
            if (e.confidence < 0.7) continue; // tentative matches don't get to name a theme
            if (e.type !== "director" && e.type !== "actor" && e.type !== "composer") continue;
            if (seen.has(e.name)) continue;
            seen.add(e.name);
            takesByEntity.set(e.name, (takesByEntity.get(e.name) ?? 0) + 1);
          }
        }
        // A person the arc genuinely spans reads better than a topic.
        let bestPerson: string | null = null;
        let bestCount = 1;
        for (const [name, n] of takesByEntity) {
          if (n > bestCount) {
            bestCount = n;
            bestPerson = name;
          }
        }
        if (bestPerson) return bestPerson.toUpperCase();
        let bestTopic: string | null = null;
        let bestSecs = 0;
        for (const [topic, secs] of secondsByTopic) {
          if (secs > bestSecs) {
            bestSecs = secs;
            bestTopic = topic;
          }
        }
        if (bestTopic) return bestTopic.replace(/-/g, " ").toUpperCase();
        return a.arcType ? a.arcType.toUpperCase() : "CONNECTION";
      };

      const themes: CloudTheme[] = nextFp.arcs.map((a, i) => {
        const related = a.relatedTakeIds
          .map((tid) => movieOfTake.get(tid))
          .filter((m): m is number => m != null);
        const memberIds = Array.from(new Set([a.movieId, ...related]));
        return {
          name: titleForArc(a),
          kind: (a.arcType ?? "connection").toUpperCase(),
          insight: a.text,
          hue: hueForRank(assigned.get(a.movieId) ?? 0),
          memberIds,
          cites: a.relatedTakeIds.length + 1,
          arcIndex: i,
        };
      });
      const claim: Record<number, number> = {};
      themes.forEach((th, ti) =>
        th.memberIds.forEach((id) => {
          if (claim[id] == null) claim[id] = ti;
        })
      );
      const cloudMovies = Array.from(new Set(themes.flatMap((th) => th.memberIds))).map((id) => ({
        id,
        takeCount: takeCountBy.get(id) ?? 1,
      }));

      setFp(nextFp);
      setTakes(allTakes);
      setArcs(nextFp.arcs);
      setCloud({ themes, movies: cloudMovies, claim });
      setSky({ genres, movies, edges });
      setLedger({
        films: nextFp.movieCount,
        takes: nextFp.takeCount,
        spoken: fmtDur(nextFp.totalAttributedSeconds),
        nights,
        timeline,
        peak,
        floor,
        ratedCount: nextFp.ratings.length,
        nudgeFilm: untouched?.title ?? null,
      });
      setReady(true);
    } catch (e) {
      console.error("Home data refresh failed:", e);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  // Re-read whenever the pipeline writes (the movie-detail sheet's pattern).
  useEffect(() => onEnrichmentChanged(refresh), [refresh]);

  // Favourites changing can add posters/years/nudge targets.
  const favKey = useMemo(() => favorites.map((f) => f.id).join(","), [favorites]);
  useEffect(() => {
    if (ready) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favKey]);

  // The absorb glow is one-shot.
  useEffect(() => {
    if (absorbTakeId == null) return;
    const id = setTimeout(() => setAbsorbTakeId(null), 1600);
    return () => clearTimeout(id);
  }, [absorbTakeId]);

  return { ready, cloud, sky, ledger, arcs, takes, fp, absorbTakeId };
}
