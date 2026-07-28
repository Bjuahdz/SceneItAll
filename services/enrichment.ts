// ─────────────────────────────────────────────────────────────────────────────
// The enrichment queue (Phase 3 orchestrator).
//
// Capture stays offline-instant; this queue does everything after the fact:
//
//   pending ──(transcription API)──▶ transcribed ──(Claude)──▶ enriched
//      └──────────── failed (retries, capped) ────────────┘
//
// Stage is derived from the ROW, not stored: no transcript → transcribe;
// transcript but no enrichment → LLM. Retries are therefore idempotent — a
// failure resumes exactly where it stopped, never re-doing (or re-billing)
// finished work. All writes go through services/db.ts.
//
// Triggers: app launch (init), app → foreground, network reconnect, and a kick
// right after each save. Missing API keys park work quietly ('pending' /
// 'transcribed' keep queueing until the key shows up); transport errors stop
// the run WITHOUT burning an attempt — only real provider failures count
// toward MAX_ATTEMPTS.
//
// init also runs the Phase 0 legacy sweep: takes recorded before permanent
// storage landed still point at recorder temp URIs — rescue the file if it's
// alive, mark the take 'audio_missing' (terminal, never crashes) if not.
// ─────────────────────────────────────────────────────────────────────────────
import { AppState } from "react-native";
import * as Network from "expo-network";

import {
  addInsight,
  deleteAllTakes,
  getAllTakeEmbeddings,
  resetEnrichmentForReprocess,
  getTakes,
  getTakesForEnrichment,
  hasTakeEmbedding,
  markTakeAudioMissing,
  markTakeEnrichFailure,
  markTakeInsighted,
  parseTakeSegments,
  updateTakeAudioUri,
  updateTakeEnrichment,
  updateTakeSpoiler,
  updateTakeTranscript,
  upsertTakeEmbedding,
  type Take,
} from "./db";
import { enrichTranscript, isClaudeConfigured } from "./claude";
import { embedText, isEmbeddingConfigured } from "./embeddings";
import { matchRosterInTranscript, mergeWithLlmEntities } from "./entityMatch";
import { getMovieMetas } from "./genres";
import { generateInsight } from "./insight";
import { rankBySimilarity } from "./retrieval";
import {
  devMarkerExists,
  isPersistedTakeUri,
  rescueTakeAudio,
  takeAudioExists,
  wipeMarkerExists,
  writeDevMarker,
  writeWipeMarker,
} from "./takeFiles";
import { computeTopics } from "./topics";
import { getTranscriptionProvider, transcribeTakeAudio } from "./transcription";

// A take that keeps failing for real (corrupt file, hard 4xx) stops being retried
// after this many recorded failures. Transport blips don't count.
const MAX_ATTEMPTS = 8;

// ── Change notifications — screens re-read takes when enrichment writes land ──
type Listener = () => void;
const listeners = new Set<Listener>();
export const onEnrichmentChanged = (cb: Listener): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
// Exported so a full dev wipe (Settings → Delete all takes) can wake every open
// entries list / star / progress bar the same way the pipeline does.
export const emitChanged = (): void => {
  for (const cb of listeners) {
    try {
      cb();
    } catch (e) {
      console.warn("enrichment: listener threw:", e);
    }
  }
};

// ── Legacy audio sweep (Phase 0 migration) ────────────────────────────────────
const sweepLegacyAudio = async (): Promise<void> => {
  const takes = await getTakes();
  let changed = false;
  for (const t of takes) {
    if (t.kind !== "voice" || t.enrich_status === "audio_missing") continue;

    if (!t.audio_uri) {
      // Nothing to play or transcribe — park it unless a transcript already exists.
      if (!t.transcript) {
        await markTakeAudioMissing(t.id);
        changed = true;
      }
      continue;
    }
    if (isPersistedTakeUri(t.audio_uri)) {
      // Already ours; only park it if the file vanished before transcription.
      if (!t.transcript && !takeAudioExists(t.audio_uri)) {
        await markTakeAudioMissing(t.id);
        changed = true;
      }
      continue;
    }
    // Recorder temp URI from before permanent storage: rescue while it's alive.
    const rescued = rescueTakeAudio(t.audio_uri);
    if (rescued) {
      await updateTakeAudioUri(t.id, rescued);
      changed = true;
    } else if (!t.transcript) {
      await markTakeAudioMissing(t.id);
      changed = true;
    }
  }
  if (changed) emitChanged();
};

