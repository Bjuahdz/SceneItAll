// Replays the approved Paper simulations against the real skyline packer.
//
// jest hangs in this environment, so this runs as a plain node script on every
// `npm run verify`. Node strips the TypeScript itself (v22.18+ / v23+); the packer's
// only import is `import type`, which is erased, so nothing else is ever loaded.
//
// These are not invented cases. Each SIM below is a board Bryan reviewed on the
// canvas and signed off, so a failure here means the code and the approved design
// have come apart — not that a test needs updating.
import {
  boardMetrics,
  findEnclosedHoles,
  packRecents,
  shapeFor,
} from "../services/recentsBoard.ts";

const M = boardMetrics(350, 8);

let seq = 0;
const row = (entity_type, title, opts = {}) => ({
  entity_type,
  entity_id: ++seq,
  title,
  year: null,
  subtitle: null,
  image_path: opts.noArt ? null : `/${title}.jpg`,
  searched_at: seq,
  hits: 1,
  session_id: opts.session ?? 1,
});
const person = (t, o) => row("person", t, o);
const film = (t, o) => row("movie", t, o);
const studio = (t, o) => row("company", t, { ...o, noArt: true });

/** Fixtures are written OLDEST FIRST, the way the sessions actually happened. */
const pack = (oldestFirst) => packRecents([...oldestFirst].reverse(), M);
/** A tile's bottom edge in units, measured up from the foundation. */
const baseOf = (board, t) => Math.round((board.height - t.y - t.height) / M.unit);

const failures = [];
const check = (name, cond, detail = "") => {
  if (!cond) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};
const eqSkyline = (name, board, want) =>
  check(
    name,
    board.skyline.length === want.length && board.skyline.every((h, i) => h === want[i]),
    `skyline [${board.skyline}], wanted [${want}]`
  );
const sound = (name, board) => {
  const holes = findEnclosedHoles(board, M);
  check(`${name} · brick test`, holes.length === 0, holes.join("; "));
};

/** A tile's footprint on the unit grid, recovered from its rendered rect. */
const cellsOf = (board, t) => ({
  base: baseOf(board, t),
  start: Math.round(t.x / (M.colWidth + M.gap)),
  width: Math.round((t.width + M.gap) / (M.colWidth + M.gap)),
  tall: Math.round((t.height + M.gap) / M.unit),
});

/**
 * ▸ NO SPAN SITS ON A SPAN WITH THE SAME FOOTPRINT.
 *
 * This is the rule that keeps the span rare now that closing a session no longer
 * earns it, so it is asserted STRUCTURALLY off the packed board rather than trusted
 * from the placement code. A span levels the columns it covers, which makes those
 * same columns immediately eligible again — without the guard, a film-heavy history
 * stacks identical banners forever, which is the trap the old last-query clause
 * existed for.
 *
 * ⚠ THE FOOTPRINT, NOT "IS IT A SPAN". Bryan caught the blunt version on device: a
 * three-wide banner over a two-wide one is not a repeat, it is the interlocking the
 * board exists for, and refusing it left a session-closing Barbie as a small tile in
 * the corner of a level board.
 */
const noRepeatedSpanFootprint = (name, board) => {
  const at = new Map();
  for (const t of board.tiles) {
    const { base, start, width, tall } = cellsOf(board, t);
    for (let c = start; c < start + width; c++)
      for (let u = base; u < base + tall; u++) at.set(`${c}:${u}`, t);
  }
  for (const t of board.tiles) {
    if (!t.span) continue;
    const me = cellsOf(board, t);
    if (me.base === 0) continue;
    const below = at.get(`${me.start}:${me.base - 1}`);
    if (!below?.span) continue;
    const it = cellsOf(board, below);
    if (it.start === me.start && it.width === me.width) {
      check(
        `${name} · no repeated span footprint`,
        false,
        `${t.search.title} repeats ${below.search.title} at cols ${me.start}..${me.start + me.width - 1}`
      );
      return;
    }
  }
};

