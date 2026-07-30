import React, { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

import { TICKET_ACCENT, INK_AMBER, INK_RED } from "./ticketTheme";

// How far the card slides left to expose the edge tabs (sized for the grown tabs).
const OPEN_W = 190;

// The list's horizontal inset (MovieEntriesTab root paddingHorizontal: 16). The
// tab rail is pushed out past it so the tabs sit FLUSH with the screen's right
// edge — they read as physical tabs sticking off the ticket stack.
const EDGE_BLEED = 16;

// Where each tab starts before its stagger window slides it in: off-screen right.
const TAB_FROM_X = 170;

// Per-tab stagger windows over drag progress p = -tx / OPEN_W (tab 0 = top).
// All three read the SAME p, so dragging back retracts them bottom-first
// automatically — the stagger reverses for free.
const TAB_WINDOWS: [number, number][] = [
  [0.1, 0.45],
  [0.35, 0.7],
  [0.6, 0.95],
];

// The nav pill's spring (NAV_SPRING twin) — snappy settle, no visible bounce.
const ROW_SPRING = { damping: 31, stiffness: 350, mass: 1 };

// One tab's drag-tied entrance: within its window it slides in from off-screen
// right and fades up; outside it, it clamps fully hidden / fully seated.
function useTabStyle(tx: SharedValue<number>, index: number) {
  return useAnimatedStyle(() => {
    const p = Math.min(1, -tx.value / OPEN_W);
    const [a, b] = TAB_WINDOWS[index];
    return {
      opacity: interpolate(p, [a, b], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(p, [a, b], [TAB_FROM_X, 0], Extrapolation.CLAMP) },
      ],
    };
  });
}

interface TakeSwipeRowProps {
  /** Externally-owned open state — the parent keeps at most one row open. */
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Add this take to the multi-selection. */
  onSelect: () => void;
  /** Toggle is_spoiler immediately. */
  onSpoiler: () => void;
  /** Delete immediately — the swipe was the intent, no extra confirm. */
  onDelete: () => void;
  /** Flips the top tab's label: SPOILER ↔ UNMARK. */
  isSpoiler: boolean;
  /** Armed while a horizontal drag is live (+ a beat after) — in-card press
      handlers check it so a swipe can never double as a tap on the title,
      transcript, or play chip. */
  tapGuardRef?: React.MutableRefObject<boolean>;
  children: React.ReactNode;
}

/**
 * Swipe-to-reveal shell for one take card — EDGE TABS edition. Swiping the card
 * LEFT slides three right-flush tabs in from off-screen (SPOILER · DELETE ·
 * SELECT, top to bottom), each anchored to the SCREEN's right edge with rounded
 * left corners and a colored leading-edge bar. The group is a fixed-height
 * cluster vertically centered against the card, and each tab enters inside its
 * own window of the drag progress, so the stagger tracks the finger both ways.
 *
 * Scroll safety: the pan only ACTIVATES after 14px of horizontal travel and
 * FAILS after 12px of vertical travel, so a mostly-vertical drag always belongs
 * to the surrounding ScrollView.
 */
