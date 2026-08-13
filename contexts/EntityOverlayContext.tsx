import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import EntityScreen from "@/components/entity/EntityScreen";
import { FILTER_DEFAULTS, type FilterState } from "@/hooks/useFilterState";
import { loadEntity, type EntityFilm, type EntityPage } from "@/services/entities";

/**
 * Entity pages as an OWNED OVERLAY — not a pushed route.
 *
 * The marquee → page motion went through three route-based attempts (fade, transparent
 * modal, contained transparent modal) and stayed intermittently wrong in the same way:
 * sometimes the page slid up from the bottom instead of growing from the card. The
 * shared factor was the navigator — a native screen presentation is OS-owned, and
 * every "animation: none" is a request, not a guarantee. The app already learned this
 * lesson once: ArtworkViewer documents that every animated full-screen layer must be
 * an absoluteFill sibling, because animating across a native presentation boundary is
 * exactly what fails intermittently.
 *
 * TWO PIECES since 2026-08-01, and the split is the point:
 *   · The PROVIDER holds the request and lives at the ROOT, so the nav bar can read
 *     `isOpen` and the search screen can open pages from anywhere in the tree.
 *   · The HOST — the layer that actually shows the page — is rendered by the SEARCH
 *     SCREEN, as its last child. It used to sit after the root Stack, above
 *     everything including the nav pill; Bryan's ruling reversed that: the nav
 *     "never hides" law now extends to entity pages, so the pill must draw OVER
 *     them. Inside the search screen the tab bar outranks the host by construction
 *     (React Navigation renders the bar after screen content), and one behaviour
 *     falls out free: tab screens stay mounted, so an entity page SURVIVES a trip
 *     to another tab and is simply still there when the disc brings you back.
 *
 * Layering that still holds:
 *   · The movie-detail sheet presents ON TOP of an open entity page, because
 *     `presentation: "modal"` is a real UIKit modal — it sits above the entire React
 *     root, host included. Tapping a film inside the overlay works unchanged.
 *   · The search list stays live underneath, which is what the transparent grow shows
 *     through — and the list is now literally the host's sibling in the same screen.
 *
 * The three /person /collection /company routes still exist and still work (deep
 * links, anything that navigates by URL); they render the same EntityScreen without
 * an origin and pop with router.back(). Search no longer uses them.
 */

export type EntityOverlayRequest = {
  kind: EntityPage["kind"];
  id: number;
  /** Artwork + name from the tapped row, so the hero paints on the first frame. */
  seed?: { imagePath: string; name: string } | null;
  /** The tapped card's rect — what the page grows out of. Null: the page just appears. */
  origin?: { x: number; y: number; width: number; height: number } | null;
  /**
   * Re-measures the card's CURRENT rect (the marquee stays mounted under the overlay,
   * so its ref remains valid). Called at the start of every transition, because the
   * tap-time rect goes stale whenever the list is still settling around the tap —
   * which was the intermittent "grows from / folds to a point ~200px below the card".
   */
  remeasureOrigin?: (
    cb: (rect: { x: number; y: number; width: number; height: number } | null) => void
  ) => void;
};