// ── The tile vocabulary is keyed on ARTWORK, not entity type ────────────────
check("shape · person with a photo is portrait", shapeFor(person("a")) === "portrait");
check("shape · film with a backdrop is landscape", shapeFor(film("b")) === "landscape");
check("shape · studio is always a wordmark", shapeFor(studio("c")) === "wordmark");
check(
  "shape · a person with NO photo is a wordmark, not a portrait",
  shapeFor(person("d", { noArt: true })) === "wordmark",
  "80% of a film's crew have no profile photo — they cannot hold a 2:3 tile"
);

// ⚠ THE EXPECTED SKYLINES BELOW ARE THREE-COLUMN RESULTS.
// They were recomputed when the board went from 2 columns to 3 (Bryan, 2026-08-03).
// The Paper simulations they are named after were drawn at 2 columns, so those boards
// are now a record of the REASONING, not of the current geometry — the rules they
// exercise (span gate, notch fill, brick test, stability) are unchanged and are still
// what these assert.

// ── SIM 1 · Pratt → Lawrence → Passengers → Sandler ─────────────────────────
// Passengers lands on a LEVEL skyline but does not close the session, so no span.
{
  const b = pack([person("Pratt"), person("Lawrence"), film("Passengers"), person("Sandler")]);
  eqSkyline("SIM 1", b, [2, 3, 2]);
  sound("SIM 1", b);
  const passengers = b.tiles.find((t) => t.search.title === "Passengers");
  check(
    "SIM 1 · Passengers does NOT span",
    !passengers.span,
    "level is not enough — it must also close the session"
  );
}

// ── SIM 2 · Ortega → Sinners → Goth → Ghibli → Jackman → Taylor-Joy ─────────
// Closes perfectly level with zero holes. No span is ever available: Sinners lands
// uneven, Ghibli lands uneven AND is a wordmark, Taylor-Joy closes but is a portrait.
{
  const b = pack([
    person("Ortega"),
    film("Sinners"),
    person("Goth"),
    studio("Ghibli"),
    person("Jackman"),
    person("TaylorJoy"),
  ]);
  eqSkyline("SIM 2", b, [4, 2, 4]);
  sound("SIM 2", b);
  check("SIM 2 · no tile spans", b.tiles.every((t) => !t.span));
  // Ghibli still fills the one-unit notch Sinners left — the rule survives both the
  // column change and the fingerprint tie-break, even though the skyline does not.
  const ghibli = b.tiles.find((t) => t.search.title === "Ghibli");
  check("SIM 2 · Ghibli lands in the notch at unit 1", baseOf(b, ghibli) === 1);
}

// ── SIM 3 · the same session cut short on Dune ──────────────────────────────
// Dune closes the session on a level plane, so it spans.
{
  const b = pack([
    person("Ortega"),
    film("Sinners"),
    person("Goth"),
    studio("Ghibli"),
    film("Dune"),
  ]);
  eqSkyline("SIM 3", b, [5, 5, 5]);
  sound("SIM 3", b);
  const dune = b.tiles.find((t) => t.search.title === "Dune");
  check("SIM 3 · Dune spans", dune.span, "last query of the session on a level skyline");
  check("SIM 3 · the span is full width", dune.width === M.spanWidth);
  check("SIM 3 · the span sits at the top", dune.y === 0);
  check(
    "SIM 3 · the span keeps a film's crop",
    Math.abs(dune.width / dune.height - M.colWidth / M.wideHeight) < 0.06,
    `span ${(dune.width / dune.height).toFixed(2)} vs wide ${(M.colWidth / M.wideHeight).toFixed(2)} — SPAN_UNITS is what keeps these together`
  );
}