export default function TakeSwipeRow({
  isOpen,
  onOpen,
  onClose,
  onSelect,
  onSpoiler,
  onDelete,
  isSpoiler,
  tapGuardRef,
  children,
}: TakeSwipeRowProps) {
  const tx = useSharedValue(0);
  const startX = useSharedValue(0);
  const dragLive = useSharedValue(false);

  // External close (another row opened, an action fired, the scroll fold) — spring shut.
  useEffect(() => {
    if (!isOpen) tx.value = withSpring(0, ROW_SPRING);
  }, [isOpen, tx]);

  // The tap guard: armed the instant the pan ACTIVATES (a child touchable may
  // already own this touch and will still fire its press on release — the guard
  // is what makes that press a no-op), disarmed a beat after the gesture ends
  // so the release itself stays covered.
  const armGuard = () => {
    if (tapGuardRef) tapGuardRef.current = true;
  };
  const disarmGuard = () => {
    setTimeout(() => {
      if (tapGuardRef) tapGuardRef.current = false;
    }, 160);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onStart(() => {
      startX.value = tx.value;
      if (!dragLive.value) {
        dragLive.value = true;
        runOnJS(armGuard)();
      }
    })
    .onUpdate((e) => {
      const raw = startX.value + e.translationX;
      // Never pull right past closed; gentle resistance past the open pose.
      tx.value = raw > 0 ? 0 : raw < -OPEN_W ? -OPEN_W + (raw + OPEN_W) * 0.18 : raw;
    })
    .onEnd((e) => {
      const open = e.velocityX < -420 || (tx.value < -OPEN_W / 2 && e.velocityX < 420);
      tx.value = withSpring(open ? -OPEN_W : 0, ROW_SPRING);
      if (open) runOnJS(onOpen)();
      else runOnJS(onClose)();
    })
    .onFinalize(() => {
      if (dragLive.value) {
        dragLive.value = false;
        runOnJS(disarmGuard)();
      }
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const spoilerStyle = useTabStyle(tx, 0);
  const deleteStyle = useTabStyle(tx, 1);
  const selectStyle = useTabStyle(tx, 2);

  return (
    <View>
      {/* The tab rail — behind the card, bleeding past the list padding so the
          tabs touch the screen edge. Ragged left edges: each tab keeps its own
          natural width and right-aligns. */}
      <View style={styles.rail} pointerEvents="box-none">
        <Animated.View style={[styles.tabWrap, spoilerStyle]}>
          <TouchableOpacity
            onPress={onSpoiler}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={isSpoiler ? "Unmark spoiler" : "Mark as spoiler"}
          >
            <View style={styles.tab}>
              <View style={[styles.tabEdge, { backgroundColor: INK_AMBER }]} />
              <Ionicons name="eye-off" size={21} color={INK_AMBER} />
              <Text style={styles.tabLabel}>{isSpoiler ? "UNMARK" : "SPOILER"}</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.tabWrap, deleteStyle]}>
          <TouchableOpacity
            onPress={onDelete}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel="Delete take"
          >
            <View style={styles.tab}>
              <View style={[styles.tabEdge, { backgroundColor: INK_RED }]} />
              <Ionicons name="trash-outline" size={21} color={INK_RED} />
              <Text style={styles.tabLabel}>DELETE</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.tabWrap, selectStyle]}>
          <TouchableOpacity
            onPress={onSelect}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel="Select take"
          >
            <View style={styles.tab}>
              <View style={[styles.tabEdge, { backgroundColor: TICKET_ACCENT }]} />
              <Ionicons name="checkmark-circle-outline" size={21} color={TICKET_ACCENT} />
              <Text style={styles.tabLabel}>SELECT</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={cardStyle}>
          {children}
          {/* While open, one transparent sheet over the card: any tap just closes
              the row instead of firing the card's own controls. */}
          {isOpen && (
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close take actions"
            />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fixed-height group (3×58 + 2×10 = 194) vertically centered against the card,
  // whatever the card's height. right: -EDGE_BLEED puts the tabs' cut-off right
  // sides at the true screen edge.
  rail: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: -EDGE_BLEED,
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 10,
  },
  tabWrap: { alignSelf: "flex-end" },
  // A physical tab: rounded on the left, sheared flat where it meets the screen
  // edge, no right border — it reads as continuing off the glass.
  tab: {
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 19,
    paddingRight: 26,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: "rgba(30,30,36,0.97)",
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: "rgba(255,255,255,0.14)",
  },
  // The leading-edge color bar — the only loud color on the tab.
  tabEdge: {
    position: "absolute",
    left: 0,
    top: 9,
    bottom: 9,
    width: 3,
    borderRadius: 1.5,
  },
  tabLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
});