// ── Stage 4 helper — retrieve related history, generate the opinion arc ───────
// Priors qualify by being about the SAME movie (any similarity) or by strong
// cross-movie semantic similarity (recurring obsessions: "you keep praising
// Zimmer scores"). Top 3 feed the insight call. Marking insighted_at happens
// even when no insight is produced — "nothing to say" is a recorded outcome,
// not unfinished work.
const INSIGHT_TOP_K = 3;
const CROSS_MOVIE_MIN_SCORE = 0.5;

const parseVector = (raw: string): number[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const runInsightStage = async (
  take: Take,
  transcript: string,
  summary: string | null
): Promise<void> => {
  const rows = await getAllTakeEmbeddings();
  const own = rows.find((r) => r.take_id === take.id);
  const ownVec = own ? parseVector(own.vector) : [];
  // No own vector means stage 3 didn't really land — leave insighted_at null so
  // the stage retries on a later pass instead of silently skipping forever.
  if (!ownVec.length) return;

  const corpus = rows
    .filter((r) => r.take_id !== take.id)
    .map((r) => ({ takeId: r.take_id, vector: parseVector(r.vector) }))
    .filter((r) => r.vector.length > 0);

  if (corpus.length > 0) {
    const ranked = rankBySimilarity(ownVec, corpus, 12, take.id);
    const all = await getTakes();
    const byId = new Map(all.map((t) => [t.id, t]));
    const candidates = ranked
      .map((s) => ({ score: s.score, prior: byId.get(s.takeId) }))
      .filter((x): x is { score: number; prior: Take } => !!x.prior && !!x.prior.transcript)
      .filter((x) => x.prior.movie_id === take.movie_id || x.score >= CROSS_MOVIE_MIN_SCORE)
      .slice(0, INSIGHT_TOP_K);

    if (candidates.length > 0) {
      const result = await generateInsight({
        newTake: {
          movieTitle: take.movie_title,
          createdAt: take.created_at,
          summary,
          transcript,
        },
        priors: candidates.map(({ prior }) => ({
          movieTitle: prior.movie_title,
          createdAt: prior.created_at,
          summary: prior.summary,
          transcriptExcerpt: (prior.transcript ?? "").slice(0, 400),
        })),
      });
      if (result.insightText) {
        const relatedIds = candidates.map((c) => c.prior.id);
        await addInsight({
          take_id: take.id,
          insight_text: result.insightText,
          related_take_ids: relatedIds,
          model: result.model,
          arc_type: result.arcType,
        });
        console.log(
          `enrichment: INSIGHT [${result.arcType ?? "untyped"}] for take ${take.id} ` +
            `(“${take.movie_title}”): "${result.insightText}" — drawing on take(s) ${relatedIds.join(", ")}`
        );
      } else {
        console.log(
          `enrichment: take ${take.id} — related history found, but no meaningful arc (recorded)`
        );
      }
    } else {
      console.log(
        `enrichment: take ${take.id} — no related history yet; first take on this ground`
      );
    }
  } else {
    console.log(`enrichment: take ${take.id} — journal has no other embedded takes yet`);
  }
  await markTakeInsighted(take.id);
  // Every path that marks insighted_at must ANNOUNCE it — an open entries view is
  // watching this exact transition (94% → complete). Emitting only on the
  // insight-produced branch left first takes ("no related history yet") stuck at
  // 94% until remount.
  emitChanged();
};

// ── Per-take processing ───────────────────────────────────────────────────────
// 'done'  → this take reached a stable state (progress, failure recorded, or parked)
// 'skip'  → the next stage's provider isn't configured; leave as-is, try next take
// 'stop'  → transport-level failure (offline mid-run); halt without burning attempts
type Outcome = "done" | "skip" | "stop";

const isTransportError = (e: unknown): boolean => {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return /network request failed|abort|timeout|failed to fetch/i.test(msg);
};

const processTake = async (take: Take): Promise<Outcome> => {
  try {
    // Stage 1 — transcription (skipped when a transcript already exists).
    let transcript = take.transcript;
    let segments = parseTakeSegments(take) ?? [];
    if (!transcript || segments.length === 0) {
      if (!take.audio_uri || !takeAudioExists(take.audio_uri)) {
        await markTakeAudioMissing(take.id);
        emitChanged();
        return "done";
      }
      if (!getTranscriptionProvider()) return "skip";
      const result = await transcribeTakeAudio(take.audio_uri);
      if (!result.text) throw new Error("empty transcript (silent recording?)");
      transcript = result.text;
      segments = result.segments;
      await updateTakeTranscript(take.id, transcript, segments);
      emitChanged();
    }

    // Stage 2 — one Claude call: entity extras + per-segment topics + summary.
    // Field-derived skip: takes re-entering the queue for embedding/insight
    // backfill must never re-bill the extraction call.
    let summary = take.summary;
    if (!take.summary || !take.entities || !take.topics) {
      if (!isClaudeConfigured()) return "skip";
      const metas = await getMovieMetas([take.movie_id]);
      const roster = metas.get(take.movie_id)?.roster ?? [];
      const llm = await enrichTranscript({ movieTitle: take.movie_title, segments, roster });

      const entities = mergeWithLlmEntities(
        matchRosterInTranscript(transcript, roster),
        llm.entities
      );
      const topics = computeTopics(segments, llm.segmentTopics, llm.topicStances);
      await updateTakeEnrichment(take.id, {
        entities,
        topics,
        summary: llm.summary,
        model: llm.model,
        spokenRating: llm.rating,
        offTopic: llm.offTopic,
      });
      summary = llm.summary;
      // Auto-spoiler: extraction says the take reveals plot — mark it so the
      // entries UI veils it. One-way: never UN-marks (the user's own judgment,
      // whether set by hand or by clearing an auto-mark, always wins after).
      if (llm.containsSpoilers && take.is_spoiler !== 1) {
        await updateTakeSpoiler(take.id, true);
      }
      // Entities/topics have no UI surface yet (deliberate) — the Metro console is
      // how enrichment results get verified during the dev phase.
      console.log(
        `enrichment: take ${take.id} (“${take.movie_title}”) enriched:`,
        JSON.stringify(
          { entities, topics, spokenRating: llm.rating, summary: llm.summary, offTopic: llm.offTopic },
          null,
          1
        )
      );
      emitChanged();
      // Flagged off-topic → STOP HERE. No embedding, no insight, no retrieval
      // presence — the take costs nothing further unless the user rules KEEP IT
      // (which clears the flag and lets the queue re-admit it for these stages).
      if (llm.offTopic) {
        console.log(`enrichment: take ${take.id} flagged off-topic — skipping embedding + insight`);
        return "done";
      }
    }

    // Same stop for already-enriched flagged takes re-entering for backfill
    // (the queue query excludes them too — this is the belt to its suspenders).
    if (take.off_topic === 1) return "done";

    // Stage 3 — embedding (Phase 3e): summary + transcript → one vector, stored
    // locally. Retrieval and insights build on this; existing enriched takes are
    // backfilled here automatically.
    if (!(await hasTakeEmbedding(take.id))) {
      if (!isEmbeddingConfigured()) return "skip";
      const { vector, model } = await embedText(`${summary ?? ""}\n${transcript}`.trim());
      await upsertTakeEmbedding(take.id, model, vector);
      console.log(`enrichment: take ${take.id} embedded (${vector.length} dims)`);
    }

    // Stage 4 — opinion-arc insight (Phase 3e): retrieve related history, ask
    // for the arc, store it. Runs once per take; producing no insight is a
    // valid, recorded outcome.
    if (take.insighted_at == null) {
      if (!isClaudeConfigured() || !isEmbeddingConfigured()) return "skip";
      await runInsightStage(take, transcript, summary ?? null);
    }
    return "done";
  } catch (e) {
    if (isTransportError(e)) return "stop";
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`enrichment: take ${take.id} failed:`, msg);
    await markTakeEnrichFailure(take.id, msg);
    emitChanged();
    return "done";
  }
};