const Ctx = createContext<{
  open: (req: EntityOverlayRequest) => void;
  close: () => void;
  /** True while an entity page is mounted. The nav reads this to hold its rest
   *  pose (full pill + search disc) and to make the disc a plain "back to the
   *  search tab" from elsewhere — never a field-opener over a page. */
  isOpen: boolean;
  /**
   * Fold the page back into its marquee — the SAME animated exit as the page's
   * own back button, not an unmount. The nav's search disc is the third door out
   * (chevron, edge swipe, disc — Bryan: everything reachable at the bottom), and
   * a door must not teleport while the other two glide.
   */
  requestFold: () => void;
  /**
   * A full-screen READER is open over the page — the expanded biography or
   * overview. The nav bar hides itself while this is true: the reader is a
   * blur that fills the screen, so the floating islands sit on top of a long
   * column of text they have nothing to do with, and Bryan's reason is the
   * plain one — "I don't want to accidentally click on one of them when I'm
   * reading this stuff." Reset by open() and close() so a page that is folded
   * away mid-read can never leave the bar stranded off-screen.
   */
  reading: boolean;
  setReading: (r: boolean) => void;
  /**
   * The FILTER sheet. Lives here because its two halves are in different trees:
   * the pill that opens it is in the nav bar, the sheet itself is a child of the
   * search screen (same reason as the overlay — the sheet must survive a tab
   * switch and sit inside the screen that owns the page it filters).
   *
   * The nav hides for it exactly as it hides for a reader: the board shows the
   * sheet with no bar under it, and the pill has become the sheet.
   *
   * `filterOpen` is MOUNT ONLY. It stays true for the whole of the sheet's
   * collapse, because a sheet that unmounts before its motion ends has no
   * motion.
   */
  filterOpen: boolean;
  openFilter: () => void;
  closeFilter: () => void;
  /**
   * The sheet is CURRENTLY BIG ENOUGH TO BE THE SCREEN — and this, not
   * `filterOpen`, is what the nav hides for.
   *
   * The two used to be one flag, and that is why the collapse never read as a
   * morph: the bar only learned the sheet was leaving once the sheet had
   * ALREADY LANDED, so it faded itself back in over an empty screen afterwards.
   * Bryan filmed it — bubble shrinks, bubble vanishes, *then* three islands
   * arrive. Two states pretending to be one motion. A shared element needs
   * something to be shared WITH: the pill has to be sitting there, at full
   * strength, for the bubble to land into.
   *
   * So the sheet drops this at the START of its collapse and keeps animating.
   * `filterOpen` still flips on the landing, and still owns the unmount.
   */
  filterCovering: boolean;
  uncoverFilter: () => void;
  /**
   * The page's films, published so the FILTER sheet can be ADAPTIVE to them —
   * Bryan's rule for the decade scroller ("Chris Pratt wasn't even alive in
   * 1920") and the same reason the genre map should only offer genres this
   * person actually worked in. The sheet lives in the search screen and the
   * films live in the page, so this is the only wire between them.
   */
  films: EntityFilm[];
  setFilms: (f: EntityFilm[]) => void;
  /**
   * What the PAGE is currently showing — the committed filter, not the one the
   * sheet is editing.
   *
   * The split is APPLY. The sheet holds a DRAFT and counts against it live, so
   * you can see what a pick would cost you before you pay for it; this is the
   * one the filmography is actually filtered by, and it only moves when APPLY
   * says so. Closing the sheet any other way throws the draft away, which is
   * what makes APPLY mean anything.
   *
   * It lives here for the same reason `films` does: the sheet and the page are
   * in different trees. Reset by open() and close() — a filter belongs to the
   * person you were looking at, and carrying "2010S, 7.5+" onto the next one
   * would hide most of their work for reasons they never asked for. It DOES
   * survive a tab switch, because that is the same page, still open.
   */
  appliedFilter: FilterState;
  setAppliedFilter: (f: FilterState) => void;
  /** EntityScreen's fold, registered by the host while a page is mounted. */
  registerFold: (fn: () => void) => void;
  /** The live request. Consumed ONLY by EntityOverlayHost. */
  req: (EntityOverlayRequest & { token: number }) | null;
} | null>(null);

export function useEntityOverlay() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useEntityOverlay must be used inside EntityOverlayProvider");
  return value;
}

