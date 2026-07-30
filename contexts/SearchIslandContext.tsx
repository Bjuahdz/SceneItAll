import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// The search island's state has to be agreed on by two things that are not in
// the same tree: the nav bar (which owns the input) and the search screen (which
// renders the results). This is the smallest possible shared surface for that.
//
//   expanded  — the satellite has grown into a field and the pill has collapsed
//               to a single tab: whichever one you were last on, pinned left.
//   lastTab   — that tab. Tapping it is how you get back out of search.
//   query     — what you typed. The screen reads it; only the island writes it.

export type TabName = "settings" | "index" | "discover" | "slate";

type SearchIsland = {
  expanded: boolean;
  query: string;
  lastTab: TabName;
  setQuery: (q: string) => void;
  noteTab: (t: TabName) => void;
  open: () => void;
  close: () => void;
};

const Ctx = createContext<SearchIsland | null>(null);

export function SearchIslandProvider({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [lastTab, setLastTab] = useState<TabName>("index");
  // Held in a ref as well so `open()` never closes over a stale tab.
  const lastTabRef = useRef<TabName>("index");

  const noteTab = useCallback((t: TabName) => {
    lastTabRef.current = t;
    setLastTab(t);
  }, []);

  const open = useCallback(() => setExpanded(true), []);
  const close = useCallback(() => {
    setExpanded(false);
    setQuery("");
  }, []);

  const value = useMemo(
    () => ({ expanded, query, lastTab, setQuery, noteTab, open, close }),
    [expanded, query, lastTab, noteTab, open, close]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSearchIsland(): SearchIsland {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSearchIsland must be used inside SearchIslandProvider");
  return v;
}