// ── The queue runner — serial, coalescing, re-entrant-safe ────────────────────
let running = false;
let rerunRequested = false;
let warnedUnconfigured = false;

const runQueue = async (): Promise<void> => {
  if (running) {
    rerunRequested = true;
    return;
  }
  running = true;
  try {
    do {
      rerunRequested = false;

      if (!getTranscriptionProvider() && !isClaudeConfigured()) {
        if (!warnedUnconfigured) {
          warnedUnconfigured = true;
          console.log(
            "enrichment: no API keys configured (EXPO_PUBLIC_GROQ_API_KEY / " +
              "EXPO_PUBLIC_OPENAI_API_KEY, EXPO_PUBLIC_ANTHROPIC_API_KEY) — takes stay pending."
          );
        }
        return;
      }
      try {
        const net = await Network.getNetworkStateAsync();
        if (net.isConnected === false || net.isInternetReachable === false) return;
      } catch {
        // can't read network state — optimistically try anyway
      }

      const queue = await getTakesForEnrichment(MAX_ATTEMPTS);
      for (const take of queue) {
        const outcome = await processTake(take);
        if (outcome === "stop") return;
      }
    } while (rerunRequested);
  } catch (e) {
    console.warn("enrichment: queue run crashed:", e);
  } finally {
    running = false;
  }
};

