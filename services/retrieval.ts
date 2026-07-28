// ─────────────────────────────────────────────────────────────────────────────
// Retrieval math (Phase 3e) — the RAG "search", entirely on-device.
//
// A personal journal is hundreds to low-thousands of entries; scoring every
// vector in JS is a milliseconds job, which is exactly why the plan stores
// embeddings as JSON TEXT and defers sqlite-vec to the dev-build gate.
//
// Pure + dependency-free so it runs under plain Node for smoke tests.
// ─────────────────────────────────────────────────────────────────────────────

/** Cosine similarity in [-1, 1]; 0 when either vector is empty/degenerate. */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

export interface ScoredTake {
  takeId: number;
  score: number;
}

/**
 * Rank a corpus of take vectors against a query vector, best first, capped at
 * `k`. Entries whose id equals `excludeTakeId` (the query's own take) are skipped.
 */
export const rankBySimilarity = (
  query: number[],
  corpus: { takeId: number; vector: number[] }[],
  k: number,
  excludeTakeId?: number
): ScoredTake[] => {
  const scored: ScoredTake[] = [];
  for (const entry of corpus) {
    if (entry.takeId === excludeTakeId) continue;
    scored.push({ takeId: entry.takeId, score: cosineSimilarity(query, entry.vector) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, k));
};
