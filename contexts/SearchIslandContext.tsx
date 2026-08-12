import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";

import { SEARCH_FILTER_DEFAULTS, type FilterState } from "@/hooks/useFilterState";

// The search island's state has to be agreed on by two things that are not in
// the same tree: the nav bar (which owns the input) and the search screen (which
// renders the results). This is the smallest possible shared surface for that.
//
//   expanded  — the satellite has grown into a field and the pill has collapsed
//               to a single tab: whichever one you were last on, pinned left.
//   lastTab   — that tab. Tapping it is how you get back out of search.
//   query     — what you typed. The screen reads it; only the island writes it.
//   submitTick— bumped when you press the keyboard's Search key. A COUNTER, not a
//               boolean, so submitting the same query twice still registers as two
//               events and needs no reset handshake between the two trees.

export type TabName = "settings" | "index" | "discover" | "slate";

type SearchIsland = {
  expanded: boolean;
  query: string;
  lastTab: TabName;
  submitTick: number;
  setQuery: (q: string) => void;
  submitQuery: () => void;
  /** The nav owns the input, so anything off-screen that needs the keyboard back
   *  — the zero-results CTA, for one — has to ask through here. The nav registers
   *  the real implementation; the default is a no-op so nothing crashes if the bar
   *  is not mounted. */
  focusInput: () => void;
  registerFocuser: (fn: () => void) => void;
  noteTab: (t: TabName) => void;
  open: () => void;
  close: () => void;
  /**
   * Fold the field to a disc WITHOUT forgetting anything — `close()` wipes the
   * query, which is right when the user leaves search for another tab and wrong
   * for the one other thing that folds the island: an entity page opening. The
   * page is a detour inside the same search session, and coming back out of it
   * must land on the query and results exactly as they were.
   */
  collapse: () => void;
  /**
   * ▸ THE RESULTS FILTER — committed, not the sheet's draft.
   *
   * It lives here because this context is exactly the set of things the NAV and
   * the SEARCH SCREEN both have to agree on, and this is now one of them: the
   * nav's FILTER pill opens the sheet and wears the accent when the filter is
   * on, the screen applies it to the rows. They are in different trees.
   *
   * ⚠ SEPARATE FROM THE ENTITY OVERLAY'S `appliedFilter` BY RULING ⑦ — "FILTER's
   * active tint resets per surface, or a results filter makes the next entity
   * page look pre-filtered". One shared object would have a filmography you
   * filtered silently thinning an unrelated result set, and the pill claiming a
   * filter the user could neither see nor find the controls for.
   */
  resultsFilter: FilterState;
  setResultsFilter: (f: FilterState) => void;
  /**
   * ▸ HOW FAR THE APPLIED-FILTER BAR HAS SUNK INTO THE PILL. 0 = out and legible,
   * 1 = behind the pill.
   *
   * ⚠ IT IS NOT `useNavMorph().progress`, and that is deliberate. Feeding the nav
   * morph from the results list would collapse the tab run to its dot capsule, which
   * fights the FILTER pose the search screen is already holding. This asks a
   * different question — "has the reader moved into the results?" — so it gets its
   * own value, written by the scroll handler that already exists rather than by a
   * second listener. Every reader is a worklet; nothing here re-renders.
   */
  resultsSink: SharedValue<number>;
  /** Called from the results list's existing onScroll. Applies the same
   *  intent-with-hysteresis rule the nav morph uses, so a jitter cannot flap it. */
  noteResultsScroll: (y: number) => void;
};

const Ctx = createContext<SearchIsland | null>(null);

/* ── THE SINK'S THRESHOLDS. ────────────────────────────────────────────────────
   Lifted from NavMorphContext rather than re-tuned: they are the numbers that
   already stop the nav pill flapping on a stray finger, and the bar is riding the
   same reading gesture. TOP_ZONE keeps the bar out while you are still at the head
   of the list, DOWN/UP_INTENT are the hysteresis.

   ⚠ CALLER CONTRACT (Bryan's sink ruling, 2026-08-10 — down sinks, ANY up brings
   it out, consistently): feed `noteResultsScroll` only IN-RANGE offsets — clamp
   overscroll away (a bottom bounce reads as upward intent) and rebase with a 0
   on any surface swap that moves the offset without a scroll event (a stale
   last-y reads the next gesture backwards). Both live in search.tsx's
   onListScroll / door effect. */
