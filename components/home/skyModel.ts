// ─────────────────────────────────────────────────────────────────────────────
// Home dashboard 29c — sky model, tokens, and the DOM modules' data models.
//
// Ported 1:1 from prototype_design_handoff/UPDATED_design_handoff_home_dashboard/
// home_reference.js (§1 helpers, §2 connection grammar, §3 sky model,
// §5 spectrum scrub, §6 stage pager, §7 fingerprint adapter). Every constant is
// final and device-tuned — port, don't re-derive.
//
// The port predates that folder's UPDATED_ prefix: the original
// design_handoff_home_dashboard/ was superseded and deleted 2026-07-28. The
// UPDATED package is the surviving canonical reference for this engine.
//
// Colour/RNG helpers are worklets: the Skia engine calls them per frame on the
// UI thread. buildSkyModel is pure math and runs inside the frame worklet too
// (so its mutable member state is never frozen by Reanimated).
// ─────────────────────────────────────────────────────────────────────────────

/** Genre hue ramp by library rank (README §Design tokens). */
export const GENRE_HUES = [
  "#5d8dee", "#e25c73", "#9077e8", "#e8853e", "#4caf7d",
  "#e2b53f", "#e46ec0", "#3eb8cf", "#8fb04d", "#97a3b8",
];

export const AMBER = "#e2b53f"; //      BREAKOUT stroke (never takes the lock hue)
export const AMBER_INK = "#e2b573"; //  FLOOR chip text
export const ICE = "#cfe6f2"; //        bright ice — PEAK score
export const LIM = 470; //              world-space camera leash radius

export const hueForRank = (rank: number): string =>
  GENRE_HUES[rank % GENRE_HUES.length];

// ── §1 pure helpers (verbatim math) ──────────────────────────────────────────

export function hexRgb(h: string): [number, number, number] {
  "worklet";
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

/** rgba() string from a #hex + alpha. */
export function rgba(h: string, a: number): string {
  "worklet";
  const [r, g, b] = hexRgb(h);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/** Lerp a hex toward white by k (0..1) → rgb() string. */
export function tint(h: string, k: number): string {
  "worklet";
  const [r, g, b] = hexRgb(h);
  const f = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Lerp a hex toward white by k (0..1) → #hex (feed back into rgba). */
export function tintHex(h: string, k: number): string {
  "worklet";
  const [r, g, b] = hexRgb(h);
  const f = (v: number) => Math.round(v + (255 - v) * k);
  const hx = (v: number) => {
    const s = v.toString(16);
    return s.length < 2 ? "0" + s : s;
  };
  return "#" + hx(f(r)) + hx(f(g)) + hx(f(b));
}

/** Deterministic RNG — 3 rounds of LCG ×16807 mod 2^31−1, normalized to [0,1). */
export function seed(i: number): number {
  "worklet";
  let s = i % 2147483647;
  if (s <= 0) s += 2147483646;
  for (let k = 0; k < 3; k++) s = (s * 16807) % 2147483647;
  return (s - 1) / 2147483646;
}

export function clamp01(v: number): number {
  "worklet";
  return Math.max(0, Math.min(1, v));
}

/** Prototype's fmtDur — seconds → "12m" / "12m 30s" / "1h 04m". */
export const fmtDur = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }
  return sec ? `${m}m ${String(sec).padStart(2, "0")}s` : `${m}m`;
};

/** Compact relative time for the ledger's 8px slots ("3w", "2d", "now"). */
export const agoShort = (thenMs: number, nowMs = Date.now()): string => {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
};

// ── §2 connection grammar (FINAL) ────────────────────────────────────────────

export type KindId = "insight" | "person" | "similar" | "outlier";

export interface KindSpec {
  label: string;
  /** Skia dash intervals; empty = solid. */
  dash: number[];
  /** BREAKOUT never takes the lock hue. */
  amber?: string;
}

export const KIND: Record<KindId, KindSpec> = {
  insight: { label: "YOU SAID", dash: [] },
  person: { label: "SAME PEOPLE", dash: [5, 7] },
  similar: { label: "SIMILAR VIBE", dash: [2, 7] },
  outlier: { label: "BREAKOUT", dash: [], amber: AMBER },
};

export const KIND_ORDER: Record<KindId, number> = {
  insight: 0,
  person: 1,
  similar: 2,
  outlier: 3,
};

// ── §3 sky data (plain + serializable — the worklet builds the model from it) ─

export interface SkyGenre {
  key: string;
  hue: string;
  label: string;
  n: number; //            films in genre
  avg: number | null; //   mean spoken ★ | null
}

export interface SkyMovie {
  id: number;
  genreKey: string;
  takeCount: number;
  rated: boolean;
  // carried for the stage pager (not used by the canvas)
  title: string;
  year: string;
  rating: number | null;
  posterPath: string | null;
}

export interface SkyEdge {
  a: number;
  b: number;
  type: KindId;
  label: string;
  strength: number;
}

export interface SkyData {
  genres: SkyGenre[];
  movies: SkyMovie[];
  edges: SkyEdge[];
}

export const EMPTY_SKY: SkyData = { genres: [], movies: [], edges: [] };

export const ACCENT_HEX = "#9ccadf";

// ── §8/§10 cloudbank (Engine A — the Home screen) ────────────────────────────

export interface CloudTheme {
  name: string; //      personalised label (what the arc is actually ABOUT)
  kind: string; //      SHIFT | DEEPENING | PATTERN — the small kicker
  insight: string; //   arc.text VERBATIM (clamped in the crown, full in receipts)
  hue: string;
  memberIds: number[];
  cites: number;
  arcIndex: number; //  back-reference into fp.arcs for receipts
}

export interface CloudData {
  themes: CloudTheme[];
  movies: { id: number; takeCount: number }[];
  claim: Record<number, number>; // movieId → theme index (one owner each)
}

export const EMPTY_CLOUD: CloudData = { themes: [], movies: [], claim: {} };

// ── §6 stage pager model ─────────────────────────────────────────────────────

export interface StageItem {
  id: number;
  isLock: boolean;
  title: string;
  year: string;
  rating: number | null;
  takeCount: number;
  posterPath: string | null;
  hue: string;
  type?: KindId;
  reason?: string;
  kicker: string; //  "LOCKED ON" | the kind label
  dash: number[]; //  [] = solid (no sample drawn on the lock card)
  amber: boolean;
}

const hueOf = (data: SkyData, m: SkyMovie): string =>
  data.genres.find((g) => g.key === m.genreKey)?.hue ?? GENRE_HUES[0];

/** Card 0 = the locked film; cards 1..n = its connections (sorted by KIND_ORDER). */
export const connectionsFor = (data: SkyData, lockId: number | null): StageItem[] => {
  if (lockId == null) return [];
  const lock = data.movies.find((m) => m.id === lockId);
  if (!lock) return [];

  const conns = data.edges
    .filter((e) => e.a === lockId || e.b === lockId)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4)
    .map((e) => {
      const other = data.movies.find((m) => m.id === (e.a === lockId ? e.b : e.a));
      return other ? { m: other, type: e.type, reason: e.label } : null;
    })
    .filter((c): c is { m: SkyMovie; type: KindId; reason: string } => c !== null)
    .sort((x, y) => KIND_ORDER[x.type] - KIND_ORDER[y.type]);

  const head: StageItem = {
    id: lock.id,
    isLock: true,
    title: lock.title,
    year: lock.year,
    rating: lock.rating,
    takeCount: lock.takeCount,
    posterPath: lock.posterPath,
    hue: hueOf(data, lock),
    kicker: "LOCKED ON",
    dash: [],
    amber: false,
  };

  return [head].concat(
    conns.map((c) => {
      const k = KIND[c.type] ?? KIND.similar;
      return {
        id: c.m.id,
        isLock: false,
        title: c.m.title,
        year: c.m.year,
        rating: c.m.rating,
        takeCount: c.m.takeCount,
        posterPath: c.m.posterPath,
        hue: hueOf(data, c.m),
        type: c.type,
        reason: c.reason,
        kicker: k.label,
        dash: k.dash,
        amber: !!k.amber,
      };
    })
  );
};