/** Nudge the queue (fire-and-forget). Safe to call from anywhere, any time. */
export const kickEnrichment = (): void => {
  void runQueue();
};

// ── One-shot dev reset (Bryan, 2026-07-16: fresh journal before enrichment) ───
// Runs ONLY when EXPO_PUBLIC_DEV_WIPE_TAKES=1 AND the on-disk marker is absent.
// The marker is written BEFORE deleting, so "at most once per device" holds even
// if the env flag is accidentally left set. Favorites are never touched.
const devWipeTakesOnce = async (): Promise<void> => {
  if (process.env.EXPO_PUBLIC_DEV_WIPE_TAKES !== "1") return;
  if (wipeMarkerExists()) {
    console.log(
      "enrichment: DEV wipe already performed on this device — remove " +
        "EXPO_PUBLIC_DEV_WIPE_TAKES from .env (new takes are safe either way)."
    );
    return;
  }
  if (!writeWipeMarker()) {
    console.error("enrichment: DEV wipe ABORTED — marker could not be persisted.");
    return;
  }
  const n = await deleteAllTakes();
  console.log(
    `enrichment: DEV wipe complete — deleted ${n} take(s) + audio. ` +
      "Remove EXPO_PUBLIC_DEV_WIPE_TAKES from .env now."
  );
  emitChanged();
};

// ── One-shot reprocess (3f, Bryan-approved): re-run the EXTRACTION stage on all
// transcribed takes so pre-3f rows gain spoken ratings + topic stances. Same
// self-disarming marker pattern as the wipe; bump the marker version whenever a
// future schema/prompt change warrants another pass. Transcripts, embeddings,
// insights all survive — only the cheap Claude extraction re-runs (~$0.005/take
// on haiku).
const REPROCESS_MARKER = "dev-reprocess-enrich-3f.done";

const devReprocessEnrichOnce = async (): Promise<void> => {
  if (process.env.EXPO_PUBLIC_DEV_REPROCESS_ENRICH !== "1") return;
  if (devMarkerExists(REPROCESS_MARKER)) {
    console.log(
      "enrichment: 3f reprocess already performed — remove EXPO_PUBLIC_DEV_REPROCESS_ENRICH from .env."
    );
    return;
  }
  if (!writeDevMarker(REPROCESS_MARKER)) {
    console.error("enrichment: reprocess ABORTED — marker could not be persisted.");
    return;
  }
  const n = await resetEnrichmentForReprocess();
  console.log(
    `enrichment: 3f reprocess armed — ${n} take(s) queued for re-extraction ` +
      "(ratings + topic stances). Remove EXPO_PUBLIC_DEV_REPROCESS_ENRICH from .env now."
  );
  emitChanged();
};

// ── App wiring — called once from the root layout ─────────────────────────────
let initialized = false;

export const initEnrichment = (): void => {
  if (initialized) return;
  initialized = true;

  void (async () => {
    try {
      await devWipeTakesOnce();
    } catch (e) {
      console.error("enrichment: dev wipe failed:", e);
    }
    try {
      await devReprocessEnrichOnce();
    } catch (e) {
      console.error("enrichment: dev reprocess failed:", e);
    }
    try {
      await sweepLegacyAudio();
    } catch (e) {
      console.warn("enrichment: legacy audio sweep failed:", e);
    }
    kickEnrichment();
  })();

  // Foregrounding the app is the "we're back" moment for offline recordings.
  AppState.addEventListener("change", (state) => {
    if (state === "active") kickEnrichment();
  });

  // True reconnect trigger (recording offline while staying in the app).
  try {
    if (typeof Network.addNetworkStateListener === "function") {
      Network.addNetworkStateListener((state) => {
        if (state.isConnected && state.isInternetReachable !== false) kickEnrichment();
      });
    }
  } catch (e) {
    console.warn("enrichment: network listener unavailable:", e);
  }
};
