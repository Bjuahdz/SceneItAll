/**
 * navMetrics — the floating bar's geometry and material, in ONE place.
 *
 * Two things float at the bottom of this app and they are never on screen together:
 * the tab pill on the tabs, the capture pill on a movie. Because you cross between
 * them constantly, they have to occupy the same footprint — same height, same distance
 * off the bottom, same margins, same glass. Anything else reads as two apps.
 *
 * These numbers are the SHIPPED tab pill's, not the spec board's. The board's
 * 56 / r28 / slot-52 read as cramped on device; this is what felt right, so this is
 * what everything else matches.
 *
 * ▸ Change a number here and BOTH pills move together. That is the point — the capture
 *   pill drifted 28pt high and 4pt tall while these lived in two files.
 */

import { Dimensions } from "react-native";

/** Overall size of the bottom furniture. 1 = the original pill, 1.15 = shipped. */
export const NAV_SCALE = 1.15;

const px = (n: number) => Math.round(n * NAV_SCALE);

/** Height of anything that floats at the bottom. 62. */
export const NAV_BAR_H = px(54);
/** Its radius — every floating bar is a full capsule. */
export const NAV_BAR_R = NAV_BAR_H / 2;
/** Inner padding from the capsule's edge to whatever sits in it. */
export const NAV_BAR_PAD = px(7);

/**
 * Distance from the very bottom of the SCREEN — deliberately not `insets.bottom + n`.
 * The tab pill has always been a fixed 20 off the hardware edge, so a capture pill
 * measured off the safe area sat 28pt higher on a home-indicator phone and looked like
 * a different component. One constant, one line.
 */
export const NAV_BOTTOM = 25;

/** Left/right margin of the floating run. */
export const NAV_SIDE_INSET = 16;

/**
 * Air between the island and the KEYBOARD's top edge while composing. Lives here
 * (not in the nav's file) because two things must agree on it: the nav, whose lift
 * pins the island `kbH + KB_GAP` above the screen bottom, and the compose screen's
 * QUICK SEARCHES stack, which anchors itself above that same island. Two copies of
 * this number is a stack that drifts off the island the day one of them is tuned.
 */
export const KB_GAP = 10;

/** Air between two islands at rest. The gap is the point — they never merge. */
export const NAV_ISLAND_GAP = 14;

// ── Seats. A seat is icon-only until it has something to say; then it opens a lane for
// one word. The movie floor's verbs island uses the same numbers so the two bars' seats
// are the same size and their labels open by the same amount.
/** One seat, icon only. */
export const NAV_SLOT_W = px(46);
/** The lane a label opens into, and the air before it. */
export const NAV_LABEL_W = px(54);
export const NAV_LABEL_GAP = px(8);
/** The tinted capsule behind a seat that is "on". */
export const NAV_BUBBLE_H = px(40);
/** Every glyph in the bar. 22-ish: below this most shapes stop reading. */
export const NAV_ICON = px(21);

// ── The FILTER pill's rect, in window coordinates.
//
// DERIVED, NOT MEASURED. The run is centred and spans exactly the side insets in
// the FILTER pose, so the pill's rect is a pure function of the numbers above —
// no measureInWindow, and therefore none of the 0×0 / stale-rect failure modes
// that the entity grow needed a whole retry chain to survive. The filter sheet
// grows out of this; `_layout.tsx` lays the pill out from the same width, so the
// two cannot drift.
const TOTAL_W = Dimensions.get("window").width - NAV_SIDE_INSET * 2;
export const NAV_FILTER_W = TOTAL_W - NAV_BAR_H * 2 - NAV_ISLAND_GAP * 2;
export const NAV_FILTER_RECT = {
  x: NAV_SIDE_INSET + NAV_BAR_H + NAV_ISLAND_GAP,
  y: Dimensions.get("window").height - NAV_BOTTOM - NAV_BAR_H,
  width: NAV_FILTER_W,
  height: NAV_BAR_H,
};

// ── Material. The glass is one recipe: a tint over a blur, and a single hairline rim.
export const NAV_GLASS_TINT = "rgba(15, 15, 20, 0.45)";
export const NAV_GLASS_RIM = "rgba(255, 255, 255, 0.08)";
export const NAV_BLUR_INTENSITY = 45;
