import React from "react";
import Svg, { Path } from "react-native-svg";

import { SIGNAL } from "@/constants/signal";

// The four-point star that means "you have an entry on this". Path and viewBox are
// verbatim from the Paper board; it replaced an earlier dot because a dot reads as
// a bullet, and this has to read as a mark you earned.
//
// Its three-state vocabulary, kept consistent everywhere:
//   filled star   → has an entry
//   nothing       → released, no entry yet
//   hollow ring   → upcoming, an entry is not yet possible (entity pages, M5)
export default function EntryStar({ size = 13 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Path
        d="M6 0.6L7.15 4.85L11.4 6L7.15 7.15L6 11.4L4.85 7.15L0.6 6L4.85 4.85Z"
        fill={SIGNAL.accent}
      />
    </Svg>
  );
}
