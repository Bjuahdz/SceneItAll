import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import EntryStar from "./EntryStar";
import { ChevronDown } from "./glyphs";
import { FONT, ROW, SEARCH_LAYOUT, SIGNAL, TRACK, TRACK2 } from "@/constants/signal";
import { foldForMatch, type SearchResult } from "@/services/search";

// One row of the results ladder. Text only — there is deliberately no artwork here;
// the whole point of the state is a fast, quiet, scannable list.
//
// Anatomy, and the order matters:
//   typing     [index 20][title + meta, flex 1][14px marker]
//   submitted  [index 20][title + meta, flex 1][14px marker][13px chevron]
// The marker slot ALWAYS occupies its 14px even when empty. Collapsing it when
// there is no star is what breaks the meta lane across rows.
//
// ⚠ THE TWO MODES COLOUR THEMSELVES BY DIFFERENT RULES, and both are verified
// against the boards — this is not an inconsistency to "fix":
//
//   typing     bright vs dim = THE MATCHED PREFIX. Every row's matched characters
//              are ink and the remainder is dim, whether or not you have an entry.
//              The entry is carried by the star alone. (board SVO-0)
//   submitted  bright vs dim = THE ENTRY. The whole row dims — title, index, meta
//              AND chevron — for something you have not journaled. (boards T8O-0,
//              TDX-0: has-entry #E6E0D6/#5C5651/#8A8279, no-entry
//              #6F6862/#4A453F/#5C5651)
//
// They differ because the states do different jobs: while typing you are hunting
// for a string, so the match is the signal; once submitted you are surveying what
// is yours, so the vault is the signal.

const TYPE_LABEL: Record<SearchResult["entityType"], string> = {
  movie: "FILM",
  tv: "SHOW",
  collection: "COLLECTION",
  company: "STUDIO",
  person: "PERSON",
};

/** The label the design speaks, which is not always the entity's type. */
export const typeLabel = (r: SearchResult): string =>
  r.entityType === "person" && r.subtitle === "Directing" ? "DIRECTOR" : TYPE_LABEL[r.entityType];

/**
 * The meta lane under the title.
 *
 * Films and shows get `FILM · 2021` straight from the search response. People get
 * their department plus notable titles, which /search/multi returns free in the
 * same request.
 *
 * Collections and studios read `COLLECTION · 3 FILMS` once that count exists — but no
 * search endpoint returns it, so while typing it would cost one request PER ROW PER
 * KEYSTROKE. Bryan's ruling: bare label during typeahead, count fetched on submit
 * when the list is short and stable. `filmCount` undefined therefore means "not
 * looked up yet" and renders as the bare label — never as a fabricated zero.
 */
// The known-for lane is budgeted by LENGTH, not by a title count.
//
// TMDB titles vary enormously — "Interstellar" is 12 characters, "Birds of Prey
// (and the Fantabulous Emancipation of One Harley Quinn)" is 68. Taking two titles
// unconditionally made McConaughey read as one tidy line and Margot Robbie wrap to
// three, which is the inconsistency: same component, wildly different density,
// entirely at the mercy of who you searched for.
//
// Budgeting instead means a person gets as many titles as genuinely FIT and no
// more — usually two, sometimes one. Every row then looks like every other row.
// 38 is what a 10px mono line holds inside the card's 314px text column.
const KNOWN_FOR_BUDGET = 40;
const KNOWN_FOR_COUNT = 2;

/**
 * The budget for an EXPANDED CARD's lane, which is tighter than a row's.
 *
 * Counter-intuitive but measured: the card is wider than a row, yet its bottom lane
 * shares that width with the verb, leaving less for the known-for than a collapsed
 * row gets. At 40 the lane always overflowed and the flexbox clipped it mid-word —
 * "CAPTAIN AMERICA: CIVIL WAR, CA…". Budgeting to what is actually there degrades
 * one whole step earlier instead: two titles when two fit, otherwise ONE COMPLETE
 * title and no ellipsis at all.
 */
export const MARQUEE_KNOWN_FOR_BUDGET = 30;