export function EntityOverlayProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<(EntityOverlayRequest & { token: number }) | null>(null);
  const [reading, setReading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCovering, setFilterCovering] = useState(false);
  const [films, setFilms] = useState<EntityFilm[]>([]);
  const [appliedFilter, setAppliedFilter] = useState<FilterState>(FILTER_DEFAULTS);
  const openFilter = useCallback(() => {
    setFilterOpen(true);
    setFilterCovering(true);
  }, []);
  const closeFilter = useCallback(() => {
    setFilterOpen(false);
    setFilterCovering(false);
  }, []);
  // The first half of a close: the bar comes back while the sheet is still on
  // its way down to it. See `filterCovering` above.
  const uncoverFilter = useCallback(() => setFilterCovering(false), []);

  // The token forces a fresh mount when the same entity is reopened — a stale
  // EntityScreen must never be revived mid-fold with old animation state.
  //
  // Both doors clear `reading`. A page can leave while its reader is still up
  // (Android's hardware back folds from anywhere), and a bar that hid itself
  // for a reader that no longer exists would be unreachable — the one failure
  // in this file the user could not recover from.
  const open = useCallback((r: EntityOverlayRequest) => {
    setReading(false);
    setFilterOpen(false);
    setFilterCovering(false);
    setAppliedFilter(FILTER_DEFAULTS);
    // Films reset with the filter, and for the same reason — they belong to
    // the page you were looking at. This matters more than hygiene now: the
    // SHEET-BORNE filter pill gates its presence on `films.length` (Bryan,
    // 2026-08-13: no FILTER control over a skeleton — "nothing, at least
    // visibly, to filter by"; the nav's pill is exempt — see filterPose), so
    // a stale list from the previous page would open the door early while
    // the new page is still loading.
    setFilms([]);
    setReq((cur) => ({ ...r, token: (cur?.token ?? 0) + 1 }));
  }, []);
  const close = useCallback(() => {
    setReading(false);
    setFilterOpen(false);
    setFilterCovering(false);
    setAppliedFilter(FILTER_DEFAULTS);
    setFilms([]);
    setReq(null);
  }, []);

  // A ref, not state — registering must not re-render anything, and the identity
  // of requestFold must stay stable (same pattern as SearchIsland's focuser).
  const foldRef = useRef<() => void>(() => {});
  const registerFold = useCallback((fn: () => void) => {
    foldRef.current = fn;
  }, []);
  const requestFold = useCallback(() => foldRef.current(), []);

  const value = useMemo(
    () => ({
      open,
      close,
      isOpen: req != null,
      reading,
      setReading,
      filterOpen,
      openFilter,
      closeFilter,
      filterCovering,
      uncoverFilter,
      films,
      setFilms,
      appliedFilter,
      setAppliedFilter,
      requestFold,
      registerFold,
      req,
    }),
    [
      open,
      close,
      reading,
      filterOpen,
      openFilter,
      closeFilter,
      filterCovering,
      uncoverFilter,
      films,
      appliedFilter,
      requestFold,
      registerFold,
      req,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The layer that shows the page. Rendered by the SEARCH SCREEN as its last child —
 * see the header note for why it left the root: the nav pill must draw over it,
 * and a tab screen keeps it alive across tab switches.
 *
 * `onClose` lets the owner batch its own state flip into the SAME commit as the
 * overlay's close. This is a law, not a convenience: the nav bar derives its pose
 * from (entityOpen, expanded) TOGETHER, and a close that lands one commit before
 * the island re-expands gives the bar a frame of "neither pose" — four seats
 * mounting inside a disc-width bar, and the two pose springs starting a frame
 * apart, which reads as a pump. Callers must flip their state and call the
 * context's close() in ONE task so React batches them. (Found by review, 2026-08-01.)
 *
 * `onFoldStart` fires at the other end of the same fold — the moment it commits —
 * and is how the island re-expands WITH the page instead of after it. Flipping
 * `expanded` while the page is still mounted is safe in the one direction that
 * matters, because the nav's FILTER pose requires `!expanded`: the field simply
 * wins the middle room the instant it is asked for, and the later close finds the
 * bar already in the pose it was going to hand it. The "neither pose" frame the
 * law above exists to prevent is still impossible — that gap only opens the other
 * way round, when the page leaves BEFORE the field arrives.
 */
export function EntityOverlayHost({
  onClose,
  onFoldStart,
  onSwipeBegin,
  onSwipeCancel,
  onGrowStart,
}: {
  onClose?: () => void;
  onFoldStart?: () => void;
  /** The interactive back-swipe's own cues — see EntityScreen's contract note.
   *  Consumed by the SHEET route's filter pill (which must leave with the
   *  drag's first frame and return on a cancelled swipe); the search screen
   *  deliberately does not subscribe, keeping onFoldStart's "cancelled swipes
   *  never reach here" contract intact for the nav. */
  onSwipeBegin?: () => void;
  onSwipeCancel?: () => void;
  /** The grow's first motion frame (mount, for pages with no grow). Fires once
   *  per page. The search screen collapses the island off this so the nav's
   *  handover runs WITH the page's entrance and lands with it — the mirror of
   *  onFoldStart. */
  onGrowStart?: () => void;
}) {
  const { req, close, registerFold, setReading, setFilms, appliedFilter } = useEntityOverlay();
  if (!req) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.host]}>
      <OverlayPage
        key={`${req.kind}-${req.id}-${req.token}`}
        req={req}
        onClose={onClose ?? close}
        onFoldStart={onFoldStart}
        onSwipeBegin={onSwipeBegin}
        onSwipeCancel={onSwipeCancel}
        onGrowStart={onGrowStart}
        onReadingChange={setReading}
        onFilmsChange={setFilms}
        // A PROP, not a context read inside the page. EntityScreen is also the
        // /person /collection /company routes, which have no sheet to be
        // filtered by — passing it in keeps the page filterable without making
        // it depend on an overlay it does not always live inside.
        filter={appliedFilter}
        registerBack={registerFold}
      />
    </View>
  );
}

function OverlayPage({
  req,
  onClose,
  onFoldStart,
  onSwipeBegin,
  onSwipeCancel,
  onGrowStart,
  onReadingChange,
  onFilmsChange,
  filter,
  registerBack,
}: {
  req: EntityOverlayRequest;
  onClose: () => void;
  onFoldStart?: () => void;
  onSwipeBegin?: () => void;
  onSwipeCancel?: () => void;
  onGrowStart?: () => void;
  onReadingChange?: (reading: boolean) => void;
  onFilmsChange?: (films: EntityFilm[]) => void;
  filter?: FilterState;
  registerBack: (fn: () => void) => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => loadEntity(req.kind, req.id, signal),
    [req.kind, req.id]
  );
  const seed = useMemo(
    () =>
      req.seed ? { kind: req.kind, imagePath: req.seed.imagePath, name: req.seed.name } : null,
    [req]
  );
  return (
    <EntityScreen
      load={load}
      seed={seed}
      origin={req.origin ?? null}
      remeasureOrigin={req.remeasureOrigin}
      onClose={onClose}
      onFoldStart={onFoldStart}
      onSwipeBegin={onSwipeBegin}
      onSwipeCancel={onSwipeCancel}
      onGrowStart={onGrowStart}
      onReadingChange={onReadingChange}
      onFilmsChange={onFilmsChange}
      filter={filter}
      registerBack={registerBack}
    />
  );
}

const styles = StyleSheet.create({
  // Above every screen in the Stack — same convention as ArtworkViewer's root.
  host: { zIndex: 2000, elevation: 2000 },
});
