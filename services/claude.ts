// ─────────────────────────────────────────────────────────────────────────────
// Claude enrichment client (Phase 3b fallback + 3c + 3d in ONE request).
//
// Given a take's transcript segments and the movie's known roster, one Messages
// API call returns:
//   • entities        — mentions string-matching could NOT resolve (characters,
//                       other movies, unlisted names); roster matches are done
//                       deterministically in services/entityMatch.ts and merged
//                       by the queue, so the model is told to skip those.
//   • segment_topics  — per-segment labels from the FIXED taxonomy; the queue
//                       turns these into time-spent-per-topic using the segment
//                       timestamps (the model never does arithmetic).
//   • summary         — one indexing sentence for later retrieval surfaces.
//
// Raw HTTP by necessity: the official @anthropic-ai/sdk does not support the
// React Native runtime, and every service in this app is already plain fetch.
// The response is forced through a strict tool (`tool_choice` + `strict: true`)
// so the payload is schema-valid JSON, never prose. NOTE: `temperature` is
// intentionally absent — Opus 4.7+ rejects sampling params with a 400.
//
// Key:   EXPO_PUBLIC_ANTHROPIC_API_KEY   (client-bundled — dev-phase tradeoff,
//                                          same standing as the TMDB token)
// Model: EXPO_PUBLIC_ENRICH_MODEL, defaulting to claude-opus-4-8. The id used
//        is stored on each take (enrich_model) so takes can be reprocessed when
//        the model or prompt changes.
// ─────────────────────────────────────────────────────────────────────────────
import {
  TAKE_TOPICS,
  type TakeEntity,
  type TakeTopicId,
  type TopicStance,
  type TranscriptSegment,
} from "./db";
import type { KnownEntity } from "./genres";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-8";

export const getEnrichModel = (): string =>
  process.env.EXPO_PUBLIC_ENRICH_MODEL || DEFAULT_MODEL;

export const isClaudeConfigured = (): boolean => !!process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;

export interface LlmEnrichment {
  entities: TakeEntity[]; // extras only — merged behind roster matches by the queue
  segmentTopics: { segment: number; topics: TakeTopicId[] }[];
  topicStances: { topic: TakeTopicId; stance: TopicStance }[]; // 3f — sentiment attached to topics
  rating: number | null; //                                       3f — rating SPOKEN in the take, 0–10
  summary: string;
  offTopic: boolean; // the take has no meaningful connection to the movie — UI asks keep/delete
  containsSpoilers: boolean; // reveals concrete plot info — auto-marks the take as a spoiler
  model: string;
}

const STANCES = ["praised", "criticized", "mixed", "neutral"] as const;

const TOOL_NAME = "record_take_enrichment";

const ENTITY_TYPES = [
  "director",
  "actor",
  "character",
  "studio",
  "collection",
  "movie",
  "composer",
] as const;

