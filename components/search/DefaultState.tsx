import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import LedgerRow from "./LedgerRow";
import Marquee, {
  accordionMotion,
  ctaFor,
  type MarqueeRect,
  type MarqueeRemeasure,
} from "./Marquee";
import NoArtworkPanel from "./NoArtworkPanel";
import OnePickRow from "./OnePickRow";
import SectionHeader from "./SectionHeader";
import { buildOnePick, type Pick } from "@/services/onePick";
import { isAbort } from "@/services/search";
import type { RecentSearch } from "@/services/db";

// The default state: your recents as a single-open accordion, then ONE PICK.
//
// The most recent item is open by default. That is the OPPOSITE of the entity
// pages, where everything starts closed — deliberately so. An entity page has its
// own hero and cannot afford a second one; a list of recents has no hero at all, so
// the open item IS the hero.

const TYPE_LABEL: Record<RecentSearch["entity_type"], string> = {
  movie: "FILM",
  tv: "SHOW",
  collection: "COLLECTION",
  company: "STUDIO",
  person: "PERSON",
};

/**
 * `2017 · VILLENEUVE` when we know the director, `FILM · 2017` when we don't.
 *
 * The director comes from the ROW ITSELF (`subtitle`), written once at commit time
 * by the single /credits request the tap already pays for. Earlier this read a
 * separately-fetched value and left `subtitle` unread — so the stored fact was dead
 * weight and the same request got spent twice.
 */
export const recentMeta = (r: RecentSearch): string => {
  const isFilm = r.entity_type === "movie" || r.entity_type === "tv";
  if (isFilm && r.subtitle && r.year) return `${r.year} · ${r.subtitle}`;
  const label =
    r.entity_type === "person" && r.subtitle === "Directing" ? "DIRECTOR" : TYPE_LABEL[r.entity_type];
  return r.year ? `${label} · ${r.year}` : label;
};

interface Props {
  recents: RecentSearch[];
  entryIds: Set<number>;
  /** Single-open accordion; null means everything is closed, which is what frees the
   *  room that reveals ONE PICK. Owned by the SCREEN, not here — this component now
   *  unmounts whenever the keyboard is up (see ComposeState), so state held locally
   *  would not survive a trip to the field and back. */
  openIndex: number | null;
  onOpenIndexChange: (next: number | null) => void;
  /** `rect` is the marquee's on-screen box — what an entity page expands out of, with
   *  `remeasure` to re-ask fresh at animation time. Absent for the no-artwork panel,
   *  which has nothing to expand. */
  onOpenEntity: (r: RecentSearch, rect?: MarqueeRect, remeasure?: MarqueeRemeasure) => void;
  onOpenPick: (movieId: number) => void;
}

