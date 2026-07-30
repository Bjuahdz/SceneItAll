// ─────────────────────────────────────────────────────────────────────────────
// Opinion-arc insight (Phase 3e — the differentiator).
//
// When a new take lands and past takes resonate with it (same film, or
// semantically similar via embeddings), ONE Claude call names the arc:
// "Two weeks ago the pacing bothered you; tonight you called it a masterpiece."
// Letterboxd/Goodreads don't do this — tracking how opinions SHIFT is the
// journal's whole thesis (see PROJECT-PLAN §Target architecture).
//
// Grounding rules are strict: the model may only claim what the entries
// evidence, and it returns has_insight=false when the priors don't genuinely
// relate — silence beats a forced observation. Sentiment appears only attached
// to specifics (a topic, a person, a moment), never bare, honoring the
// deferred-sentiment rule.
//
// Same wire discipline as services/claude.ts: raw fetch (no RN SDK support),
// strict tool_choice-forced JSON, no sampling params, queue owns retries.
// Model rides getEnrichModel(), so Bryan's EXPO_PUBLIC_ENRICH_MODEL override
// applies here too.
// ─────────────────────────────────────────────────────────────────────────────
import { getEnrichModel } from "./claude";
import type { InsightArcType } from "./db";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

// Insights can run on a stronger model than extraction (they're the one
// user-facing sentence in the pipeline): EXPO_PUBLIC_INSIGHT_MODEL wins,
// else Bryan's enrich-model override, else the code default.
export const getInsightModel = (): string =>
  process.env.EXPO_PUBLIC_INSIGHT_MODEL || getEnrichModel();

const TOOL_NAME = "record_opinion_arc";

const INSIGHT_TOOL = {
  name: TOOL_NAME,
  description:
    "Record whether the new journal entry, read against the user's related past entries, " +
    "reveals a meaningful opinion arc — and if so, the one- to two-sentence note naming it.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["has_insight", "arc_type", "insight_text"],
    properties: {
      has_insight: {
        type: "boolean",
        description:
          "true ONLY when the past entries genuinely connect to the new one (a shift, " +
          "a reversal, an escalation, or a consistent pattern). false when they merely " +
          "coexist — silence beats a forced observation.",
      },
      arc_type: {
        type: "string",
        enum: ["shift", "deepening", "pattern", "none"],
        description:
          "The kind of arc: 'shift' = the opinion changed or reversed; 'deepening' = the " +
          "same feeling grew stronger or more articulate; 'pattern' = a recurring taste " +
          "across films (\"you keep praising scores\"). 'none' exactly when has_insight " +
          "is false.",
      },
      insight_text: {
        type: "string",
        description:
          "Empty string when has_insight is false. Otherwise HARD LIMITS: at most 2 " +
          "sentences, at most ~280 characters, plain text only (no markdown, no asterisks, " +
          "no bullet dashes). Name ONE arc — never a side-by-side summary or ratings " +
          "comparison of the entries. Second person (\"you\"), grounded in what the entries " +
          "actually say, naming concrete specifics — e.g. \"Three weeks ago Hans Zimmer's " +
          "score barely registered; tonight it's the first thing you praised.\"",
      },
    },
  },
} as const;

const SYSTEM_PROMPT =
  "You are the silent opinion-arc historian inside a personal film journal. You receive the " +
  "user's NEW voice-journal entry plus their most related PAST entries, and decide whether a " +
  "meaningful arc connects them: a changed mind, a deepened feeling, a recurring obsession, a " +
  "first-time-vs-rewatch shift. Claim only what the entries evidence — never invent memories, " +
  "never editorialize about the films themselves, never output sentiment without attaching it " +
  "to a specific topic, person, or moment. An insight names ONE arc and stops — it is never a " +
  "recap of both entries, never a ratings comparison, never longer than two plain-text " +
  "sentences. Entries are speech-to-text and contain errors; read through them. When the past " +
  "entries don't genuinely relate, say so via has_insight=false.";

// Humanize a timestamp relative to now, coarsely — the model reasons better
// with "three weeks ago" than epoch milliseconds.
export const agoLabel = (thenMs: number, nowMs = Date.now()): string => {
  const days = Math.floor(Math.max(0, nowMs - thenMs) / 86_400_000);
  if (days === 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} year(s) ago`;
};

export interface InsightPrior {
  movieTitle: string;
  createdAt: number;
  summary: string | null;
  transcriptExcerpt: string;
}

export interface InsightArgs {
  newTake: {
    movieTitle: string;
    createdAt: number;
    summary: string | null;
    transcript: string;
  };
  priors: InsightPrior[];
}

const buildUserPrompt = (args: InsightArgs): string => {
  const priorBlocks = args.priors
    .map(
      (p, i) =>
        `PAST ENTRY ${i + 1} — ${p.movieTitle}, ${agoLabel(p.createdAt)}\n` +
        (p.summary ? `summary: ${p.summary}\n` : "") +
        `said: ${p.transcriptExcerpt}`
    )
    .join("\n\n");
  return (
    `NEW ENTRY — ${args.newTake.movieTitle}, ${agoLabel(args.newTake.createdAt)}\n` +
    (args.newTake.summary ? `summary: ${args.newTake.summary}\n` : "") +
    `said: ${args.newTake.transcript}\n\n` +
    `${priorBlocks}\n\n` +
    `Call ${TOOL_NAME} once.`
  );
};

interface WireContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface WireResponse {
  stop_reason?: string;
  stop_details?: { category?: string | null } | null;
  content?: WireContentBlock[];
  error?: { type?: string; message?: string };
}

// Belt-and-braces: the prompt demands plain text, but display text must never
// carry markdown artifacts regardless of what the model does.
const sanitizeInsightText = (s: string): string =>
  s
    .replace(/[*_`#]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * One insight call. Returns null insightText when the model (correctly) finds
 * no meaningful arc. Throws on failure — the queue owns retries.
 */
export const generateInsight = async (
  args: InsightArgs
): Promise<{ insightText: string | null; arcType: InsightArcType | null; model: string }> => {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const model = getInsightModel();

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
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        tools: [INSIGHT_TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: buildUserPrompt(args) }],
      }),
      signal: abort.signal,
    });

    const data: WireResponse = await res.json().catch(() => ({}) as WireResponse);
    if (!res.ok) {
      throw new Error(
        `insight HTTP ${res.status}: ${data.error?.message?.slice(0, 200) ?? "unknown error"}`
      );
    }
    if (data.stop_reason === "refusal") {
      throw new Error(`insight refused (${data.stop_details?.category ?? "unspecified"})`);
    }
    if (data.stop_reason === "max_tokens") {
      throw new Error("insight response truncated at max_tokens");
    }

    const toolUse = data.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
      throw new Error(`insight returned no ${TOOL_NAME} call (stop: ${data.stop_reason})`);
    }
    const input = toolUse.input as {
      has_insight?: boolean;
      arc_type?: string;
      insight_text?: string;
    };
    const text = sanitizeInsightText(input.insight_text ?? "");
    const arcType: InsightArcType | null =
      input.arc_type === "shift" || input.arc_type === "deepening" || input.arc_type === "pattern"
        ? input.arc_type
        : null;
    return {
      insightText: input.has_insight && text ? text : null,
      arcType,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
};