// Strict-mode schema: additionalProperties:false + every property required, so
// the API guarantees the tool input validates exactly.
const ENRICHMENT_TOOL = {
  name: TOOL_NAME,
  description:
    "Record the structured enrichment extracted from one voice-journal transcript. " +
    "Must be called exactly once with the complete result.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["entities", "segment_topics", "topic_stances", "rating", "summary", "off_topic", "contains_spoilers"],
    properties: {
      entities: {
        type: "array",
        description:
          "Film-related mentions NOT in the provided known list: fictional characters " +
          "and notable in-world elements (places, factions) as type 'character', other " +
          "movies as 'movie', film series and franchises as 'collection' (TMDB's word " +
          "for them), plus any unlisted real people or studios.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "name", "confidence"],
          properties: {
            type: { type: "string", enum: [...ENTITY_TYPES] },
            name: { type: "string", description: "Canonical name, correctly spelled" },
            confidence: {
              type: "number",
              description: "0..1 — how sure the transcript really refers to this",
            },
          },
        },
      },
      segment_topics: {
        type: "array",
        description:
          "One entry per transcript segment index, in order. topics = what that segment " +
          "discusses (0, 1 or 2 labels); empty array when no taxonomy topic applies.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["segment", "topics"],
          properties: {
            segment: { type: "integer", description: "The segment index shown in brackets" },
            topics: {
              type: "array",
              items: { type: "string", enum: [...TAKE_TOPICS] },
            },
          },
        },
      },
      topic_stances: {
        type: "array",
        description:
          "One entry per DISTINCT topic used anywhere in segment_topics: the take's overall " +
          "attitude toward that topic. 'mixed' only for genuine internal conflict; 'neutral' " +
          "when the topic is discussed without judgment. Never invent topics not in segment_topics.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["topic", "stance"],
          properties: {
            topic: { type: "string", enum: [...TAKE_TOPICS] },
            stance: { type: "string", enum: [...STANCES] },
          },
        },
      },
      rating: {
        anyOf: [{ type: "number" }, { type: "null" }],
        description:
          "A rating the user EXPLICITLY SPOKE (\"10 out of 10\", \"8.7/10\", \"four out of " +
          "five stars\"), normalized to a 0–10 scale. null when no rating was stated — " +
          "NEVER infer one from tone.",
      },
      summary: {
        type: "string",
        description:
          "ONE natural sentence (max ~150 chars) in the SPEAKER'S OWN casual voice — the " +
          "line they'd text a friend right after the credits. Full spoken grammar, their " +
          "own words and energy, first person where natural — e.g. \"I didn't expect it to " +
          "hit that hard — the ending honestly wrecked me.\" NEVER telegraphic critic-speak " +
          "or comma-spliced fragments (\"strong lead performances, pacing kept viewer " +
          "engaged\" is exactly what NOT to write).",
      },
      off_topic: {
        type: "boolean",
        description:
          "true ONLY when the transcript has no meaningful connection to this movie or to " +
          "watching it — gibberish, mic tests, repeated filler, or talk about something else " +
          "entirely. Personal reactions, viewing-experience tangents, comparisons to other " +
          "films, and emotional responses are ALL on-topic (false). BREVITY IS NOT " +
          "OFF-TOPIC: a single exclamation or gut reaction to the film ('wow', 'that " +
          "wrecked me', 'call it a feeling') is on-topic. When unsure, false.",
      },
      contains_spoilers: {
        type: "boolean",
        description:
          "true when the take reveals concrete plot information someone who hasn't seen " +
          "the movie wouldn't want to know — endings, twists, character deaths, major " +
          "reveals, who-did-it. General impressions, vibes, performance and craft opinions " +
          "are NOT spoilers. When unsure, false.",
      },
    },
  },
} as const;

const SYSTEM_PROMPT =
  "You are the silent data-enrichment service inside a personal film journal. Users record " +
  "short voice notes (\"takes\") about movies; you turn one transcript into structured data " +
  "via the record_take_enrichment tool. Rules: use ONLY the fixed topic taxonomy — fold " +
  "aliases into it (soundtrack/score→music; cinematography/CGI/effects→visuals; " +
  "villain/hero/protagonist discussion→characters; funny/jokes→humor; slow/rushed/length→pacing; " +
  "finale/final twist/how it ends→ending; lore/setting/universe→world-building; " +
  "moved/cried/feelings→emotional-impact; plot/narrative/writing→story; performances→acting; " +
  "lines/quotes/banter→dialogue). Label every segment index exactly once, in order, and " +
  "never invent indices. Sentiment exists ONLY attached to topics (topic_stances) — never " +
  "report a bare mood. A rating counts only when the user explicitly states one; normalize " +
  "spoken scales to 0–10 and never infer a number from enthusiasm. Transcripts contain " +
  "speech-to-text errors — infer the intended film terms. Do not editorialize; extract " +
  "only what was said. The summary belongs to the SPEAKER, not to you: write it the way " +
  "they talk, keeping their words and warmth — it should read like their own line, never " +
  "like a review blurb.";

