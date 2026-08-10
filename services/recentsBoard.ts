// ─────────────────────────────────────────────────────────────────────────────
// THE RECENTS BOARD — the skyline packer.
//
// Pure. No React, no React Native, no network, no clock. `RecentSearch[]` in,
// positioned rectangles out. That is deliberate: this is the only part of the
// board that can be proven correct without a device, and everything downstream is
// wrong invisibly if it is wrong. `scripts/check-recents-pack.mjs` replays the
// three approved Paper simulations against it on every `npm run verify`.
//
// Design and reasoning live in SEARCH-IMPLEMENTATION-PLAN.md under "RECENT BOARD".
// The short version:
//
//   · THE UNIT. A landscape tile plus one gap. A portrait is exactly two of them,
//     so every piece is a whole number of units and a tile can never land half-off
//     a row. That is what makes enclosed gaps structurally impossible.
//   · SHAPE, NOT TYPE. Tiles are keyed on the shape of the ARTWORK, not on what
//     the entity is. TV shows are next and must cost this file nothing: a show is
//     landscape, and it is done. Books, when they come, are portrait.
//   · OLDEST FIRST, FROM THE BOTTOM. The board renders newest-at-top and grows
//     upward, so a new search translates everything below it down and re-packs
//     nothing. Packing newest-first would re-decide every placement beneath each
//     insert and reshuffle the whole board on every search.
//   · NO RANDOMNESS. All the variety comes from the shape sequence the user
//     actually searched. A random seed would rearrange the board between launches
//     and destroy the spatial memory that makes it worth looking at.
// ─────────────────────────────────────────────────────────────────────────────
import type { RecentSearch } from "./db";

/**
 * What the packer cares about, which is only ever the shape of the picture.
 *
 * `wordmark` is not "a studio" — it is "there is no artwork". Studios earn it by
 * decision (TMDB ships black- and white-on-transparent logos with no field to tell
 * them apart, so we never render one), but so does the 80% of a film's crew with no
 * profile photo, and so does a collection with no backdrop. One branch, not three.
 */
export type TileShape = "portrait" | "landscape" | "wordmark";

/**
 * ▸ HOW MANY COLUMNS THE BOARD RUNS.
 *
 * Was 2, and the argument for it was a floor on tile width — 168pt on a 390 screen,
 * because three across is where text starts to squeeze. Bryan overruled that on
 * device (2026-08-03) after seeing the real board: two columns reads chunky, and the
 * board wants density more than it wants big tiles.
 *
 * Everything downstream is derived from this number rather than assuming a pair, so
 * changing it back is one edit. What it costs is text: at three columns a tile is
 * ~111pt wide, so the type scale drops and the meta lane survives only on spans.
 */
const COLUMNS = 3;

/**
 * ▸ A LANDSCAPE TILE ACROSS k COLUMNS IS k UNITS TALL.
 *
 * One rule covering every width, and it is what keeps a film cropped the same way at
 * any size: k=3 gives 349×254 (1.37), k=2 gives 230×166 (1.38), k=1 gives 111×79
 * (1.40). The ordinary single wide tile is simply the k=1 case. Anything else is a
 * different crop — a full-width tile at 2 units would be 2.1, a letterbox.
 *
 * Height turns out to be uniform across the whole vocabulary: `units × unit − gap`
 * gives `wideHeight` at 1 and `tallHeight` at 2 by construction, so nothing needs a
 * special case.
 */
const spanUnits = (cols: number) => cols;

export interface BoardMetrics {
  columns: number;
  /** One column. `columns` of these plus the gaps between them is the content width. */
  colWidth: number;
  gap: number;
  /** A landscape tile plus one gap. THE unit — everything is a multiple of it. */
  unit: number;
  /** A portrait: 2:3, uncropped. Exactly two units minus the trailing gap. */
  tallHeight: number;
  /** A landscape tile. */
  wideHeight: number;
  /** A landscape tile across EVERY column — the widest a span can be. */
  spanWidth: number;
}

