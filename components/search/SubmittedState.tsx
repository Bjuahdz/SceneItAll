import React, { useCallback, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import Marquee, {
  accordionMotion,
  ctaFor,
  type MarqueeRect,
  type MarqueeRemeasure,
} from "./Marquee";
import KindRow from "./KindRow";
import NoArtworkPanel from "./NoArtworkPanel";
import QueryEcho from "./QueryEcho";
import ResultRow, { MARQUEE_KNOWN_FOR_BUDGET, metaDetail, typeLabel } from "./ResultRow";
import { useExpandedFilm } from "@/hooks/useExpandedFilm";
import type { KindKey } from "@/hooks/useFilterState";
import type { SearchResult } from "@/services/search";

// The submitted state: the query set large, then the results as a single-open
// accordion with the best match already expanded.
//
// Auto-expanding index 0 is the "promotes the best match" half of submit. The user
// declared intent by pressing Search, so the top answer opens without a second tap.

interface Props {
  query: string;
  total: number;
  results: SearchResult[];
  entryIds: Set<number>;
  /** Same rule as the recents ledger: nothing stays open while composing. */
  keyboardUp: boolean;
  /** `rect` is the marquee's on-screen box, present only when one was tapped — it is
   *  what an entity page expands out of. `remeasure` re-asks for it fresh at animation
   *  time. Both absent for the no-artwork panel, which has nothing to expand. */
  onOpen: (r: SearchResult, rect?: MarqueeRect, remeasure?: MarqueeRemeasure) => void;
  /** Which kind the list is showing, and how to change it. This is NAVIGATION — the
   *  filter sheet narrows within whichever kind is chosen here. */
  kind: KindKey;
  onKind: (k: KindKey) => void;
  kindCounts?: Partial<Record<KindKey, number>>;
  /** The masthead count's vocabulary — `847 FILMS` on a picked kind. */
  unit?: { one: string; many: string };
}

export default function SubmittedState({
  query,
  total,
  results,
  entryIds,
  keyboardUp,
  onOpen,
  kind,
  onKind,
  kindCounts,
  unit,
}: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  // Re-focusing the field to refine a query should not leave a large image sitting
  // over the results. Derived, not reset, so the chosen row comes back on dismiss.
  const shown = keyboardUp ? null : openIndex;

  const open = shown != null ? results[shown] : undefined;
  const openFilmId = open?.entityType === "movie" ? open.id : null;
  const director = useExpandedFilm(openFilmId);

  const toggle = useCallback((i: number) => setOpenIndex((cur) => (cur === i ? null : i)), []);

  return (
    <View>
      <QueryEcho query={query} count={total} unit={unit} />
      {/* Directly under the masthead, above the rows it governs — you pick the pile
          before you narrow it, and the order on screen says so. */}
      <KindRow value={kind} onChange={onKind} counts={kindCounts} />

      {/* Every slot is a persistent, clipped, layout-animated wrapper — the same
          accordion motion as the recents ledger; the full story lives on the
          wrappers in DefaultState. */}
      {results.map((r, i) => {
        const key = `${r.entityType}-${r.id}`;
        if (i === shown) {
          // NO TYPE LABEL HERE. The card already announces what it is as the tag
          // beside its index, so `PERSON · BARBIE` under the name was the same fact
          // printed twice on one card. Collapsed rows below still carry the full
          // `TYPE · detail`, because nothing else on them says what they are.
          //
          // The expanded film's lane reads YEAR · DIRECTOR; collapsed rows stay at
          // TYPE · YEAR. That difference is the whole budget story — one request per
          // submitted query instead of one per row.
          // The card's lane shares its width with the verb, so a person's known-for
          // is budgeted tighter here than on a collapsed row — see the constant.
          const facts =
            r.entityType === "movie" && r.year && director
              ? `${r.year} · ${director}`
              : metaDetail(r, MARQUEE_KNOWN_FOR_BUDGET);

          return (
            <Animated.View key={key} layout={accordionMotion()} style={{ overflow: "hidden" }}>
              {r.imagePath ? (
                <Marquee
                  imageUrl={`https://image.tmdb.org/t/p/w780${r.imagePath}`}
                  index={i + 1}
                  typeTag={typeLabel(r)}
                  title={r.title}
                  facts={facts}
                  ctaLabel={ctaFor(r.entityType)}
                  // A stronger top stop than the default: over a bright sky the
                  // index and type tag were illegible at 0.40.
                  tone={r.entityType === "person" ? "person" : "submitted"}
                  focusY={r.entityType === "person" ? 0.16 : 0.5}
                  onPressCollapse={() => setOpenIndex(null)}
                  onPressCta={(rect, remeasure) => onOpen(r, rect ?? undefined, remeasure)}
                />
              ) : (
                <NoArtworkPanel
                  index={i + 1}
                  typeTag={typeLabel(r)}
                  title={r.title}
                  facts={facts}
                  ctaLabel={ctaFor(r.entityType)}
                  onPressCollapse={() => setOpenIndex(null)}
                  onPressCta={() => onOpen(r)}
                />
              )}
            </Animated.View>
          );
        }

        return (
          <Animated.View key={key} layout={accordionMotion()} style={{ overflow: "hidden" }}>
            <ResultRow
              result={r}
              index={i + 1}
              query={query}
              mode="submitted"
              hasEntry={r.entityType === "movie" && entryIds.has(r.id)}
              isLast={i === results.length - 1}
              onPress={() => toggle(i)}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}