export interface KindColumn {
  label: string;
  dash: number[];
  colour: string;
  firstIdx: number;
  dots: number[];
}

/** Group connection cards by kind for the dot-index (no LOCKED column). */
export const kindIndex = (items: StageItem[], lockHue: string): KindColumn[] => {
  const cols: KindColumn[] = [];
  items.forEach((it, i) => {
    if (!i) return; // skip the locked card — redundant with its title
    let col = cols.find((c) => c.label === it.kicker);
    if (!col) {
      col = {
        label: it.kicker,
        dash: it.dash,
        colour: it.amber ? AMBER : tintHex(lockHue, 0.45),
        firstIdx: i,
        dots: [],
      };
      cols.push(col);
    }
    col.dots.push(i);
  });
  return cols;
};

// ── §5 spectrum scrub model ──────────────────────────────────────────────────

export interface ScrubBand {
  hue: string;
  widthPct: number;
  centerPct: number;
}

export interface ScrubModel {
  bands: ScrubBand[];
  active: { label: string; centerPct: number; hue: string } | null;
}

export const scrubSpectrum = (genres: SkyGenre[], activeIndex: number): ScrubModel => {
  if (genres.length === 0) return { bands: [], active: null };
  const tot = genres.reduce((s, g) => s + g.n, 0) || 1;
  let acc = 0;
  const bands = genres.map((g) => {
    const start = (acc / tot) * 100;
    acc += g.n;
    const end = (acc / tot) * 100;
    return { hue: g.hue, widthPct: end - start, centerPct: (start + end) / 2 };
  });
  const gi = Math.max(0, Math.min(activeIndex, genres.length - 1));
  const g = genres[gi];
  return {
    bands,
    active: {
      label: `${(g.label || g.key).toUpperCase()} · ${g.n} FILM${g.n === 1 ? "" : "S"}`,
      centerPct: bands[gi].centerPct,
      hue: g.hue,
    },
  };
};

/** Map a 0..1 drag position to a genre index, proportional to film counts. */
export const scrubToIndex = (fraction: number, genres: SkyGenre[]): number => {
  if (genres.length === 0) return 0;
  const f = Math.max(0, Math.min(0.999, fraction));
  const tot = genres.reduce((s, g) => s + g.n, 0) || 1;
  let acc = 0;
  for (let i = 0; i < genres.length; i++) {
    acc += genres[i].n / tot;
    if (f < acc) return i;
  }
  return genres.length - 1;
};