// ── A PARTIAL SPAN fills the free columns beside a portrait ─────────────────
// Bryan's Bruce Lee / Ender's Game case: a session of [person, film] on a level board
// leaves the portrait in one column and two free columns beside it, and the film
// closes the session so it takes BOTH rather than sitting narrow in one.
//
// ⚠ Only when the portrait lands on an EDGE. Since the tie-break became a fingerprint
// it can just as easily land in the MIDDLE, which splits the free columns so they are
// no longer adjacent and no span is possible — that is the disparity, working. So this
// asserts the RULE across many entities rather than pinning one arrangement.
{
  const cols = (t) => Math.round((t.width + M.gap) / (M.colWidth + M.gap));
  const colOf = (t) => Math.round(t.x / (M.colWidth + M.gap));
  let spanned = null;
  for (let n = 0; n < 40 && !spanned; n++) {
    const b = pack([
      person(`L1_${n}`, { session: 1 }),
      person(`L2_${n}`, { session: 1 }),
      person(`L3_${n}`, { session: 1 }), // levels the board at 2
      person(`Star${n}`, { session: 2 }),
      film(`Film${n}`, { session: 2 }),
    ]);
    sound(`partial span · pass ${n}`, b);
    const star = b.tiles.find((t) => t.search.title === `Star${n}`);
    const f = b.tiles.find((t) => t.search.title === `Film${n}`);
    if (f.span) spanned = { b, star, f };
  }
  check("partial span · a portrait on an edge leaves a spannable pair", spanned !== null);
  if (spanned) {
    check("partial span · exactly two columns wide", cols(spanned.f) === 2, `${spanned.f.width}pt`);
    check(
      "partial span · sits beside the portrait, not over it",
      colOf(spanned.f) !== colOf(spanned.star)
    );
    check(
      "partial span · k columns is k units, so the crop holds",
      Math.abs(spanned.f.width / spanned.f.height - M.colWidth / M.wideHeight) < 0.06,
      `${(spanned.f.width / spanned.f.height).toFixed(2)} vs ${(M.colWidth / M.wideHeight).toFixed(2)}`
    );
  }
}

// ── THE BRIDGE RULE — a tall tile must not strand the middle column ─────────
// Bryan, device: a lone portrait left in the middle "looks horrible", while his
// hand-drawn film in the middle reads fine. The difference is structural, not
// aesthetic: a TWO-unit tile in the centre splits the floor into two isolated single
// columns that nothing can span, where a ONE-unit tile leaves them usable.
{
  const colOf = (t) => Math.round(t.x / (M.colWidth + M.gap));
  const seen = new Set();
  let openedMiddle = false;
  for (let n = 0; n < 40; n++) {
    const b = pack([person(`B_${n}`)]);
    const c = colOf(b.tiles[0]);
    seen.add(c);
    if (c === 1) openedMiddle = true;
  }
  check(
    "bridge · a lone portrait never opens in the middle",
    !openedMiddle,
    "a 2-unit tile there disconnects the floor"
  );
  check("bridge · but it does use BOTH edges", seen.size === 2, `saw [${[...seen].sort()}]`);

  // And it still reaches the middle when the middle is genuinely the lowest column —
  // the flanked case, which is the one that looks right.
  let flankedMiddle = false;
  for (let n = 0; n < 40 && !flankedMiddle; n++) {
    const b = pack([person(`F1_${n}`), person(`F2_${n}`), person(`F3_${n}`)]);
    if (b.tiles.some((t) => colOf(t) === 1)) flankedMiddle = true;
  }
  check("bridge · a portrait still reaches the middle when flanked", flankedMiddle);

  // Bryan's sketch: person, film, person — the FILM takes the middle at the floor
  // with a gap above it, portraits either side. One unit does not break the bridge,
  // so this arrangement stays reachable.
  let sketch = false;
  for (let n = 0; n < 60 && !sketch; n++) {
    const b = pack([person(`S1_${n}`), film(`S2_${n}`), person(`S3_${n}`)]);
    const f = b.tiles.find((t) => t.search.title === `S2_${n}`);
    const portraits = b.tiles.filter((t) => t.shape === "portrait");
    if (!f.span && colOf(f) === 1 && portraits.every((p) => colOf(p) !== 1)) sketch = true;
  }
  check(
    "bridge · Bryan's sketch is reachable — film centre at the floor, portraits flanking",
    sketch
  );
}

