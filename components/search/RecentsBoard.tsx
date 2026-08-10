import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import {
  Easing,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import RecentTile, { LAND_RESOLVE_MS, type LandWeight } from "./RecentTile";
import type { MarqueeRect, MarqueeRemeasure } from "./Marquee";
import { FONT, SEARCH_LAYOUT, SIGNAL, TRACK } from "@/constants/signal";
import { boardMetrics, packRecents, type PositionedTile } from "@/services/recentsBoard";
import { useRecentSearches } from "@/contexts/RecentSearchesContext";
import { useBoolPref } from "@/hooks/useBoolPref";
import { PREF_ANCHOR_GUIDE, PREF_ANCHOR_SKYLINE } from "@/services/prefs";
import type { RecentSearch } from "@/services/db";

/**
 * THE RECENTS BOARD — the Search tab's resting state.
 *
 * All the layout thinking lives in `services/recentsBoard.ts`, which is pure and
 * proven by `npm run verify`. This file does nothing but place what the packer
 * returns, which is the point: if the board ever looks wrong, the question is
 * whether the packer is wrong, and that can be answered without a device.
 *
 * ▸ ABSOLUTE POSITIONING, ONE CANVAS. The packer emits exact rects, so Yoga is not
 * asked to re-derive a layout it cannot express anyway (tiles straddle each other's
 * rows by design). The board reports its own height and the screen's ScrollView
 * scrolls it.
 *
 * ▸ NOT VIRTUALISED, DELIBERATELY, FOR NOW. The read cap is 60 rows
 * (`RECENTS_LIMIT`), so this mounts at most 60 tiles. Virtualising an
 * absolutely-positioned canvas means chopping it into bands at the seams where no
 * tile crosses — real work, and worth doing off a measurement rather than off a
 * guess. Raise the cap first, watch it, then decide.
 */
/**
 * Gap between one tile landing and the next, so a multi-search session cascades
 * rather than arriving as a block.
 *
 * ⚠ 85 WAS BRYAN'S NUMBER and I have changed it, which is worth saying out loud. At 85
 * against a 1120ms landing the tiles overlap almost completely and a sitting reads as
 * one event rather than a sequence — the "too fast" he reported is as much this as it
 * is the travel. 150 lets each tile be seen starting before the next one does, which is
 * the cascade the stagger existed for. If it now feels slow rather than deliberate,
 * this is the number to pull back first.
 */
const LAND_STEP = 150;
/**
 * A beat before the first tile falls.
 *
 * The board has just replaced a full-screen results list, and dropping a card into
 * that same instant means it arrives while the eye is still finding the page. Bryan:
 * "it happens so fast you can barely even notice it." The pause is what makes the
 * arrival legible as an event rather than part of the transition.
 *
 * ⚠ 260 → 420, because the aurora now has to establish first. The light coming up and
 * the first tile falling out of it are meant to be cause and effect; starting them
 * together makes the band look like it is reacting to the tile instead.
 */
const LAND_LEAD = 420;
/** How long after the LAST tile starts before the blurred copies come down. Derived
 *  from the tile's own resolve rather than guessed, plus a margin, so nothing can be
 *  unmounted mid-animation if those timings change. */
const LAND_TOTAL_TAIL = LAND_RESOLVE_MS + 220;
/**
 * ▸ THE MASTHEAD IS LAYOUT-ONLY NOW — the visuals moved to the screen's morph
 * overlay (search.tsx), which draws the same glyphs at the same resting spots and
 * travels them to the collapsed bar as the page scrolls. It had to move: the bar
 * pose must render ABOVE the top-edge glass, and this board lives underneath it.
 * The in-flow copy stays at opacity 0 because its HEIGHT is what `boardTop`
 * measures — every tile converts board-space Y through it, so it must keep
 * occupying exactly the space the visible masthead used to. The cascade rules
 * ("the masthead stands aside for the arrival", back after the last resolve) ride
 * the screen's `headGate` and are unchanged in behaviour.
 */
/**
 * The older tiles sliding into their new places.
 *
 * Slower than a tile's own landing on purpose — a field of a dozen bricks moving at
 * arrival speed reads as the page jolting, where the same distance taken calmly reads
 * as room being made. The curve is a soft decelerate with no overshoot: these tiles
 * are not landing, they are being repositioned, and a spring on them would say
 * otherwise.
 */
const REFLOW_MS = 560;
const REFLOW_EASE = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * ▸ THE ANCHOR (dev toggle, PREF_ANCHOR_SKYLINE): the LOWEST the previous skyline's
 * top row may sit when an anchored arrival begins, measured up from the physical
 * bottom edge — A LIMIT, NOT A DESTINATION. A small session rests wherever it
 * naturally falls (old row high on screen, no scroll, no void); only a session big
 * enough to push the old row PAST this line gets scrolled so the row holds here.
 *
 * ⚠ The spacer that used to force small sessions DOWN to this line is deleted, at
 * Bryan's call: "I don't like the huge black space... it can go up so that it looks
 * more natural." The void was never anything but the spacer.
 *
 * HIGHER = big sessions hold the old row further up the screen. LOWER = tighter to
 * the bottom — below ~100 it hides under the nav pill. Bryan's knob. Exported for
 * the screen's dashed guide line.
 */
export const ANCHOR_LIFT = 120;

interface Arrival {
  /** Tile key → stagger in ms, for the sitting that just closed. */
  delays: Map<string, number>;
  /** Tile key → how far it has to travel to its new home, in board space. */
  shifts: Map<string, { dx: number; dy: number }>;
}
const NO_ARRIVAL: Arrival = { delays: new Map(), shifts: new Map() };

export default function RecentsBoard({
  recents,
  scrollY,
  onArrival,
  onAnchor,
  onOpenEntity,
  onTileLand,
}: {
  recents: RecentSearch[];
  /** The screen's live scroll offset. Written from a plain onScroll prop, read only
   *  by worklets — see the note on it in the search screen. */
  scrollY: SharedValue<number>;
  /**
   * Raised once, on the mount that is about to play an arrival, with how long the whole
   * cascade will take — and raised again with `null` when this board goes away.
   *
   * The screen lights its aurora off this, because that band has to live OUTSIDE the
   * ScrollView or it would scroll with what it is lighting. The `null` matters: touch
   * the search field mid-cascade and this board unmounts, and without it the light
   * would go on burning over the typing list for the rest of its schedule.
   */
  onArrival?: (durationMs: number | null, beats?: number[]) => void;
  /** Asks the screen to jump its ScrollView to `y` before the cascade starts — the
   *  board cannot scroll itself (the ScrollView is the screen's). Called whenever an
   *  anchored arrival is set up, INCLUDING `y = 0` when the session is small enough
   *  to rest naturally — the guide needs the report either way, or success reads as
   *  silence. */
  onAnchor?: (y: number) => void;
  onOpenEntity: (r: RecentSearch, rect?: MarqueeRect, remeasure?: MarqueeRemeasure) => void;
  /** Raised by each arriving tile as it reaches its slot, carrying the tile's mass —
   *  the screen turns it into a haptic if the pref is on and the tab is focused.
   *  Must be identity-stable. */
  onTileLand?: (weight: LandWeight) => void;
}) {
  const { pendingLandSession, clearPendingLand } = useRecentSearches();
  const { width, height: viewportH } = useWindowDimensions();
  /**
   * Where the tile canvas starts inside the scroll content.
   *
   * A tile knows its Y in BOARD space; to know how close it is to the bottom of the
   * screen it needs `contentTop + boardTop + tile.y - scrollY`. `boardTop` is the
   * masthead's height, which is type — so it is measured rather than assumed, and it
   * follows the font if that ever changes.
   */
  const [boardTop, setBoardTop] = useState(0);
  /**
   * Derived from the live window, never a constant.
   *
   * MARQUEE carries the scar: a width lifted off the 390pt board agreed with the
   * real column on that phone and silently disagreed on every wider one, leaving a
   * card narrower than the list it sat in. `useWindowDimensions` also re-runs this on
   * rotation and on iPad split view for free.
   */
  const metrics = useMemo(() => boardMetrics(width - SEARCH_LAYOUT.padH * 2), [width]);
  const board = useMemo(() => packRecents(recents, metrics), [recents, metrics]);

  /**
   * ▸ WHAT ARRIVES, IN WHAT ORDER, AND WHAT IT DISPLACED.
   *
   * All three fall out of one question — which session are we returning from — so they
   * are decided together, ONCE, in a `useState` initialiser. Nothing here can change
   * under a re-render mid-animation.
   *
   * ▸ ONLY WHAT YOU JUST SEARCHED LANDS. Bryan, device: "it kind of just makes all the
   * cards settle down when it's supposed to be just the most recent searches." The
   * first pass choreographed every tile on screen, which turned an arrival into a
   * whole-board reshuffle. `session_id` answers it exactly: the newest session IS the
   * sitting you just finished, whether that was one search or five. Tiles with no
   * session (written before R2) never land — there is no honest way to tell whether
   * they are new, and guessing would animate someone's whole history.
   *
   * ▸ IN THE ORDER THEY WERE SEARCHED. Bob Odenkirk lands, then Oppenheimer, then
   * Howl's Moving Castle, then Kelly Hu. The order comes from `recents` (newest first,
   * so reversed) rather than from where the tiles ended up: the packer is free to
   * reorder inside a sitting to fill a notch, and the cascade should replay the
   * SEARCHES, not the packing. It runs bottom-up on screen as a result, which is the
   * same direction the board builds.
   */
  const [arrival] = useState<Arrival>(() => {
    // READ ONLY — the token is cleared in an effect below, never here. A state
    // initialiser can be invoked more than once for a single mount, and consuming a
    // one-shot inside it would spend the animation on a render React then discards.
    const pending = pendingLandSession();
    if (pending === null) return NO_ARRIVAL;
    const fresh = recents.filter((r) => r.session_id === pending);
    if (fresh.length === 0) return NO_ARRIVAL;

    const delays = new Map<string, number>();
    [...fresh]
      .reverse()
      .forEach((r, i) =>
        delays.set(`${r.entity_type}-${r.entity_id}`, LAND_LEAD + i * LAND_STEP)
      );

    /**
     * ▸ WHERE EVERYTHING ELSE WAS BEFORE THIS SITTING — recomputed, never remembered.
     *
     * The board unmounts the moment you touch the field (the body becomes the results
     * list), so on the way back there is no previous layout in memory to animate away
     * from — which is exactly why the older tiles used to JUMP to their new places.
     *
     * They do not have to be remembered. The packer folds sessions oldest-first, so
     * the tiles that predate this sitting are a stable PREFIX of the pack: running it
     * again over the same list minus this session reproduces the board the user was
     * last looking at. Pure function, no state, no staleness.
     *
     * ⚠ ONE HONEST APPROXIMATION. Re-searching an entity you already had moves that
     * row into the new session, so the reconstruction is missing a tile the real
     * previous board had, and whatever sat above it slides from slightly off. It
     * degrades to a shorter travel rather than to a wrong one, and the alternative is
     * persisting a layout across an unmount to be right about a rare case.
     */
    const before = packRecents(
      recents.filter((r) => r.session_id !== pending),
      metrics
    );
    const wasAt = new Map(before.tiles.map((t) => [t.key, t]));
    const shifts = new Map<string, { dx: number; dy: number }>();
    for (const t of board.tiles) {
      const was = wasAt.get(t.key);
      if (!was) continue;
      if (was.x !== t.x || was.y !== t.y) shifts.set(t.key, { dx: was.x - t.x, dy: was.y - t.y });
    }
    return { delays, shifts };
  });
  // ⚠ The token is NOT spent here — see the completion effect below. Clearing it on
  // mount was the bug that made this animation almost never run.

  /**
   * ▸ THE FIELD MAKING ROOM. One timeline, every displaced tile, once.
   *
   * Deliberately NOT per-tile and NOT staggered: the older tiles are being
   * REORGANISED, not revealed, so they move together as a field and stay sharp the
   * whole way. Anything that made them shimmer individually would put them in
   * competition with the arrival, which is the only thing meant to be watched.
   *
   * Starts on the same frame as the mount and finishes under the last landing, so the
   * two overlap rather than queue.
   */
  const reflow = useSharedValue(arrival.shifts.size > 0 ? 0 : 1);
  useEffect(() => {
    if (arrival.shifts.size === 0) return;
    reflow.value = withTiming(1, { duration: REFLOW_MS, easing: REFLOW_EASE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * One flip for the whole board when the choreography ends, rather than each tile
   * re-rendering itself as it lands — sixty staggered re-renders during an animation
   * is exactly what the motion law exists to prevent. Keyed on the board's identity so
   * a fresh mount (which is every return from a search) runs it again.
   */
  const [landing, setLanding] = useState(() => arrival.delays.size > 0);
  /**
   * ▸ THE TOKEN IS SPENT WHEN THE ANIMATION HAS ACTUALLY BEEN SHOWN — never on mount.
   *
   * ⚠ THIS IS THE BUG. Bryan, device: "out of 15 searches, I only saw the animation
   * once." Clearing the token in a mount effect assumed that mounting the board and
   * showing the board are the same event. They are not, and the gap is reachable in
   * ordinary use: clearing the field calls `setQuery("")` and `focusInput()` in one
   * tick, but the query lands in React state immediately while the keyboard's own
   * event is a native round-trip away. So there is a window — `phase === "idle"`,
   * nothing typed, `keyboardUp` still false — where the board mounts for a couple of
   * frames behind a keyboard that is on its way up, eats the token, and unmounts.
   * By the time the keyboard is dismissed and the real board appears, the flag it was
   * waiting on has already been spent. It survived only when the query was emptied
   * with the keyboard ALREADY up, which is the one path in fifteen that worked.
   *
   * Spending it on COMPLETION closes that window and every other one like it: a board
   * that does not survive its own choreography never had a chance to show it, its
   * timer is cleaned up with the unmount, and the token is still there for the board
   * that does. Once the cascade has genuinely played, it is spent, so returning to the
   * tab without searching still animates nothing — which is what the token is for.
   *
   * A board that CANNOT animate (no pending session, or rows whose session predates
   * R2) never touches the token either. There is nothing to spend it on.
   */
  useEffect(() => {
    if (arrival.delays.size === 0) return;
    const last = Math.max(0, ...arrival.delays.values());
    // The screen owns the aurora — it has to sit outside the ScrollView or it would
    // scroll with the thing it is lighting. This is the only signal it needs.
    // The schedule, not just the duration — the aperture opens once per card, and it
    // has to lead each one rather than react to it.
    onArrival?.(last + LAND_TOTAL_TAIL, [...arrival.delays.values()].sort((a, b) => a - b));
    const t = setTimeout(() => {
      setLanding(false);
      clearPendingLand();
    }, last + LAND_TOTAL_TAIL);
    return () => {
      clearTimeout(t);
      // Leaving mid-cascade — the token is unspent, so this will replay in full next
      // time, and the light must not outlive the board it belongs to.
      onArrival?.(null);
    };
  }, [arrival, clearPendingLand, onArrival]);

  /**
   * ▸ THE ANCHORED START (dev toggle), ADAPTIVE. The lift line is a LIMIT the old
   * skyline may not sink past, not a place it is dragged to. A small session rests
   * naturally — old row high on screen, rain landing above it, no scroll — and a big
   * one is scrolled just enough to hold the old row at the line while the rest of
   * the rain keeps falling in from above. `scroll = max(0, natural − target)` IS the
   * whole adaptive rule: it scales itself against session volume and viewport with
   * no cases and no thresholds.
   *
   * ⚠ THE SPACER IS DELETED, at Bryan's call, after living exactly one round: it
   * forced short sessions DOWN to the line and left "a huge black space... it looks
   * horrible" above them. The void was never anything but the spacer. What his
   * original "at all times" turned out to mean once seen on device: hold the line
   * when volume demands it, and otherwise let the board be natural.
   */
  const anchorOn = useBoolPref(PREF_ANCHOR_SKYLINE, false);
  const guideOn = useBoolPref(PREF_ANCHOR_GUIDE, false);
  /** Board-space y of the previous skyline's top row, for the dashed guide. */
  const [guideBoundary, setGuideBoundary] = useState<number | null>(null);
  const anchored = useRef(false);
  useEffect(() => {
    if (anchored.current || arrival.delays.size === 0 || boardTop === 0) return;
    if (!anchorOn && !guideOn) return;
    /**
     * ⚠ THE BOUNDARY IS THE HIGHEST OLD TILE — not the arriving block's depth.
     *
     * The first cut measured `max(y + height)` over the ARRIVING tiles and called
     * everything below it "the previous skyline". But the packer interleaves: the new
     * session's bottom edge is a ragged skyline of its own, and the old board's top
     * row can begin a full tile height above or below that line depending on the
     * packing. That is exactly Bryan's report — short sessions anchored "sometimes,
     * depending on how the previous skyline orientation leaves the packing", and a
     * mid session with one deep span dragged the measured line down so far the real
     * old row landed "way past the nav bar". The thing he named is the thing to
     * measure: the top of the previous skyline, `min(y)` over the tiles that are NOT
     * arriving. New tiles in shallow columns may dip below the anchor line — that is
     * the packing being honest, not the anchor missing.
     */
    let oldTop = Infinity;
    for (const t of board.tiles) {
      if (!arrival.delays.has(t.key)) oldTop = Math.min(oldTop, t.y);
    }
    // The whole board is the arriving session — there is no previous skyline.
    if (!Number.isFinite(oldTop)) return;
    anchored.current = true;
    setGuideBoundary(oldTop);
    if (!anchorOn) return;
    // The lowest the old row may sit, and where it naturally sits at scroll 0. A
    // natural position above the line stays put — scroll clamps to 0 and the board
    // is simply itself.
    const target = viewportH - ANCHOR_LIFT;
    const natural = SEARCH_LAYOUT.contentTop + boardTop + oldTop;
    onAnchor?.(Math.max(0, natural - target));
  }, [anchorOn, guideOn, boardTop, arrival, board, viewportH, onAnchor]);

  const openTile = useCallback(
    (tile: PositionedTile, rect?: MarqueeRect, remeasure?: MarqueeRemeasure) =>
      onOpenEntity(tile.search, rect, remeasure),
    [onOpenEntity]
  );

  return (
    <View>
      {/* LAYOUT-ONLY — see the masthead note above. The real glyphs live in the
          screen's morph overlay; this ghost keeps `boardTop` honest. */}
      <View style={[styles.masthead, styles.mastheadGhost]}>
        <Text style={styles.title}>RECENT</Text>
        <Text style={styles.count}>
          {recents.length} {recents.length === 1 ? "SEARCH" : "SEARCHES"}
        </Text>
      </View>
      <View
        style={{ height: board.height }}
        onLayout={(e) => setBoardTop(e.nativeEvent.layout.y)}
      >
        {/* The PREV SKYLINE guide — scrolls with the content it marks. Built from
            dash Views rather than a dashed border: RN's dashed borders only render
            reliably with a uniform borderWidth on all four edges. */}
        {guideOn && guideBoundary !== null && (
          <View pointerEvents="none" style={[styles.guide, { top: guideBoundary }]}>
            {Array.from({ length: 22 }, (_, i) => (
              <View key={i} style={styles.dash} />
            ))}
            <Text style={styles.guideTag}>PREV SKYLINE</Text>
          </View>
        )}
        {board.tiles.map((tile) => (
          <RecentTile
            key={tile.key}
            tile={tile}
            scrollY={scrollY}
            originY={SEARCH_LAYOUT.contentTop + boardTop}
            viewportH={viewportH}
            landDelay={arrival.delays.get(tile.key) ?? null}
            landing={landing}
            shift={arrival.shifts.get(tile.key) ?? null}
            reflow={reflow}
            onPress={openTile}
            onLand={onTileLand}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  masthead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 14,
  },
  mastheadGhost: { opacity: 0 },
  title: {
    color: SIGNAL.ink,
    fontFamily: FONT.display,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: -0.9, // -0.03em at 30px
  },
  count: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.micro11,
  },
  // ── The anchor guide (dev instrument, PREF_ANCHOR_GUIDE) ─────────────────────
  guide: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 30,
  },
  dash: { width: 8, height: 1.5, backgroundColor: "#FF5A3C" },
  guideTag: {
    color: "#FF5A3C",
    fontFamily: FONT.mono,
    fontSize: 8,
    letterSpacing: 1,
  },
});
