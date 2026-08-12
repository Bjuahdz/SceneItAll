import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Image } from "expo-image";

import {
  getRecentSearches,
  recordRecentSearch,
  deleteAllRecentSearches,
  sampleSearchHistory,
  RECENTS_LIMIT,
  type RecentSearch,
} from "@/services/db";
import { PREF_DEMO_ARRIVAL_MAX, getNumPref } from "@/services/prefs";
import { tileArtUri } from "@/services/recentsBoard";

interface RecentSearchesContextValue {
  recents: RecentSearch[];
  ready: boolean; // false until the first DB load resolves
  /** Commit an entity to the ledger. Dedupes by entity and caps at RECENTS_LIMIT. */
  recordSearch: (entry: RecentSearch) => void;
  /** Dev-panel blank slate. Resolves with how many were removed. */
  clearRecents: () => Promise<number>;
  /**
   * ▸ A ONE-SHOT TOKEN: "a search happened and the board has not shown it landing yet."
   *
   * The recents board plays an arrival animation for the session you just finished,
   * exactly once. Deciding that by comparing session ids against a remembered value
   * was fragile — the board unmounts on every touch of the search field, and any
   * memory living in the component, or in its module, is one Fast Refresh or one
   * unmount ordering away from replaying the whole thing (Bryan, device: "it's still
   * happening even when I come back and I haven't done a new search").
   *
   * So the flag is raised at the only moment that is unambiguously a new search —
   * `recordSearch` — and lives HERE, in a provider mounted at the app root that
   * outlives every screen. Read it while rendering; clear it in an effect.
   */
  pendingLandSession: () => number | null;
  clearPendingLand: () => void;
  /**
   * ▸ DEV: fake a whole search sitting so the arrival can be iterated without
   * hand-searching eight things first (see PREF_DEMO_ARRIVALS).
   *
   * Honest by construction — it does not fake the ANIMATION, it fakes the SEARCHES:
   * real entities sampled from the archive (count = the dev panel's session-size
   * slider, PREF_DEMO_ARRIVAL_MAX) are stamped as one fresh session and pushed
   * through the exact pipeline a manual sitting takes (token, prefetch, packer,
   * aurora, emergence). Whatever the board does with them is what it would do live.
   *
   * In-memory only: nothing touches SQLite, demo rows carry NEGATIVE session ids, and
   * `purgeDemoArrivals` (or a restart) restores the real ledger exactly.
   */
  seedDemoArrival: () => Promise<boolean>;
  purgeDemoArrivals: () => void;
  /**
   * Bumped once per seeded session, IN THE SAME COMMIT as the rows land. The Search
   * tab keys the board with it: the tab screen stays mounted across tab switches, so
   * without a remount the board would re-render with the new rows already in place —
   * the arrival machinery is mount-time by design (see RecentsBoard).
   */
  demoEpoch: number;
}

const RecentSearchesContext = createContext<RecentSearchesContextValue | null>(null);

/**
 * Holds the Search tab's recents ledger in memory and writes through to SQLite.
 * Same shape as FavoritesProvider: load once on mount, optimistic in-memory updates,
 * fire-and-forget persistence — so committing a search never blocks the navigation
 * that follows it.
 *
 * Mounted at the APP ROOT, not inside (tabs), because the entity destination pages
 * are pushed routes outside the tab group. A provider mounted in (tabs) would be
 * invisible to them — the same trap SearchIslandContext already falls into.
 */
