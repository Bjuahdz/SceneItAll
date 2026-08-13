// ─────────────────────────────────────────────────────────────────────────────
// Deterministic entity matching (Phase 3b, first pass).
//
// Transcripts get matched against the movie's KNOWN roster (director, composer,
// top cast, studio, collection — services/genres.ts) BEFORE any LLM sees them:
// string matching is free, instant, and carries TMDB ids. The LLM only fills in
// what string matching can't resolve (characters, other movies, unlisted names).
//
// Transcription mangles proper nouns ("Vela Nueve" for "Villeneuve"), so the
// matcher runs three passes per roster name: exact phrase, exact last name, and
// a fuzzy sliding window scored by edit distance over space-collapsed text.
//
// Pure functions only — no React Native imports — so this file runs under plain
// Node for smoke tests.
// ─────────────────────────────────────────────────────────────────────────────
import type { TakeEntity } from "./db";
import type { KnownEntity } from "./genres";

/** Lowercase, de-accent, strip punctuation, collapse whitespace. */
export const normalizeText = (s: string): string => {
  let t = s.toLowerCase();
  try {
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  } catch {
    // very old JS engines only — keep accented form
  }
  return t.replace(/[^a-z0-9]+/g, " ").trim();
};

// Iterative two-row Levenshtein — inputs here are short (names), transcripts ~200 words.
const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = [...cur];
  }
  return prev[b.length];
};

const PERSON_KINDS = new Set(["director", "composer", "actor"]);

// Consonant skeleton: keep the leading char, drop later vowels, collapse repeats.
// Speech-to-text mangles VOWELS far more than consonant structure — "velanueve"
// and "villeneuve" both skeletonize to "vlnv".
const skeleton = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (i > 0 && "aeiou".includes(c)) continue;
    if (out.length > 0 && out[out.length - 1] === c) continue;
    out += c;
  }
  return out;
};

const FUZZY_MAX_RATIO = 0.34;

// How close `win` is to `target`, as a 0..1 ratio where ≤ FUZZY_MAX_RATIO counts
// as a hit. Two tiers: raw edit distance for typo-grade errors, then a strict
// consonant-skeleton comparison to rescue phonetic manglings ("Vela Nueve" →
// "Villeneuve" is raw 0.50 but skeleton-identical).
const effectiveRatio = (win: string, target: string): number => {
  const raw = editDistance(win, target) / Math.max(win.length, target.length);
  if (raw <= FUZZY_MAX_RATIO) return raw;
  const st = skeleton(target);
  if (st.length >= 3 && raw <= 0.55) {
    const sw = skeleton(win);
    const skelRatio = editDistance(sw, st) / Math.max(sw.length, st.length, 1);
    if (skelRatio <= 0.25) return skelRatio * 0.5 + raw * 0.25; // ≤ 0.26 → hit
  }
  return 1;
};

// Best fuzzy hit of `target` (space-free) against windows of `windowWords`
// consecutive transcript words. Returns the effective ratio, or 1 (miss).
const bestWindowRatio = (words: string[], target: string, windowWords: number): number => {
  if (target.length < 5) return 1; // too short to fuzzy-match safely
  let best = 1;
  for (let i = 0; i + windowWords <= words.length; i++) {
    const win = words.slice(i, i + windowWords).join("");
    // Cheap length gate before paying for a distance computation.
    if (Math.abs(win.length - target.length) > Math.ceil(target.length * 0.4)) continue;
    const ratio = effectiveRatio(win, target);
    if (ratio < best) best = ratio;
  }
  return best;
};

/**
 * Match a transcript against the movie's known roster. Every hit carries the
 * roster's TMDB id. One entity per roster entry, best-confidence wins.
 */
export const matchRosterInTranscript = (
  transcript: string,
  roster: KnownEntity[]
): TakeEntity[] => {
  const norm = normalizeText(transcript);
  if (!norm) return [];
  const padded = ` ${norm} `;
  const words = norm.split(" ");

  const out: TakeEntity[] = [];
  for (const known of roster) {
    const name = normalizeText(known.name);
    if (!name) continue;
    const nameWords = name.split(" ");
    const lastToken = nameWords[nameWords.length - 1];
    const isPerson = PERSON_KINDS.has(known.kind);

    let confidence = 0;

    // 1) Exact full-name phrase ("denis villeneuve").
    if (padded.includes(` ${name} `)) {
      confidence = 1;
    }
    // 1b) Collections are catalogued as "X Collection" but spoken as "X".
    if (!confidence && known.kind === "collection" && name.endsWith(" collection")) {
      const bare = name.slice(0, -" collection".length);
      if (bare.length >= 3 && padded.includes(` ${bare} `)) confidence = 0.9;
    }
    // 2) Exact last name — people get talked about by surname ("Zimmer's score").
    if (!confidence && isPerson && nameWords.length > 1 && lastToken.length >= 4) {
      if (padded.includes(` ${lastToken} `)) confidence = 0.85;
    }
    // 3) Fuzzy windows over the transcript for what speech-to-text mangled.
    if (!confidence) {
      const targets: string[] = [nameWords.join("")];
      if (isPerson && nameWords.length > 1 && lastToken.length >= 6) targets.push(lastToken);
      let bestRatio = 1;
      for (const target of targets) {
        // Windows sized around the target's own word count: a 1-word surname can
        // arrive split in two ("villa nueve"), a 2-word name merged into one.
        const around = target === lastToken ? 1 : nameWords.length;
        for (let w = Math.max(1, around - 1); w <= around + 1; w++) {
          const ratio = bestWindowRatio(words, target, w);
          if (ratio < bestRatio) bestRatio = ratio;
        }
      }
      if (bestRatio <= FUZZY_MAX_RATIO) confidence = 0.75 - bestRatio * 0.5; // ≈ 0.58–0.75
    }

    if (confidence > 0) {
      out.push({
        type: known.kind,
        name: known.name,
        ...(known.tmdbId != null ? { tmdbId: known.tmdbId } : {}),
        confidence: Math.round(confidence * 100) / 100,
      });
    }
  }
  return out;
};

/**
 * Merge LLM-extracted entities behind the deterministic ones. Roster matches win
 * on name collisions (they carry ids); LLM extras are clamped and capped so a
 * hallucinated list can't flood the take.
 */
export const mergeWithLlmEntities = (
  matched: TakeEntity[],
  llmEntities: TakeEntity[],
  maxLlmExtras = 12
): TakeEntity[] => {
  const seen = new Set(matched.map((e) => normalizeText(e.name)));
  const merged = [...matched];
  let added = 0;
  for (const e of llmEntities) {
    if (added >= maxLlmExtras) break;
    const key = normalizeText(e.name);
    if (!key || seen.has(key)) continue;
    // Also skip near-misses of names we already have ("Denis" vs "Denis Villeneuve").
    let dup = false;
    for (const s of seen) {
      if (s.includes(key) || key.includes(s)) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    seen.add(key);
    merged.push({
      type: e.type,
      name: e.name.trim(),
      ...(e.tmdbId != null ? { tmdbId: e.tmdbId } : {}),
      confidence: Math.max(0, Math.min(1, e.confidence ?? 0.5)),
    });
    added++;
  }
  return merged;
};