// ── DISPARITY — the tie-break must genuinely vary with the entity ───────────
// Leftmost-always pinned portraits to the edges; this is the assertion that the
// board stopped marching. Same input always gives the same answer (it is a hash, not
// a random number) — across DIFFERENT entities it should reach every column.
// ⚠ Asserted on the FIRST tile of an empty board on purpose. That is the only
// placement where every column is tied and nothing else can influence the outcome, so
// leftmost-always pins it to column 0 every single time and the assertion genuinely
// discriminates. An earlier version counted columns used across a whole session and
// passed under leftmost-always too — a test that cannot fail proves nothing.
{
  const seen = new Set();
  for (let n = 0; n < 30; n++) {
    const b = pack([person(`D_${n}`)]);
    seen.add(Math.round(b.tiles[0].x / (M.colWidth + M.gap)));
  }
  check(
    "disparity · the first search does not always land in column 0",
    seen.size > 1,
    `only ever saw columns [${[...seen].sort()}]`
  );
}

// ── REPRODUCIBILITY — the same history must always pack identically ─────────
// The whole reason the tie-break is a hash and not a random number: a board that
// reshuffled between launches would never build spatial memory.
{
  const rows = [person("R1"), film("R2"), person("R3"), studio("R4"), film("R5")];
  const a = pack(rows);
  const b = pack(rows);
  check(
    "reproducibility · identical input packs identically",
    a.tiles.every((t, i) => t.x === b.tiles[i].x && t.y === b.tiles[i].y && t.key === b.tiles[i].key)
  );
}

// ── THE SPAN IS EARNED BY THE OPENING, NOT BY CLOSING THE SITTING ───────────
// Bryan overruled the last-query gate directly: "that's incorrect... if there's a
// notch that allows a person to fit into it, but then it now leaves a larger gap for
// another movie to span, and it's in the middle of the run, that movie should be able
// to span. It shouldn't ALWAYS span, but it should SOMETIMES span."
//
// Both halves of that "sometimes" are pinned below, and they have to be asserted
// together — either one alone is satisfied by a rule that is simply always on or
// always off.
//
// ⚠ Every fixture here puts the film FIRST in a multi-row sitting, so it cannot be
// closing the session, and starts from an EMPTY board, so the opening is the full
// three columns by construction. A film that does not span there has genuinely
// declined an opening rather than never been offered one.
{
  let took = null;
  for (let n = 0; n < 60 && !took; n++) {
    const b = pack([film(`MID${n}`), film(`MID2_${n}`), person(`MID3_${n}`)]);
    const f = b.tiles.find((t) => t.search.title === `MID${n}`);
    if (f.span) took = { b, f };
  }
  check(
    "span · a film in the MIDDLE of a sitting can take a wide opening",
    took !== null,
    "the last-query clause used to make this unreachable"
  );
  if (took) sound("mid-sitting span", took.b);

  let declined = false;
  for (let n = 0; n < 60 && !declined; n++) {
    const b = pack([film(`DEC${n}`), film(`DEC2_${n}`), person(`DEC3_${n}`)]);
    const f = b.tiles.find((t) => t.search.title === `DEC${n}`);
    if (!f.span) declined = true;
  }
  check("span · but it does NOT always take it", declined, "an always-on rule is just as predictable");

  // ▸ THE WIDER THE OPENING, THE LIKELIER IT IS TAKEN. This is what "it should all
  // depend on what the previous foundation is like" means in the code: three free
  // columns is a real invitation, two is a modest one.
  // The run-2 sample leads with a portrait, which the bridge rule puts on an EDGE, so
  // exactly two adjacent columns are left at the floor.
  let wide = 0;
  let narrow = 0;
  const N = 200;
  for (let n = 0; n < N; n++) {
    const b3 = pack([film(`W${n}`), person(`W2_${n}`)]);
    if (b3.tiles.find((t) => t.search.title === `W${n}`).span) wide++;
    const b2 = pack([person(`N1_${n}`), film(`N${n}`), person(`N3_${n}`)]);
    if (b2.tiles.find((t) => t.search.title === `N${n}`).span) narrow++;
  }
  check(
    "span · a three-column opening is taken more often than a two-column one",
    wide > narrow,
    `full width ${wide}/${N}, partial ${narrow}/${N}`
  );
}