/**
 * Trim a title to the part people actually say out loud.
 *
 * This is what makes two titles fit where one used to: the length problem is almost
 * never the film, it is the subtitle bolted onto it. "Birds of Prey (and the
 * Fantabulous Emancipation of One Harley Quinn)" is 68 characters of which the first
 * 13 are the title anyone recognises.
 *
 * ⚠ Splits on a PARENTHESIS or a DASH, never on a colon. "Mission: Impossible –
 * Fallout" must become "Mission: Impossible", not "Mission" — a colon is load-bearing
 * in plenty of real titles, whereas a parenthetical or a dashed subtitle is
 * reliably supplementary.
 */
const shortenTitle = (raw: string): string => {
  let t = raw.trim();
  const paren = t.indexOf(" (");
  if (paren > 0) t = t.slice(0, paren);
  const dash = t.search(/\s[–—-]\s/);
  if (dash > 0) t = t.slice(0, dash);
  return t.trim();
};

/** Cut at a word boundary, so a clipped title never ends mid-word. */
const clipToWord = (t: string, max: number): string => {
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

/**
 * The "known for" lane.
 *
 * Aims for a CONSISTENT COUNT — two titles whenever the person has two — because
 * that is what makes every person card look like every other one. An earlier version
 * budgeted purely by length, which was consistent in density but not in count:
 * McConaughey showed two titles and Margot Robbie showed one, which is still two
 * different-looking cards.
 *
 * Shortening first means both now fit. Only if two SHORTENED titles still overflow
 * does the last one get clipped, so the lane degrades at the tail instead of losing
 * a whole title.
 */
const knownForText = (titles: string[], budget: number = KNOWN_FOR_BUDGET): string => {
  const picked = titles.map(shortenTitle).filter(Boolean).slice(0, KNOWN_FOR_COUNT);
  if (picked.length === 0) return "";

  const joined = picked.join(", ");
  if (joined.length <= budget) return joined.toUpperCase();

  if (picked.length === 1) return clipToWord(picked[0], budget).toUpperCase();

  // Two titles that still overflow: keep the first whole and clip the second into
  // whatever is left, rather than dropping it entirely.
  const remaining = budget - picked[0].length - 2;
  const second = remaining > 8 ? clipToWord(picked[1], remaining) : "";
  return (second ? `${picked[0]}, ${second}` : clipToWord(picked[0], budget)).toUpperCase();
};

/**
 * The meta lane WITHOUT its type label.
 *
 * Used wherever the type is already announced elsewhere — the expanded marquee
 * carries it as a tag beside the index, so repeating "PERSON" underneath the name
 * is the same fact twice on one card.
 */
export const metaDetail = (r: SearchResult, budget?: number): string => {
  if (r.entityType === "person") return knownForText(r.knownFor ?? [], budget);
  if (r.entityType === "collection" || r.entityType === "company") {
    return r.filmCount === undefined
      ? ""
      : `${r.filmCount} ${r.filmCount === 1 ? "FILM" : "FILMS"}`;
  }
  return r.year ?? "";
};

/** The full lane, `TYPE · detail`, for rows that do NOT show the type anywhere else. */
export const metaLine = (r: SearchResult): string => {
  const label = typeLabel(r);
  const detail = metaDetail(r);
  return detail ? `${label} · ${detail}` : label;
};

/**
 * Split the title into [before, matched, after] against the query.
 *
 * The board only ever shows PREFIX matches (`DUNE` bright, `: PART TWO` dim), which
 * this reproduces exactly — `before` is empty in that case. Handling an interior
 * match as well costs nothing and stops a mid-word hit from rendering the whole
 * title dim, which would read as "no match" on a row that plainly matched.
 *
 * Matching goes through foldForMatch — THE SAME fold the ranker tiers with — so the
 * highlight and the search can never disagree about what a match is. They did once:
 * this compared raw lowercase, so "Beyonc" lit up and the final plain "e" of
 * "beyonce" un-lit every Beyoncé row the ranker was still matching (device,
 * 2026-08-01). The folded index walks back to original characters through a
 * per-character map, because folding can change a character's length.
 */
const splitTitle = (title: string, query: string): [string, string, string] => {
  const q = foldForMatch(query);
  if (!q) return ["", "", title];
  const folded: string[] = [];
  const origin: number[] = [];
  for (let i = 0; i < title.length; i++) {
    for (const c of foldForMatch(title[i])) {
      folded.push(c);
      origin.push(i);
    }
  }
  const at = folded.join("").indexOf(q);
  if (at < 0) return ["", "", title];
  const start = origin[at];
  // The end maps to the ORIGINAL character holding the match's last folded char,
  // and the slice runs through the whole of it — a highlight may cover one glyph
  // more than the folded span, never less.
  const end = origin[at + q.length - 1] + 1;
  return [title.slice(0, start), title.slice(start, end), title.slice(end)];
};

interface Props {
  result: SearchResult;
  /** 1-based rank; rendered zero-padded as the board does. */
  index: number;
  query: string;
  hasEntry: boolean;
  mode?: "typing" | "submitted";
  /** The last row carries no hairline — the list ends, it isn't cut off. */
  isLast?: boolean;
  onPress: (r: SearchResult) => void;
}

export default function ResultRow({
  result,
  index,
  query,
  hasEntry,
  mode = "typing",
  isLast,
  onPress,
}: Props) {
  const [before, matched, after] = useMemo(
    () => splitTitle(result.title, query),
    [result.title, query]
  );
  const meta = metaLine(result);
  const submitted = mode === "submitted";

  return (
    <Pressable
      style={[styles.row, isLast && styles.rowLast]}
      onPress={() => onPress(result)}
      accessibilityRole="button"
      // The old rows were a bare <Link> with no label at all — a screen reader read
      // the raw title and nothing about what kind of thing it was, or that you had
      // already written about it.
      accessibilityLabel={`${result.title}. ${meta.replace(/ · /g, ", ")}.${
        hasEntry ? " You have an entry." : ""
      }`}
    >
      <Text style={[styles.index, submitted && !hasEntry && styles.indexDim]}>
        {String(index).padStart(2, "0")}
      </Text>

      <View style={styles.body}>
        {/* Nested Text rather than a flex row of two Texts: RN only flows and WRAPS
            runs correctly when they are nested, and long titles genuinely do wrap to
            two lines. A flex row would clip them instead. */}
        <Text
          style={[styles.title, submitted && styles.titleSubmitted]}
          numberOfLines={2}
        >
          {submitted ? (
            <Text style={hasEntry ? styles.titleEntry : styles.titleDim}>{result.title}</Text>
          ) : (
            <>
              {before ? <Text style={styles.titleDim}>{before}</Text> : null}
              <Text style={styles.titleMatch}>{matched}</Text>
              {after ? <Text style={styles.titleDim}>{after}</Text> : null}
            </>
          )}
        </Text>
        <Text
          style={[styles.meta, submitted && !hasEntry && styles.metaDim]}
          numberOfLines={1}
        >
          {meta}
        </Text>
      </View>

      <View style={styles.marker}>{hasEntry ? <EntryStar /> : null}</View>

      {submitted ? <ChevronDown color={hasEntry ? ROW.titleDim : ROW.indexDim} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    // minHeight, not height: a title that wraps to two lines must grow its row
    // rather than clip. Single-line rows land on the board's 62 exactly.
    minHeight: SEARCH_LAYOUT.rowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: SEARCH_LAYOUT.rowGap,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SIGNAL.line,
    paddingVertical: 8,
  },
  rowLast: { borderBottomWidth: 0 },
  index: {
    width: SEARCH_LAYOUT.indexWidth,
    flexShrink: 0,
    color: ROW.index,
    fontFamily: FONT.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: TRACK.index11,
  },
  indexDim: { color: ROW.indexDim },
  body: { flex: 1, gap: 4 },
  title: {
    // No fontWeight — the ExtraBold face IS the weight. Adding one here makes
    // Android synthesize a bolder version on top of an already-heavy face.
    fontFamily: FONT.display,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: TRACK.title19,
    textTransform: "uppercase",
  },
  // Submitted rows sit one step smaller — the query echo above them is the display
  // type on that screen, so the rows must not compete with it.
  titleSubmitted: { fontSize: 18, lineHeight: 22, letterSpacing: TRACK2.title18 },
  titleMatch: { color: SIGNAL.ink },
  titleEntry: { color: ROW.titleEntry },
  titleDim: { color: ROW.titleDim },
  meta: {
    color: SIGNAL.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: TRACK.micro10,
  },
  metaDim: { color: ROW.yearDim },
  marker: {
    width: SEARCH_LAYOUT.markerWidth,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
