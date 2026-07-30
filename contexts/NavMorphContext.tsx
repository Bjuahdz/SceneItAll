import React, { createContext, useContext, useMemo, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";

/**
 * NavMorphContext — shared state for the floating nav pill's collapse morph.
 *
 * The pill is never hidden; it morphs between two states driven by scroll intent:
 *   progress 0 = expanded (icons), progress 1 = collapsed (dot capsule).
 *
 * Screens don't talk to the tab bar directly — they attach the handler from
 * `makeScrollHandler()` to their scrollable and the pill reacts. Thresholds are
 * intent-based (accumulated px in one direction) so tiny jitters don't flap it.
 */

// Gentle, non-bouncy morph, tuned ~20% faster (stiffness ×1.44; damping ×1.2 keeps
// the same damping ratio, so the extra speed adds no bounce). Settles ~230ms.
export const NAV_SPRING = { damping: 31, stiffness: 350, mass: 1 };

const TOP_ZONE = 40; //         at or above this offset the pill is always expanded
const COLLAPSE_MIN_Y = 90; //   never collapse before the user is past the fold
const DOWN_INTENT = 24; //      accumulated downward px before collapsing
const UP_INTENT = 12; //        accumulated upward px before expanding

type NavMorphValue = {
  /** 0 = expanded pill, 1 = collapsed dot capsule. Drive styles with this. */
  progress: SharedValue<number>;
  expand: () => void;
  collapse: () => void;
  /** Build a plain-JS onScroll handler (one per screen — it keeps its own deltas). */
  makeScrollHandler: () => (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

const NavMorphContext = createContext<NavMorphValue | null>(null);

export function NavMorphProvider({ children }: { children: React.ReactNode }) {
  const progress = useSharedValue(0);
  // Last spring target — springs are only (re)started on target changes, never per frame.
  const targetRef = useRef(0);

  const value = useMemo<NavMorphValue>(() => {
    const setTarget = (target: 0 | 1) => {
      if (targetRef.current === target) return;
      targetRef.current = target;
      progress.value = withSpring(target, NAV_SPRING);
    };

    const makeScrollHandler = () => {
      // Per-screen scroll memory: last offset + accumulated directional intent.
      let lastY = 0;
      let downAcc = 0;
      let upAcc = 0;

      return (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y;
        const dy = y - lastY;
        lastY = y;

        // Near the top (including iOS overscroll bounce): always expanded.
        if (y <= TOP_ZONE) {
          downAcc = 0;
          upAcc = 0;
          setTarget(0);
          return;
        }

        if (dy > 0) {
          downAcc += dy;
          upAcc = 0;
          if (downAcc > DOWN_INTENT && y > COLLAPSE_MIN_Y) setTarget(1);
        } else if (dy < 0) {
          upAcc -= dy;
          downAcc = 0;
          if (upAcc > UP_INTENT) setTarget(0);
        }
      };
    };

    return {
      progress,
      expand: () => setTarget(0),
      collapse: () => setTarget(1),
      makeScrollHandler,
    };
    // progress is a stable shared-value ref; nothing here changes across renders.
  }, [progress]);

  return <NavMorphContext.Provider value={value}>{children}</NavMorphContext.Provider>;
}

export function useNavMorph() {
  const ctx = useContext(NavMorphContext);
  if (!ctx) throw new Error("useNavMorph must be used inside NavMorphProvider");
  return ctx;
}