// ── PATTERN DISCONTINUITY — a shape does not land back on its own kind ──────
// Bryan: "it should recognize that that same pattern just happened below. To create a
// bit of visual discontinuity we should shift that... move the movie to the left and
// have the actors on the right, or vice versa."
//
// Measured in aggregate rather than on one fixture, because the rule only fires when
// the bridge score leaves a genuine tie AND the tied columns are topped by different
// shapes — a condition no single hand-built history can be relied on to reach, since
// the fingerprint owns the columns. Across many mixed sittings the board should
// ALTERNATE more often than it repeats.
{
  const stacks = (board) => {
    const at = new Map();
    for (const t of board.tiles) {
      const { base, start, width, tall } = cellsOf(board, t);
      for (let c = start; c < start + width; c++)
        for (let u = base; u < base + tall; u++) at.set(`${c}:${u}`, t);
    }
    let repeat = 0;
    let alternate = 0;
    for (const t of board.tiles) {
      const me = cellsOf(board, t);
      if (me.base === 0) continue;
      const below = at.get(`${me.start}:${me.base - 1}`);
      if (!below) continue;
      if (below.shape === t.shape) repeat++;
      else alternate++;
    }
    return { repeat, alternate };
  };

  let repeat = 0;
  let alternate = 0;
  for (let n = 0; n < 60; n++) {
    // Three sittings of person → film → person, exactly Bryan's repeated pattern.
    const rows = [];
    for (const s of [1, 2, 3]) {
      rows.push(person(`PA${s}_${n}`, { session: s }));
      rows.push(film(`PB${s}_${n}`, { session: s }));
      rows.push(person(`PC${s}_${n}`, { session: s }));
    }
    const b = pack(rows);
    sound(`pattern · pass ${n}`, b);
    const r = stacks(b);
    repeat += r.repeat;
    alternate += r.alternate;
  }
  check(
    "pattern · the board alternates shapes more often than it repeats them",
    alternate > repeat,
    `alternate ${alternate}, repeat ${repeat}`
  );
}

// ── BRYAN'S BARBIE CASE — a wider span may land on a narrower one ───────────
// Device, 2026-08-03: a two-column Super Mario sat at the top of two columns, Elysium
// filled the notch beside it to level the board, and Barbie — closing the session on
// all three free columns — came back as a small tile in the corner. The first version
// of the rarity guard refused ANY span over a span. A three-wide banner over a
// two-wide one is not a repeated pattern; it is the interlocking the board is for.
{
  const b = pack([
    person("BA", { session: 1 }),
    person("BB", { session: 1 }),
    person("BC", { session: 1 }), // levels the board at 2
    person("BD", { session: 2 }),
    film("BE", { session: 2 }), // closes s2 → spans the two columns beside BD
    film("BF", { session: 3 }), // closes s3 on a level board → must take all three
  ]);
  sound("barbie", b);
  const partial = b.tiles.find((t) => t.search.title === "BE");
  const full = b.tiles.find((t) => t.search.title === "BF");
  check("barbie · the earlier film takes the two free columns", partial.span);
  check(
    "barbie · and the next one still takes all THREE over the top of it",
    full.span && full.width === M.spanWidth,
    `${Math.round(full.width)}pt of ${M.spanWidth} — this is the tile that came back small on device`
  );
  noRepeatedSpanFootprint("barbie", b);
}