/**
 * Derived from the content width, never hard-coded.
 *
 * MARQUEE carries the scar that motivates this: a `width: 350` lifted straight off a
 * 390pt board agreed with the real column on the phone it was drawn for and silently
 * disagreed on every wider one. So the only inputs here are the width the board
 * actually has and the gap, and the invariant `tallHeight === 2 * wideHeight + gap`
 * holds by construction rather than by two constants happening to match.
 */
export const boardMetrics = (contentWidth: number, gap = 8): BoardMetrics => {
  const colWidth = Math.floor((contentWidth - gap * (COLUMNS - 1)) / COLUMNS);
  // 2:3 portrait — the aspect TMDB profiles actually ship at, so a face is never
  // cropped to fit a box we chose.
  const tallHeight = (colWidth * 3) / 2;
  const wideHeight = (tallHeight - gap) / 2;
  const unit = wideHeight + gap;
  return {
    columns: COLUMNS,
    colWidth,
    gap,
    unit,
    tallHeight,
    wideHeight,
    spanWidth: colWidth * COLUMNS + gap * (COLUMNS - 1),
  };
};

export const shapeFor = (r: RecentSearch): TileShape => {
  if (!r.image_path) return "wordmark";
  if (r.entity_type === "company") return "wordmark";
  return r.entity_type === "person" ? "portrait" : "landscape";
};

/** Portraits are two units tall. Everything else is one. */
export const unitsFor = (shape: TileShape): number => (shape === "portrait" ? 2 : 1);

/**
 * ▸ THE EXACT URL A TILE WILL REQUEST. `null` for anything with no picture.
 *
 * Lives here, beside `shapeFor`, because the SIZE is a consequence of the shape and the
 * two must not be able to disagree. It exists so the artwork can be PREFETCHED at the
 * moment a search is committed rather than at the moment the board animates it —
 * otherwise the newest tiles are fetching over the network during their own arrival and
 * land as empty boxes (Bryan, device: "the new ones are coming in and they're just
 * blank").
 *
 * ⚠ It must be the same string, not merely the same picture: a different width is a
 * different cache key, so prefetching `w500` for a tile that asks for `w342` spends the
 * request and warms nothing. That is also why this costs no extra traffic — it is the
 * request the board was always going to make, moved earlier.
 */
export const tileArtUri = (r: RecentSearch): string | null => {
  const shape = shapeFor(r);
  if (shape === "wordmark" || !r.image_path) return null;
  return `https://image.tmdb.org/t/p/${shape === "portrait" ? "w342" : "w780"}${r.image_path}`;
};

/**
 * ▸ A STABLE FINGERPRINT OF ONE ENTITY. FNV-1a over its type and id.
 *
 * Used to break ties between columns of equal height — see `pickColumn`. It is a
 * HASH, not a random number, and the distinction is the whole point: a TMDB id never
 * changes, so a given search resolves to the same choice on every launch, on every
 * device, forever. The board looks arbitrary and is completely reproducible.
 *
 * Randomness here would have been much easier and much worse: the layout would
 * reshuffle every time the app cold-started, and the spatial memory that makes a
 * board worth scrolling — "Tim Roth was the tall one in the middle" — would never
 * form.
 *
 * Exported because MOTION wants the same property layout does: the lateral drift a
 * tile arrives on has to vary between tiles and be identical for one tile forever.
 * Two mechanisms for "arbitrary but reproducible" would be one too many.
 */