const buildUserPrompt = (
  movieTitle: string,
  segments: TranscriptSegment[],
  roster: KnownEntity[]
): string => {
  const rosterBlock = roster.length
    ? roster.map((r) => `- ${r.kind}: ${r.name}`).join("\n")
    : "(none available)";
  const segmentBlock = segments
    .map((s, i) => `[${i}] ${s.start.toFixed(1)}–${s.end.toFixed(1)}s: ${s.text}`)
    .join("\n");
  return (
    `MOVIE: ${movieTitle}\n\n` +
    `KNOWN ENTITIES for this movie (already matched separately — do NOT repeat them in ` +
    `\`entities\`; only add mentions missing from this list):\n${rosterBlock}\n\n` +
    `TRANSCRIPT SEGMENTS (index · start–end seconds · text):\n${segmentBlock}\n\n` +
    `Call ${TOOL_NAME} once with entities, segment_topics (every index 0–${segments.length - 1}), ` +
    `topic_stances (one per distinct topic), the spoken rating (or null), the ` +
    `one-sentence summary, and the off_topic + contains_spoilers verdicts.`
  );
};

interface WireContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface WireResponse {
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string } | null;
  content?: WireContentBlock[];
  error?: { type?: string; message?: string };
}

/**
 * One enrichment call for one take. Throws on any failure (network, refusal,
 * malformed payload) — the queue owns retries and failure bookkeeping.
 */
export const enrichTranscript = async (args: {
  movieTitle: string;
  segments: TranscriptSegment[];
  roster: KnownEntity[];
}): Promise<LlmEnrichment> => {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const model = getEnrichModel();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 90_000);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        tools: [ENRICHMENT_TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          { role: "user", content: buildUserPrompt(args.movieTitle, args.segments, args.roster) },
        ],
      }),
      signal: abort.signal,
    });

    const data: WireResponse = await res.json().catch(() => ({}) as WireResponse);
    if (!res.ok) {
      throw new Error(
        `claude HTTP ${res.status}: ${data.error?.message?.slice(0, 200) ?? "unknown error"}`
      );
    }
    if (data.stop_reason === "refusal") {
      throw new Error(
        `claude refused (${data.stop_details?.category ?? "unspecified"}) — will retry`
      );
    }
    if (data.stop_reason === "max_tokens") {
      throw new Error("claude response truncated at max_tokens");
    }

    const toolUse = data.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
      throw new Error(`claude returned no ${TOOL_NAME} call (stop: ${data.stop_reason})`);
    }
    const input = toolUse.input as {
      entities?: { type?: string; name?: string; confidence?: number }[];
      segment_topics?: { segment?: number; topics?: string[] }[];
      topic_stances?: { topic?: string; stance?: string }[];
      rating?: number | null;
      summary?: string;
      off_topic?: boolean;
      contains_spoilers?: boolean;
    };

    // strict:true guarantees the shape, but the wire is still the wire — clamp
    // everything to our own types before it touches the DB.
    const topicSet = new Set<string>(TAKE_TOPICS);
    const typeSet = new Set<string>(ENTITY_TYPES);
    const entities: TakeEntity[] = (input.entities ?? [])
      .filter((e) => !!e.name?.trim() && typeSet.has(e.type ?? ""))
      .map((e) => ({
        type: e.type as TakeEntity["type"],
        name: e.name!.trim(),
        confidence: Math.max(0, Math.min(1, e.confidence ?? 0.5)),
      }));
    const segmentTopics = (input.segment_topics ?? [])
      .filter((s) => Number.isInteger(s.segment))
      .map((s) => ({
        segment: s.segment as number,
        topics: (s.topics ?? []).filter((t): t is TakeTopicId => topicSet.has(t)),
      }));
    const stanceSet = new Set<string>(STANCES);
    const topicStances = (input.topic_stances ?? [])
      .filter(
        (s): s is { topic: TakeTopicId; stance: TopicStance } =>
          topicSet.has(s.topic ?? "") && stanceSet.has(s.stance ?? "")
      )
      .map((s) => ({ topic: s.topic, stance: s.stance }));
    const rating =
      typeof input.rating === "number" && Number.isFinite(input.rating)
        ? Math.round(Math.max(0, Math.min(10, input.rating)) * 10) / 10
        : null;
    const summary = (input.summary ?? "").trim();
    if (!summary) throw new Error("claude returned an empty summary");
    const offTopic = input.off_topic === true;
    const containsSpoilers = input.contains_spoilers === true;

    return { entities, segmentTopics, topicStances, rating, summary, offTopic, containsSpoilers, model };
  } finally {
    clearTimeout(timer);
  }
};