// ── The trap: a film-only history must not collapse into a stack of banners ──
// This is what the last-query clause used to prevent and what `spanUnder` prevents
// now. Asserted across many histories rather than one: the decision is per-entity, so
// a single fixture can pass by luck.
{
  let sawASpan = false;
  for (let n = 0; n < 30; n++) {
    const b = pack(Array.from({ length: 6 }, (_, i) => film(`F${n}_${i}`)));
    sound(`films only · pass ${n}`, b);
    noRepeatedSpanFootprint(`films only · pass ${n}`, b);
    if (b.tiles.some((t) => t.span)) sawASpan = true;
  }
  check(
    "films only · the rule is not simply off",
    sawASpan,
    "no span in 30 film-only sittings would mean the gate never opens"
  );
}

// ── Unknown sessions never earn a span ──────────────────────────────────────
// Rows written before R2 carry no session_id. We cannot say whether one closed a
// sitting, and guessing would be inventing data to justify a bigger tile.
{
  const b = pack([
    { ...person("Old1"), session_id: null },
    { ...film("Old2"), session_id: null },
  ]);
  sound("null sessions", b);
  check("null sessions · nothing spans", b.tiles.every((t) => !t.span));
}

// ── Bryan's Odyssey case: a later 1-unit tile is pulled forward to fill a notch ─
// ⚠ The fixture was rebuilt for three columns. The old one ended session 1 on a
// TWO-unit spread, which at three columns the packer levels on its own — so the
// assertion passed without the rule ever firing. Session 1 now closes on a spread of
// exactly one, which is the state the pull-forward exists for.
{
  const b = pack([
    person("A", { session: 1 }),
    person("B", { session: 1 }),
    film("Bw", { session: 1 }), // closes session 1 one unit below the others
    person("C", { session: 2 }),
    film("Odyssey", { session: 2 }),
    person("E", { session: 2 }),
  ]);
  sound("notch fill", b);
  const odyssey = b.tiles.find((t) => t.search.title === "Odyssey");
  const c = b.tiles.find((t) => t.search.title === "C");
  check(
    "notch fill · the film is pulled forward, under the portrait that followed it",
    baseOf(b, odyssey) < baseOf(b, c),
    `Odyssey at unit ${baseOf(b, odyssey)}, C at unit ${baseOf(b, c)}`
  );
}

// ── THE STABILITY GUARANTEE — the whole reason the packer runs oldest-first ──
// Adding newer searches must not move a single tile that is already on the board.
// Measured from the FOUNDATION, because the board grows upward: y changes for every
// tile when the board gets taller, but the distance from the bottom must not.
{
  const before = [person("P1"), film("F1"), person("P2"), studio("S1")];
  const after = [...before, person("P3"), film("F2", { session: 2 })];
  const a = pack(before);
  const bb = pack(after);
  for (const t of a.tiles) {
    const moved = bb.tiles.find((x) => x.key === t.key);
    check(
      `stability · ${t.search.title} keeps its place`,
      moved && baseOf(a, t) === baseOf(bb, moved) && moved.x === t.x,
      `unit ${baseOf(a, t)} → ${moved ? baseOf(bb, moved) : "gone"}`
    );
  }
}

// ── Geometry closes: two wides stack to exactly one portrait ────────────────
check(
  "metrics · tallHeight === 2 × wideHeight + gap",
  Math.abs(M.tallHeight - (2 * M.wideHeight + M.gap)) < 0.001,
  `${M.tallHeight} vs ${2 * M.wideHeight + M.gap}`
);
check(
  "metrics · every column and its gaps fill the content width",
  M.colWidth * M.columns + M.gap * (M.columns - 1) === M.spanWidth,
  `${M.columns} cols of ${M.colWidth} → ${M.spanWidth}`
);

if (failures.length > 0) {
  console.error(`\n✗ recents packer — ${failures.length} failure(s):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  console.error("");
  process.exit(1);
}
console.log("✓ recents packer clean");