const SINK_TOP_ZONE = 40;
const SINK_MIN_Y = 90;
const SINK_DOWN_INTENT = 24;
const SINK_UP_INTENT = 12;
/** The same spring the nav morphs on — one feel for one gesture. */
const SINK_SPRING = { damping: 31, stiffness: 350, mass: 1 };

export function SearchIslandProvider({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [submitTick, setSubmitTick] = useState(0);
  const [lastTab, setLastTab] = useState<TabName>("index");
  // Held in a ref as well so `open()` never closes over a stale tab.
  const lastTabRef = useRef<TabName>("index");

  const noteTab = useCallback((t: TabName) => {
    lastTabRef.current = t;
    setLastTab(t);
  }, []);

  const submitQuery = useCallback(() => setSubmitTick((t) => t + 1), []);

  // Held in a ref, not state: registering the focuser must not re-render the tab
  // bar, and the identity of `focusInput` must stay stable for the context value.
  const focuserRef = useRef<() => void>(() => {});
  const registerFocuser = useCallback((fn: () => void) => {
    focuserRef.current = fn;
  }, []);
  const focusInput = useCallback(() => focuserRef.current(), []);

  const [resultsFilter, setResultsFilter] = useState<FilterState>(SEARCH_FILTER_DEFAULTS);

  const resultsSink = useSharedValue(0);
  // Last spring target and the directional accumulators. Refs, not state — a scroll
  // handler that re-rendered the provider would repaint the whole nav mid-gesture,
  // which is the exact class of bug the island's ONE CLOCK note warns about.
  const sinkTarget = useRef(0);
  const sinkLastY = useRef(0);
  const sinkDown = useRef(0);
  const sinkUp = useRef(0);
  const noteResultsScroll = useCallback(
    (y: number) => {
      const setTarget = (t: 0 | 1) => {
        if (sinkTarget.current === t) return; // springs restart on TARGET changes only
        sinkTarget.current = t;
        resultsSink.value = withSpring(t, SINK_SPRING);
      };
      const dy = y - sinkLastY.current;
      sinkLastY.current = y;
      // At the head of the list the bar is always out — including through iOS's
      // overscroll bounce, which would otherwise read as a downward intent.
      if (y <= SINK_TOP_ZONE) {
        sinkDown.current = 0;
        sinkUp.current = 0;
        setTarget(0);
        return;
      }
      if (dy > 0) {
        sinkDown.current += dy;
        sinkUp.current = 0;
        if (sinkDown.current > SINK_DOWN_INTENT && y > SINK_MIN_Y) setTarget(1);
      } else if (dy < 0) {
        sinkUp.current -= dy;
        sinkDown.current = 0;
        if (sinkUp.current > SINK_UP_INTENT) setTarget(0);
      }
    },
    [resultsSink]
  );

  const open = useCallback(() => setExpanded(true), []);
  const close = useCallback(() => {
    setExpanded(false);
    setQuery("");
    // Leaving search for another tab ends the search, and a filter belongs to
    // the search it was set on. The screen resets it on every other route out
    // (the door, the ✕, a swipe) by watching the query go empty; this covers the
    // one route that also unmounts the surface watching.
    setResultsFilter(SEARCH_FILTER_DEFAULTS);
  }, []);
  const collapse = useCallback(() => setExpanded(false), []);

  const value = useMemo(
    () => ({
      expanded,
      query,
      lastTab,
      submitTick,
      setQuery,
      submitQuery,
      focusInput,
      registerFocuser,
      noteTab,
      open,
      close,
      collapse,
      resultsFilter,
      setResultsFilter,
      resultsSink,
      noteResultsScroll,
    }),
    [
      expanded,
      query,
      lastTab,
      submitTick,
      setQuery,
      submitQuery,
      focusInput,
      registerFocuser,
      noteTab,
      open,
      close,
      collapse,
      resultsFilter,
      resultsSink,
      noteResultsScroll,
    ]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSearchIsland(): SearchIsland {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSearchIsland must be used inside SearchIslandProvider");
  return v;
}
