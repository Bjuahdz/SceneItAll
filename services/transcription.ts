// ─────────────────────────────────────────────────────────────────────────────
// Transcription provider (Phase 3a).
//
// One adapter, two providers: Groq and OpenAI expose the SAME OpenAI-compatible
// `audio/transcriptions` endpoint, so which one runs is decided purely by which
// env key is present (Groq wins when both are set — ~10x cheaper and faster).
//
//   EXPO_PUBLIC_GROQ_API_KEY    → Groq  whisper-large-v3-turbo  (~$0.04/audio-hr)
//   EXPO_PUBLIC_OPENAI_API_KEY  → OpenAI whisper-1              (~$0.36/audio-hr)
//
// HARD REQUIREMENT: `response_format=verbose_json`, because segment-level
// timestamps are what Phase 3c computes time-spent-per-topic from. whisper-1 is
// deliberately used on OpenAI (gpt-4o-transcribe does not return segments).
//
// No key configured → getTranscriptionProvider() returns null and the queue
// waits quietly; nothing crashes.
// ─────────────────────────────────────────────────────────────────────────────
import type { TranscriptSegment } from "./db";

export interface TranscriptionProvider {
  name: "groq" | "openai";
  url: string;
  model: string;
  key: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
}

export const getTranscriptionProvider = (): TranscriptionProvider | null => {
  const groqKey = process.env.EXPO_PUBLIC_GROQ_API_KEY;
  if (groqKey) {
    return {
      name: "groq",
      url: "https://api.groq.com/openai/v1/audio/transcriptions",
      model: "whisper-large-v3-turbo",
      key: groqKey,
    };
  }
  const openaiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (openaiKey) {
    return {
      name: "openai",
      url: "https://api.openai.com/v1/audio/transcriptions",
      model: "whisper-1",
      key: openaiKey,
    };
  }
  return null;
};

const MIME_BY_EXT: Record<string, string> = {
  m4a: "audio/m4a",
  mp4: "audio/mp4",
  caf: "audio/x-caf",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  aac: "audio/aac",
};

const fileMeta = (uri: string): { name: string; type: string } => {
  const ext = (/\.([A-Za-z0-9]+)$/.exec(uri)?.[1] ?? "m4a").toLowerCase();
  return { name: `take.${ext}`, type: MIME_BY_EXT[ext] ?? "audio/m4a" };
};

// Whisper verbose_json segment (only the fields we keep).
interface WireSegment {
  start?: number;
  end?: number;
  text?: string;
}

/**
 * Upload one take's audio and return the flat transcript plus timestamped
 * segments. Throws on any failure — the enrichment queue owns retries.
 */
export const transcribeTakeAudio = async (audioUri: string): Promise<TranscriptionResult> => {
  const provider = getTranscriptionProvider();
  if (!provider) throw new Error("No transcription provider configured");

  // React Native FormData takes a {uri, name, type} file part — no Blob needed.
  const form = new FormData();
  const meta = fileMeta(audioUri);
  form.append("file", { uri: audioUri, name: meta.name, type: meta.type } as unknown as Blob);
  form.append("model", provider.model);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120_000);
  try {
    const res = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.key}` },
      body: form,
      signal: abort.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${provider.name} transcription HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data: { text?: string; duration?: number; segments?: WireSegment[] } =
      await res.json();

    const text = (data.text ?? "").trim();
    let segments: TranscriptSegment[] = Array.isArray(data.segments)
      ? data.segments
          .map((s) => ({
            start: typeof s.start === "number" ? s.start : 0,
            end: typeof s.end === "number" ? s.end : 0,
            text: (s.text ?? "").trim(),
          }))
          .filter((s) => s.text.length > 0)
      : [];
    // Very short clips can come back segmentless — synthesize one so the topic
    // math always has timestamps to work with.
    if (!segments.length && text) {
      segments = [{ start: 0, end: data.duration ?? 0, text }];
    }
    return { text, segments };
  } finally {
    clearTimeout(timer);
  }
};