export const RecentSearchesProvider = ({ children }: { children: React.ReactNode }) => {
  const [recents, setRecents] = useState<RecentSearch[]>([]);
  const [ready, setReady] = useState(false);

  // Load the persisted ledger once on startup.
  useEffect(() => {
    let mounted = true;
    getRecentSearches()
      .then((rows) => mounted && setRecents(rows))
      .catch((e) => console.error("Failed to load recent searches:", e))
      .finally(() => mounted && setReady(true));
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * A REF, not state: raising this must not re-render anything. The board reads it
   * when it mounts and clears it a frame later, and a render in between would be a
   * render landing in the middle of the animation it is about to start.
   */
  const pendingLand = useRef<number | null>(null);
  const pendingLandSession = useCallback(() => pendingLand.current, []);
  const clearPendingLand = useCallback(() => {
    pendingLand.current = null;
  }, []);

  const recordSearch = useCallback((entry: RecentSearch) => {
    // Stamp once and use the SAME stamp for memory and disk, so a reload can't
    // reorder the list relative to what the user just saw.
    const stamped: RecentSearch = { ...entry, searched_at: entry.searched_at ?? Date.now() };
    // The one moment that is unambiguously "the user just searched something". The
    // director follow-up write lands here too, with the SAME session, so re-raising
    // the flag is idempotent rather than a second animation.
    if (stamped.session_id != null) pendingLand.current = stamped.session_id;
    /**
     * ▸ WARM THE ARTWORK NOW, NOT WHEN IT LANDS.
     *
     * The board animates the newest searches, which are precisely the ones whose
     * pictures have never been on screen — so they were fetching over the network
     * during their own arrival and landing as empty boxes (Bryan, device: "the new ones
     * are coming in and they're just blank"). This is the earliest honest moment to ask
     * for them: the user has just opened the entity page and will be reading it for
     * seconds before coming back.
     *
     * ⚠ COSTS NOTHING EXTRA — it is the request the board was always going to make, just
     * earlier, and `tileArtUri` guarantees it is the same URL and therefore the same
     * cache entry. Fire and forget: a failed prefetch simply means the tile loads the
     * way it does today.
     */
    const art = tileArtUri(stamped);
    if (art) Image.prefetch(art).catch(() => {});
    setRecents((prev) => {
      const existing = prev.find(
        (r) => r.entity_type === stamped.entity_type && r.entity_id === stamped.entity_id
      );
      const withoutDupe = prev.filter((r) => r !== existing);
      // Mirror the DB's `hits = hits + 1` optimistically. Without this the count in
      // memory would sit at 1 until the next cold start re-read it from disk, and
      // anything rendering off `hits` would look broken while the app is open.
      return [{ ...stamped, hits: (existing?.hits ?? 0) + 1 }, ...withoutDupe].slice(
        0,
        RECENTS_LIMIT
      );
    });
    recordRecentSearch(stamped).catch((e) => console.error("recordRecentSearch failed:", e));
  }, []);

  // Goes through the context rather than straight to the DB so the ledger repaints
  // as the new-account state instead of holding rows that no longer exist.
  const clearRecents = useCallback(async () => {
    const removed = await deleteAllRecentSearches();
    setRecents([]);
    return removed;
  }, []);

  const [demoEpoch, setDemoEpoch] = useState(0);
  const seedDemoArrival = useCallback(async (): Promise<boolean> => {
    // Session size is BRYAN'S SLIDER now (the 8–11 randomness it replaces was a
    // stand-in for control, not a feature). The pref is a cap against the archive,
    // clamped to what the board can hold. Read fresh per seed, so Apply in settings
    // affects the very next visit without any re-subscription plumbing.
    const cap = Math.max(
      1,
      Math.min(RECENTS_LIMIT, Math.round(getNumPref(PREF_DEMO_ARRIVAL_MAX, 30)))
    );
    // Oversampled floor so small caps still vary between pulls even on a modest
    // archive. A pure random draw, deliberately NOT balanced by type: the archive is
    // already a real mix, and an occasional all-portrait or film-heavy sitting is a
    // legitimate board worth seeing, not a sampling failure.
    let pool: RecentSearch[] = [];
    try {
      pool = await sampleSearchHistory(Math.max(24, cap));
    } catch (e) {
      console.error("sampleSearchHistory failed:", e);
      return false;
    }
    // One tile cannot exercise an arrival. Below two, there is nothing to iterate on.
    if (pool.length < 2) return false;

    const take = pool.slice(0, Math.min(pool.length, cap));
    /** NEGATIVE, and that is the whole marker — every real session id is a
     *  `Date.now()`. No schema, no extra field, unmistakable in the dev panel. */
    const demoId = -Date.now();
    const now = Date.now();
    // Stamped in "search order" (ascending searched_at), exactly as N recordSearch
    // calls would have — the packer folds sessions oldest-first and the board lands
    // tiles in that order, so the stamps ARE the choreography's script.
    const rows: RecentSearch[] = take.map((r, i) => ({
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      title: r.title,
      year: r.year,
      subtitle: r.subtitle,
      image_path: r.image_path,
      searched_at: now + i,
      hits: r.hits,
      session_id: demoId,
    }));

    pendingLand.current = demoId;
    // Same warm-up recordSearch does, same URL, same cache entry — the sampled
    // entities have usually been on screen before, so most of these are already hot.
    for (const r of rows) {
      const art = tileArtUri(r);
      if (art) Image.prefetch(art).catch(() => {});
    }
    setRecents((prev) => {
      const seeded = new Set(rows.map((r) => `${r.entity_type}:${r.entity_id}`));
      // Prior demo rows leave (one demo sitting at a time — the board's foundation
      // stays the REAL history), and entities the seed re-uses leave too, mirroring
      // recordSearch's dedupe: the packer keys tiles by entity, and two tiles with
      // one key is a React collision, not a layout.
      const kept = prev.filter(
        (r) => (r.session_id ?? 0) >= 0 && !seeded.has(`${r.entity_type}:${r.entity_id}`)
      );
      return [...[...rows].reverse(), ...kept].slice(0, RECENTS_LIMIT);
    });
    // Same commit as the rows: React batches these two set-states, so the board
    // remounts exactly once, with the session already in place.
    setDemoEpoch((e) => e + 1);
    return true;
  }, []);

  const purgeDemoArrivals = useCallback(() => {
    setRecents((prev) => {
      const kept = prev.filter((r) => (r.session_id ?? 0) >= 0);
      // Identity when clean, so the OFF state costs no render on every focus.
      return kept.length === prev.length ? prev : kept;
    });
  }, []);

  const value = useMemo(
    () => ({
      recents,
      ready,
      recordSearch,
      clearRecents,
      pendingLandSession,
      clearPendingLand,
      seedDemoArrival,
      purgeDemoArrivals,
      demoEpoch,
    }),
    [
      recents,
      ready,
      recordSearch,
      clearRecents,
      pendingLandSession,
      clearPendingLand,
      seedDemoArrival,
      purgeDemoArrivals,
      demoEpoch,
    ]
  );

  return (
    <RecentSearchesContext.Provider value={value}>{children}</RecentSearchesContext.Provider>
  );
};

export const useRecentSearches = (): RecentSearchesContextValue => {
  const ctx = useContext(RecentSearchesContext);
  if (!ctx) throw new Error("useRecentSearches must be used within a RecentSearchesProvider");
  return ctx;
};
