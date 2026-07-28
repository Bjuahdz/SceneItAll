// ─────────────────────────────────────────────────────────────────────────────
// Topic math (Phase 3c) — the "memory fingerprint" computation.
//
// The LLM only LABELS segments; the arithmetic happens here, deterministically,
// from the transcription timestamps. Someone spending 4 minutes on the
// soundtrack and 30 seconds on the ending IS the signal — so seconds are the
// primary value and share is derived, never the other way around.
//
// Pure + dependency-free (type-only imports) so it runs under plain Node for
// smoke tests.
// ─────────────────────────────────────────────────────────────────────────────
import type { TakeTopic, TakeTopicId, TopicStance, TranscriptSegment } from "./db";

/**
 * Turn per-segment topic labels into time-spent-per-topic. A segment's duration
 * is split evenly across its labels so total attributed seconds never exceed
 * spoken seconds; `share` is seconds / total attributed seconds (sums to ~1).
 * Segments with no applicable topic contribute nothing. Sorted longest first.
 *
 * `stances` (3f) attaches the take's per-topic attitude; topics without an
 * entry default to "neutral" — sentiment only ever rides on a topic.
 */
export const computeTopics = (
  segments: TranscriptSegment[],
  segmentTopics: { segment: number; topics: TakeTopicId[] }[],
  stances: { topic: TakeTopicId; stance: TopicStance }[] = []
): TakeTopic[] => {
  const stanceByTopic = new Map<TakeTopicId, TopicStance>(
    stances.map((s) => [s.topic, s.stance])
  );
  const secondsByTopic = new Map<TakeTopicId, number>();
  for (const st of segmentTopics) {
    const seg = segments[st.segment];
    if (!seg || st.topics.length === 0) continue;
    const perTopic = Math.max(0, seg.end - seg.start) / st.topics.length;
    for (const t of st.topics) secondsByTopic.set(t, (secondsByTopic.get(t) ?? 0) + perTopic);
  }
  let total = 0;
  for (const s of secondsByTopic.values()) total += s;
  if (total <= 0) return [];
  return Array.from(secondsByTopic.entries())
    .map(([topic, seconds]) => ({
      topic,
      seconds: Math.round(seconds * 10) / 10,
      share: Math.round((seconds / total) * 1000) / 1000,
      stance: stanceByTopic.get(topic) ?? "neutral",
    }))
    .sort((a, b) => b.seconds - a.seconds);
};
