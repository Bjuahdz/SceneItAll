import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

import { SIGNAL } from "@/constants/signal";

// The search surface's directional language, in ONE place.
//
// GLYPH LAW:
//   ×              always means ERASE
//   chevron-down   open this / put the keyboard away  (collapse & dismiss)
//   chevron-up     close an open item
//   chevron-right  navigate away
//   loupe          tapping this RUNS A SEARCH — never "open the thing itself"
//
// A cross-board audit found the same three chevrons authored twice — once at a
// 12-unit viewBox with a 1.5 stroke and once at 13 units with 1.3 — which would
// have shipped two subtly different weights on screens sitting next to each other.
// The 12/1.5 family is the one used on every result and ledger board, so it wins
// and lives here rather than being re-typed per component.

const STROKE = 1.5;

type G = { size?: number; color?: string };

export const ChevronDown = ({ size = 13, color = "#6F6862" }: G) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path
      d="M2.4 4.4L6 8L9.6 4.4"
      fill="none"
      stroke={color}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ChevronUp = ({ size = 13, color = "#D6CFC5" }: G) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path
      d="M2.4 7.6L6 4L9.6 7.6"
      fill="none"
      stroke={color}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ChevronRight = ({ size = 12, color = SIGNAL.ink }: G) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path
      d="M4.2 2.4L8.4 6L4.2 9.6"
      fill="none"
      stroke={color}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ChevronLeft = ({ size = 18, color = SIGNAL.ink }: G) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path
      d="M7.8 2.4L3.6 6L7.8 9.6"
      fill="none"
      stroke={color}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** The QUICK SEARCHES card wears this at its tail. Same 12-unit / 1.5-stroke
 *  family as the chevrons — the audit's whole point was one weight everywhere. */
export const Loupe = ({ size = 12, color = SIGNAL.muted }: G) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Circle cx={5.2} cy={5.2} r={3.4} fill="none" stroke={color} strokeWidth={STROKE} />
    <Path
      d="M7.8 7.8L10.4 10.4"
      fill="none"
      stroke={color}
      strokeWidth={STROKE}
      strokeLinecap="round"
    />
  </Svg>
);
