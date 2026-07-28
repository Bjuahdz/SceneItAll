// ─────────────────────────────────────────────────────────────────────────────
// Embedding provider (Phase 3e).
//
// Anthropic has no embeddings endpoint, so vectors come from OpenAI's
// text-embedding-3-small on the SAME key already used for whisper-1 — no new
// account. Cost is noise: $0.02 per MILLION tokens ≈ $0.00002 per take.
//
// dimensions=512 (down from the model's native 1536) — OpenAI truncates +
// renormalizes server-side; quality loss is marginal at journal scale and the
// JSON-in-TEXT vectors shrink ~3x. NOTE: embeddings always need the OpenAI key,
// even if transcription is ever switched to Groq.
// ─────────────────────────────────────────────────────────────────────────────

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 512;

export const isEmbeddingConfigured = (): boolean => !!process.env.EXPO_PUBLIC_OPENAI_API_KEY;

// Store ~6 decimals per component: floats past that are noise, and it keeps a
// 512-dim vector around 4–5 KB of TEXT instead of ~12 KB.
const roundVector = (v: number[]): number[] => v.map((x) => Math.round(x * 1e6) / 1e6);

/**
 * Embed one take's text. Throws on any failure — the enrichment queue owns
 * retries and failure bookkeeping.
 */
export const embedText = async (
  text: string
): Promise<{ vector: number[]; model: string }> => {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) throw new Error("No OpenAI API key configured (embeddings)");

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 6000), // a 60s take is ~1k chars; guard rail only
        dimensions: EMBEDDING_DIMS,
      }),
      signal: abort.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`embeddings HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data: { data?: { embedding?: number[] }[] } = await res.json();
    const vector = data.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("embeddings response carried no vector");
    }
    return { vector: roundVector(vector), model: EMBEDDING_MODEL };
  } finally {
    clearTimeout(timer);
  }
};