export const fingerprint = (r: RecentSearch): number => {
  const s = `${r.entity_type}:${r.entity_id}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export interface PositionedTile {
  key: string;
  search: RecentSearch;
  shape: TileShape;
  /** True for the full-width landscape tile — see the span gate in `packRecents`. */
  span: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackedBoard {
  /** In PLACEMENT order, which is oldest first. Positions are absolute, so render
   *  order is irrelevant — but it is stable, which React reconciliation cares about. */
  tiles: PositionedTile[];
  /** Total board height in px. */
  height: number;
  /** Column heights in UNITS, one entry per column. All equal means a level
   *  frontier. Exposed because it is what the simulation tests assert against. */
  skyline: number[];
}

interface Placed {
  search: RecentSearch;
  shape: TileShape;
  span: boolean;
  /** Leftmost column this tile occupies. */
  col: number;
  /** How many columns wide. 1 for an ordinary tile, 2..COLUMNS for a span. */
  cols: number;
  /** Unit index of this tile's BOTTOM edge, counted up from the board's foundation. */
  base: number;
  units: number;
}

/**
 * Consecutive rows sharing a `session_id` are one sitting.
 *
 * A null session (every row written before R2) is its own group and is marked
 * UNKNOWN. Unknown sessions never earn a span and never reorder: we cannot say
 * whether such a row closed a sitting, and reconstructing one from gaps between
 * timestamps would be inventing data to justify a bigger tile.
 */
const sessionsOf = (oldestFirst: RecentSearch[]): { rows: RecentSearch[]; known: boolean }[] => {
  const out: { rows: RecentSearch[]; known: boolean }[] = [];
  for (const r of oldestFirst) {
    const id = r.session_id ?? null;
    const prev = out[out.length - 1];
    if (id !== null && prev?.known && (prev.rows[0].session_id ?? null) === id) {
      prev.rows.push(r);
    } else {
      out.push({ rows: [r], known: id !== null });
    }
  }
  return out;
};

/**
 * ▸ THE PACK.
 *
 * @param recents NEWEST FIRST, exactly as `getRecentSearches` returns them.
 */
export const packRecents = (recents: RecentSearch[], metrics: BoardMetrics): PackedBoard => {
  const { columns, colWidth, gap, unit } = metrics;
  const skyline: number[] = new Array(columns).fill(0);
  /**
   * ▸ WHAT IS CURRENTLY AT THE TOP OF EACH COLUMN — the board's short-term memory.
   *
   * The skyline says how HIGH each column is; this says what is up there. It is the
   * only state the anti-repeat rules need, and both of them are the same idea applied
   * at different scales: never put a thing straight back on top of itself. See
   * `repeatsSpanBelow` for the span case and `pickColumn` for the shape case.
   */
  const topTile: (Placed | null)[] = new Array(columns).fill(null);
  const placed: Placed[] = [];
  /** Longest unbroken run of columns sitting at the floor of a given skyline. */
  const runAtFloor = (sky: number[]) => {
    const min = Math.min(...sky);
    let best = 0;
    for (let i = 0; i < columns; ) {
      if (sky[i] !== min) {
        i++;
        continue;
      }
      let j = i;
      while (j < columns && sky[j] === min) j++;
      if (j - i > best) best = j - i;
      i = j;
    }
    return best;
  };

  /**
   * ▸ SHORTEST COLUMN WINS. DON'T BREAK THE FLOOR. THE ENTITY BREAKS WHAT'S LEFT.
   *
   * Three rules, in that order, and the middle one is the one Bryan's drawing taught.
   *
   * ▸ THE MIDDLE COLUMN IS A BRIDGE. Putting a TALL tile there splits the floor into
   * two isolated single columns: nothing can span them, and each has to be filled
   * alone. That is why a lone portrait stranded in the middle reads as broken (Bryan,
   * device: "it placed Alicia Herbert awkwardly in the middle and it just looks
   * horrible") while a lone FILM in the middle reads fine — the film is one unit, so
   * the columns either side of it stay usable. It is the same reason the boards he
   * liked never disconnect the floor.
   *
   * So each candidate is scored by the longest unbroken run of floor it LEAVES
   * BEHIND, and the best score wins. On a level board a two-unit tile scores 2 at
   * either edge and 1 in the middle, so portraits open at an edge — and a portrait
   * still lands centre whenever the centre is genuinely the lowest column, which is
   * the flanked case that looks right.
   *
   * ▸ THE FINGERPRINT BREAKS WHAT REMAINS. Ties are constant here — every level row
   * is a three-way tie — and resolving them LEFTMOST made the board march left to
   * right, pinning portraits to one edge. A hash of the entity's own type and id
   * chooses instead: arbitrary-looking, and identical on every launch forever.
   *
   * Every candidate is a floor column, so the brick test is untouched throughout —
   * only WHICH floor column wins is in question, never whether a hole can open.
   */
  const pickColumn = (search: RecentSearch, shape: TileShape, units: number) => {
    const min = Math.min(...skyline);
    const tied: number[] = [];
    for (let c = 0; c < columns; c++) if (skyline[c] === min) tied.push(c);
    if (tied.length === 1) return tied[0];

    let best = -1;
    let good: number[] = [];
    for (const c of tied) {
      const trial = skyline.slice();
      trial[c] += units;
      const score = runAtFloor(trial);
      if (score > best) {
        best = score;
        good = [c];
      } else if (score === best) {
        good.push(c);
      }
    }
    /**
     * ▸ DON'T PUT THE SAME SHAPE STRAIGHT BACK ON TOP OF ITSELF.
     *
     * Bryan's pattern rule, and it is what makes two identical sittings look different:
     * "it should recognize that that same pattern just happened below. To create a bit
     * of visual discontinuity we should shift that... move the movie to the left and
     * have the actors on the right, or vice versa."
     *
     * Worked example, his: a sitting of person → film → person leaves portraits on the
     * edges and the film in the middle. The NEXT identical sitting, on a level board,
     * reaches the same fork — the film is tied between the two free columns and the
     * bridge score cannot separate them. Preferring the column whose top tile is a
     * different shape sends the film to the edge instead, which forces the second
     * portrait into the middle and produces the mirrored arrangement he drew.
     *
     * ⚠ A FILTER ON THE TIE, NOT A NEW RULE. It only ever chooses among columns the
     * bridge score has already declared equal, so the floor stays connected and the
     * brick test is untouched. When every tied column repeats — or none does — it
     * changes nothing and the fingerprint decides as before.
     */
    const fresh = good.filter((c) => topTile[c]?.shape !== shape);
    const pool = fresh.length > 0 ? fresh : good;
    return pool[fingerprint(search) % pool.length];
  };
  /**
   * ▸ THE WIDEST ADJACENT RUN OF COLUMNS SITTING AT THE FLOOR.
   *
   * This is what a span is allowed to fill, and it is a generalisation of the rule it
   * replaces. That one demanded EVERY column be level, which meant a session ending
   * `[+2, 0, 0]` — a portrait on the left, two free columns beside it — put its film
   * in one narrow column and left the other empty (Bryan, device: "Ender's Game
   * should be able to expand on that notch instead of it just being super small").
   *
   * Level-across-the-whole-board is now just the case where the run happens to be
   * every column. ADJACENT matters: `[0, +2, 0]` has two columns at the floor but a
   * tile cannot bridge the one between them, so that is a run of one and no span.
   */
  const floorRun = () => {
    const min = Math.min(...skyline);
    let best = { start: 0, length: 0 };
    for (let i = 0; i < columns; ) {
      if (skyline[i] !== min) {
        i++;
        continue;
      }
      let j = i;
      while (j < columns && skyline[j] === min) j++;
      if (j - i > best.length) best = { start: i, length: j - i };
      i = j;
    }
    return best;
  };

  /**
   * ▸ NEVER THE SAME SPAN TWICE, STACKED. This is what keeps the span rare, now that
   * closing a session is no longer what earns it.
   *
   * Bryan: "if it already spanned once, make sure that it doesn't span again in the
   * same scenario... or, even better, if it does want to produce the same pattern, we
   * should make it so that they don't overlap automatically on top of each other so
   * that it doesn't just create the same pattern." A span levels the columns it covers,
   * which immediately makes those same columns eligible again — so without a guard the
   * widest-tile case feeds itself and a film-heavy history becomes a stack of identical
   * banners. That is the exact failure the old last-query clause existed to prevent.
   *
   * ⚠ THE FOOTPRINT IS THE TEST, NOT "IS IT A SPAN". The first version of this blocked
   * a span from landing on ANY column topped by a span, and Bryan caught it on device:
   * a two-column Super Mario sat at columns 1–2, Elysium filled the notch beside it to
   * level the board, and Barbie — closing the session, offered all three columns —
   * came back as a small tile in the corner. A three-wide banner over a two-wide one is
   * not a repeated pattern; it is exactly the interlocking the board is for. Only an
   * IDENTICAL footprint directly beneath is a repeat, and only that is refused.
   */
  const repeatsSpanBelow = (run: { start: number; length: number }) => {
    const below = topTile[run.start];
    return !!below && below.span && below.col === run.start && below.cols === run.length;
  };

  /**
   * ▸ A MID-SITTING FILM TAKES A WIDE OPENING SOMETIMES, NOT ALWAYS.
   *
   * Bryan's correction, and it is the point of the rewrite: "it should all depend on
   * what the previous foundation is like. If there's a notch that allows a person to
   * fit into it, but then it now leaves a larger gap for another movie to span... that
   * movie should be able to span. It shouldn't ALWAYS span, but it should SOMETIMES
   * span."
   *
   * So the opening itself is the argument: the wider the run the board happens to hand
   * this film, the likelier it is to take it. Two free columns is a modest invitation
   * (1 in 4); the whole board level is a real one (2 in 4). A film that declines simply
   * lands as an ordinary tile, and whatever comes next inherits the same opening.
   *
   * ⚠ THE FINGERPRINT, NOT A DIE — the same reproducibility argument as the column
   * tie-break. A given film in a given foundation resolves the same way on every launch
   * forever; only across different films does it look arbitrary. A random roll here
   * would rearrange the board on every cold start.
   *
   * ⚠ DIFFERENT BITS from the tie-break's `% good.length`, or the two decisions would
   * correlate — a film that spans would also always prefer the same column.
   */
  const takesOpening = (search: RecentSearch, runLength: number) =>
    (fingerprint(search) >>> 16) % 4 < runLength - 1;

  for (const session of sessionsOf([...recents].reverse())) {
    const rows = [...session.rows];

    /**
     * ▸ IN-SESSION NOTCH FILL — Bryan's Odyssey case.
     *
     * If this sitting arrives on a skyline that is uneven by exactly one unit, a
     * one-unit tile from anywhere in the sitting is pulled to the front to fill it,
     * levelling the ground so the rest of the batch lands square.
     *
     * Scoped to ONE session on purpose. Reordering inside a single sitting is
     * defensible — those searches are effectively simultaneous — while reordering
     * across sessions would move tiles that are already on the board, which is the
     * one thing this packer must never do.
     */
    if (session.known && Math.max(...skyline) - Math.min(...skyline) === 1) {
      const i = rows.findIndex((r) => unitsFor(shapeFor(r)) === 1);
      if (i > 0) rows.unshift(...rows.splice(i, 1));
    }

    rows.forEach((search, i) => {
      const shape = shapeFor(search);
      const units = unitsFor(shape);
      /**
       * ▸ THE SPAN RULE — the opening decides, and the sitting's end is only ONE way
       * of earning it.
       *
       * ⚠ THIS USED TO REQUIRE THE TILE TO CLOSE ITS SESSION, and Bryan overruled it
       * directly: "that's incorrect. It should all depend on what the previous
       * foundation is like. If there's a notch that allows a person to fit into it, but
       * then it now leaves a larger gap for another movie to span, and it's in the
       * middle of the run, that movie should be able to span." The last-query clause
       * was never really about punctuation — it was doing a job it was badly suited to,
       * which was keeping the span RARE, and it paid for that by making every span land
       * in the same place in a sitting. Predictable in exactly the way he objected to.
       *
       * So a landscape tile spans the widest adjacent run of floor columns when:
       *   · the run is at least two columns wide — a run of one IS the ordinary tile,
       *     so it falls through rather than being dressed up (k=1 is k units either
       *     way), and
       *   · it is not about to stack on another span (`spanUnder` — the rarity rule
       *     that replaces the last-query clause), and
       *   · it either CLOSES the sitting, which still always takes the opening and
       *     keeps the full-stop reading as the common case, or it takes the opening
       *     opportunistically on its own fingerprint (`takesOpening`).
       *
       * ⚠ Portraits never span (a 2:3 face crushed into a landscape box is a band
       * across it) and neither do wordmarks (a name at full width is a large empty
       * box, and no artwork earns that room). `shape === "landscape"` says both.
       */
      const closesSession = i === rows.length - 1;
      if (shape === "landscape" && session.known) {
        const run = floorRun();
        if (
          run.length >= 2 &&
          !repeatsSpanBelow(run) &&
          (closesSession || takesOpening(search, run.length))
        ) {
          const base = skyline[run.start];
          const tall = spanUnits(run.length);
          const tile: Placed = {
            search,
            shape,
            span: true,
            col: run.start,
            cols: run.length,
            base,
            units: tall,
          };
          placed.push(tile);
          for (let c = run.start; c < run.start + run.length; c++) {
            skyline[c] = base + tall;
            topTile[c] = tile;
          }
          return;
        }
      }
      const col = pickColumn(search, shape, units);
      const tile: Placed = { search, shape, span: false, col, cols: 1, base: skyline[col], units };
      placed.push(tile);
      skyline[col] += units;
      topTile[col] = tile;
    });
  }

  const boardUnits = Math.max(...skyline);
  // n units of pitch, minus the trailing gap the last one carries.
  const height = boardUnits === 0 ? 0 : boardUnits * unit - gap;

  const tiles: PositionedTile[] = placed.map((p) => {
    // Uniform across the whole vocabulary — see `spanUnits`. `units × unit − gap`
    // yields wideHeight at 1 and tallHeight at 2 by construction, so a portrait, a
    // wide tile and a k-column span all measure themselves the same way.
    const h = p.units * unit - gap;
    const w = p.cols * colWidth + (p.cols - 1) * gap;
    return {
      key: `${p.search.entity_type}-${p.search.entity_id}`,
      search: p.search,
      shape: p.shape,
      span: p.span,
      // Packed from the BOTTOM, rendered from the top. This flip is the whole
      // "bricks build upward" property: a new search extends the board at the top
      // and every existing tile keeps its position relative to the foundation.
      x: p.col * (colWidth + gap),
      y: height - p.base * unit - h,
      width: w,
      height: h,
    };
  });

  return { tiles, height, skyline };
};

/**
 * ▸ THE BRICK TEST, as an assertion. Bryan's rule, and the one worth checking:
 *
 *   "You can only add a brick on top of what is already built. You never add one
 *    underneath the foundation."
 *
 * Therefore the only hole a correct board can have is at the very top. A gap
 * anywhere else is unreachable, and seeing one means the packer ran in the wrong
 * direction. Returns a list of problems; empty means the board is sound.
 */
export const findEnclosedHoles = (board: PackedBoard, metrics: BoardMetrics): string[] => {
  const { columns, colWidth, unit, gap } = metrics;
  const occupied = Array.from({ length: columns }, () => new Set<number>());
  const allCols = Array.from({ length: columns }, (_, c) => c);
  for (const t of board.tiles) {
    const heightUnits = Math.round((t.height + gap) / unit);
    // Recover the unit index of the tile's bottom edge from its rendered position.
    const base = Math.round((board.height - t.y - t.height) / unit);
    // And its column span from its width — a span can now be any k from 2 up.
    const start = Math.round(t.x / (colWidth + gap));
    const width = Math.round((t.width + gap) / (colWidth + gap));
    const cols = allCols.slice(start, start + width);
    for (const c of cols) {
      for (let u = base; u < base + heightUnits; u++) {
        if (occupied[c].has(u)) return [`overlap in column ${c} at unit ${u} (${t.key})`];
        occupied[c].add(u);
      }
    }
  }
  const problems: string[] = [];
  for (const c of allCols) {
    for (let u = 0; u < board.skyline[c]; u++) {
      if (!occupied[c].has(u)) problems.push(`enclosed hole in column ${c} at unit ${u}`);
    }
  }
  return problems;
};