export default function DefaultState({
  recents,
  entryIds,
  openIndex,
  onOpenIndexChange,
  onOpenEntity,
  onOpenPick,
}: Props) {
  const [pick, setPick] = useState<Pick | null>(null);

  /**
   * ▸ THE KEYBOARD GATE IS GONE, and so is the trap that came with it.
   *
   * This used to stay mounted while composing and derive `shown = keyboardUp ? null
   * : openIndex`, which meant the accordion was invisibly still open: tapping the row
   * that was secretly open toggled it CLOSED and the tap read as doing nothing at all.
   * The workaround was a special "a tap while the keyboard is up always OPENS" branch
   * in `toggle`.
   *
   * COMPOSE removed the situation rather than the symptom — this component is not
   * mounted while the keyboard is up, so there is no hidden state to mis-toggle and
   * `openIndex` can be rendered directly.
   */
  const shown = openIndex;

  // Keyed on the vault's CONTENTS, not on the Set's identity. useVault reloads on
  // every screen focus and hands back a fresh Set each time, so depending on the Set
  // itself would re-run this — and spend TMDB requests — every time you so much as
  // returned to the tab. The signature only changes when the vault really changed.
  const vaultSignature = useMemo(
    () => Array.from(entryIds).sort((a, b) => a - b).join(","),
    [entryIds]
  );

  useEffect(() => {
    const controller = new AbortController();
    buildOnePick(entryIds, controller.signal)
      .then(setPick)
      .catch((e) => {
        if (!isAbort(e)) console.error("ONE PICK failed:", e);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultSignature]);

  /** A plain toggle again — see the note on `shown`. */
  const toggle = useCallback(
    (i: number) => onOpenIndexChange(openIndex === i ? null : i),
    [openIndex, onOpenIndexChange]
  );

  return (
    <View>
      <SectionHeader
        label="RECENT"
        right={String(recents.length).padStart(2, "0")}
        align="inline"
        rightTone="dim"
        paddingTop={0}
      />

      <View>
        {/* EVERY SLOT IS A PERSISTENT, CLIPPED, LAYOUT-ANIMATED WRAPPER — this is
            the whole accordion motion. The KEY lives on the wrapper, so it survives
            the row↔card swap inside it: to the layout system the toggle is one view
            whose frame changes from row-height to card-height, and `layout` animates
            exactly that frame on the UI thread. `overflow: hidden` clips the card —
            laid out at FULL size in one commit, no per-frame Yoga — so the growing
            slot reveals it top-down: the unroll. Rows below ride the same clock, so
            the card visibly pushes the list apart instead of teleporting into it.
            The swap used to be that teleport — the full card claimed its ~460px in
            a single frame (Bryan: "very, very harsh"). */}
        {recents.map((r, i) => {
          const key = `${r.entity_type}-${r.entity_id}`;
          if (i === shown) {
            const facts = recentMeta(r);
            const cta = ctaFor(r.entity_type);

            // No artwork → the honest panel, never a fabricated frame. Studios have
            // no usable imagery at all, by decision: TMDB ships black- and
            // white-on-transparent logos with no field to tell them apart.
            return (
              <Animated.View key={key} layout={accordionMotion()} style={{ overflow: "hidden" }}>
                {r.image_path ? (
                  <Marquee
                    imageUrl={`https://image.tmdb.org/t/p/w780${r.image_path}`}
                    index={i + 1}
                    title={r.title}
                    facts={facts}
                    ctaLabel={cta}
                    tone={r.entity_type === "person" ? "person" : "default"}
                    focusY={r.entity_type === "person" ? 0.16 : 0.5}
                    onPressCollapse={() => onOpenIndexChange(null)}
                    onPressCta={(rect, remeasure) => onOpenEntity(r, rect ?? undefined, remeasure)}
                  />
                ) : (
                  <NoArtworkPanel
                    index={i + 1}
                    title={r.title}
                    facts={facts}
                    ctaLabel={cta}
                    onPressCollapse={() => onOpenIndexChange(null)}
                    onPressCta={() => onOpenEntity(r)}
                  />
                )}
              </Animated.View>
            );
          }

          return (
            <Animated.View key={key} layout={accordionMotion()} style={{ overflow: "hidden" }}>
              <LedgerRow
                index={i + 1}
                title={r.title}
                meta={recentMeta(r)}
                hasEntry={r.entity_type === "movie" && entryIds.has(r.entity_id)}
                onPress={() => toggle(i)}
                // The rule under an open marquee still has to read, so the row
                // directly below it carries a top border — and it moves with the
                // open index rather than being hard-coded to row 02.
                showTopBorder={shown != null && i === shown + 1}
                isLast={i === recents.length - 1}
              />
            </Animated.View>
          );
        })}
      </View>

      {/* Omitted entirely when there is nothing honest to recommend — no takes, no
          extracted people, or no unseen film. The gap is NOT filled with trending
          titles; that would turn Search into Discover. */}
      {/* Rides the accordion clock too — it sits below the ledger, so it must
          glide with the rows above it, not jump while they float. */}
      {pick && (
        <Animated.View layout={accordionMotion()} style={{ paddingTop: 18, gap: 14 }}>
          <SectionHeader label="ONE PICK" right="FROM YOUR TAKES" rightTone="dim" paddingTop={0} />
          <OnePickRow pick={pick} onPress={() => onOpenPick(pick.movieId)} />
        </Animated.View>
      )}
    </View>
  );
}
