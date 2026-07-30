import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import Svg, { Line } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useIsFocused } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";

import SkyCanvas, { type SkyController } from "@/components/home/SkyCanvas";
import { useHomeData } from "@/components/home/useHomeData";
import {
  connectionsFor,
  kindIndex,
  scrubSpectrum,
  scrubToIndex,
  tintHex,
  AMBER,
  type StageItem,
} from "@/components/home/skyModel";

// ─────────────────────────────────────────────────────────────────────────────
// The Explore sheet (29c) — the same living sky, live: drift onto a film to
// LOCK it and its evidence-backed threads grow; the locked film becomes a
// swipeable stage you page through its connections (swiping re-locks the sky);
// a kind dot-index groups those connections under their line samples; and a
// spectrum scrub at the foot walks you across genres.
//
// Modules B (sky), C (stage pager + kind index) and D (spectrum scrub) of the
// handoff. The sky engine itself lives in components/home/SkyCanvas.tsx.
// ─────────────────────────────────────────────────────────────────────────────

const { width: W, height: H } = Dimensions.get("window");
const CARD_W = 240;
const CARD_GAP = 14;
const STEP = CARD_W + CARD_GAP; // 254
const SIDE_PAD = Math.max(12, (W - CARD_W) / 2);
const RELOCK_MS = 180;

const posterUri = (path: string | null) =>
  path
    ? `https://image.tmdb.org/t/p/w342${path}`
    : "https://placehold.co/342x513/12101c/FFFFFF.png";

/** A kind's line sample — solid / dashed / dotted, per the connection grammar. */
const LineSample = ({
  dash,
  colour,
  width = 24,
}: {
  dash: number[];
  colour: string;
  width?: number;
}) => (
  <Svg width={width} height={4} viewBox={`0 0 ${width} 4`}>
    <Line
      x1={1.5}
      y1={2}
      x2={width - 1.5}
      y2={2}
      stroke={colour}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeDasharray={dash.length ? dash.join(",") : undefined}
    />
  </Svg>
);

const StageCard = ({ item }: { item: StageItem }) => {
  const kickerColour = item.isLock
    ? "rgba(156,202,223,0.9)"
    : item.amber
      ? AMBER
      : "rgba(207,216,245,0.75)";
  return (
    <View style={styles.card}>
      <View style={styles.cardKicker}>
        {!item.isLock && (
          <LineSample dash={item.dash} colour={item.amber ? AMBER : "rgba(207,216,245,0.9)"} width={18} />
        )}
        <Text style={[styles.kickerText, { color: kickerColour }]}>{item.kicker}</Text>
      </View>

      <View style={[styles.posterWrap, { shadowColor: item.hue }]}>
        <ExpoImage
          source={{ uri: posterUri(item.posterPath) }}
          style={styles.poster}
          contentFit="cover"
          transition={220}
          cachePolicy="memory-disk"
        />
      </View>

      <Text style={styles.cardTitle} numberOfLines={1}>
        {item.title}
      </Text>
      {!!item.reason && (
        <Text style={styles.cardReason} numberOfLines={1}>
          {item.reason}
        </Text>
      )}
      <Text style={styles.cardSub} numberOfLines={1}>
        {[
          item.year,
          item.rating != null ? `★ ${item.rating.toFixed(1)}` : null,
          `${item.takeCount} take${item.takeCount === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </View>
  );
};

export default function Explore() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { sky, ready } = useHomeData();

  const controller = useRef<SkyController | null>(null);
  const rail = useRef<ScrollView | null>(null);
  const relockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGenre = useRef(-1);
  // Read through refs inside the queued relock so it can never act on a stale
  // snapshot of items/lock taken when the timer was scheduled.
  const itemsRef = useRef<StageItem[]>([]);
  const lockedIdRef = useRef<number | null>(null);

  const [lockedId, setLockedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [nearGenre, setNearGenre] = useState(0);

  const items = useMemo(() => connectionsFor(sky, lockedId), [sky, lockedId]);
  const lockHue = items[0]?.hue ?? "#5d8dee";
  const columns = useMemo(() => kindIndex(items, lockHue), [items, lockHue]);
  const scrub = useMemo(() => scrubSpectrum(sky.genres, nearGenre), [sky.genres, nearGenre]);

  // ---- sky callbacks ----
  const onLock = useCallback((movieId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLockedId(movieId);
  }, []);
  const onRelease = useCallback(() => setLockedId(null), []);
  const onNearGenre = useCallback((i: number) => {
    setNearGenre(i);
    if (lastGenre.current !== -1 && lastGenre.current !== i) Haptics.selectionAsync();
    lastGenre.current = i;
  }, []);

  itemsRef.current = items;
  lockedIdRef.current = lockedId;

  // A new lock resets the stage to card 0 (the locked film) and cancels any
  // relock still queued from the swipe that caused it.
  useEffect(() => {
    if (relockTimer.current) {
      clearTimeout(relockTimer.current);
      relockTimer.current = null;
    }
    setPage(0);
    const id = setTimeout(() => rail.current?.scrollTo({ x: 0, animated: false }), 30);
    return () => clearTimeout(id);
  }, [lockedId]);

  useEffect(
    () => () => {
      if (relockTimer.current) clearTimeout(relockTimer.current);
    },
    []
  );

  // While the rail moves we only track the page (that drives the dot index).
  // Re-locking the sky waits until the scroll has actually come to rest —
  // firing mid-drag would yank the rail back to card 0 under the user's finger.
  const onRailScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.max(0, Math.min(itemsRef.current.length - 1, Math.round(x / STEP)));
      setPage((prev) => {
        if (prev !== idx) Haptics.selectionAsync();
        return idx;
      });
    },
    []
  );

  const cancelRelock = useCallback(() => {
    if (relockTimer.current) {
      clearTimeout(relockTimer.current);
      relockTimer.current = null;
    }
  }, []);

  const settleRelock = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const list = itemsRef.current;
      const idx = Math.max(0, Math.min(list.length - 1, Math.round(x / STEP)));
      cancelRelock();
      relockTimer.current = setTimeout(() => {
        relockTimer.current = null;
        const it = itemsRef.current[idx];
        if (it && it.id !== lockedIdRef.current) controller.current?.lockById(it.id);
      }, RELOCK_MS);
    },
    [cancelRelock]
  );

  const jumpTo = useCallback((idx: number) => {
    rail.current?.scrollTo({ x: idx * STEP, animated: true });
  }, []);

  // ---- spectrum scrub ----
  const railW = W - 52; // padding 26 each side
  const applyScrub = useCallback(
    (x: number) => {
      if (sky.genres.length < 2) return;
      const i = scrubToIndex(x / railW, sky.genres);
      if (i !== nearGenre) {
        setNearGenre(i);
        Haptics.selectionAsync();
        controller.current?.flyToGenre(i);
      }
    },
    [sky.genres, nearGenre, railW]
  );
  const scrubGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin((e) => applyScrub(e.x))
        .onUpdate((e) => applyScrub(e.x)),
    [applyScrub]
  );

  const locked = lockedId != null && items.length > 0;

  return (
    <View style={styles.container}>
      <SkyCanvas
        data={sky}
        width={W}
        height={H}
        interactive
        active={isFocused && ready}
        onLock={onLock}
        onRelease={onRelease}
        onNearGenre={onNearGenre}
        controllerRef={controller}
      />

      {/* Title + close */}
      <Text style={[styles.title, { top: insets.top + 12 }]} pointerEvents="none">
        M O V I E S
      </Text>
      <Pressable
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + 2 }]}
        accessibilityRole="button"
        accessibilityLabel="Close explore"
        hitSlop={10}
      >
        <Ionicons name="close" size={15} color="rgba(255,255,255,0.75)" />
      </Pressable>

      {/* Hint — fades out once something is locked */}
      {!locked && (
        <Animated.Text
          entering={FadeIn.duration(400)}
          exiting={FadeOut.duration(300)}
          style={[styles.hint, { bottom: insets.bottom + 64 }]}
          pointerEvents="none"
        >
          DRIFT CLOSE AND LINGER — THE CONNECTIONS FIND YOU
        </Animated.Text>
      )}

      {/* Module C — kind dot-index */}
      {locked && columns.length > 0 && (
        <Animated.View
          entering={FadeIn.duration(400)}
          exiting={FadeOut.duration(250)}
          style={[styles.kindIndex, { bottom: insets.bottom + 94 }]}
        >
          {columns.map((col, ci) => (
            <Pressable
              key={`kcol-${col.label}`}
              onPress={() => jumpTo(col.firstIdx)}
              style={[styles.kindCol, ci > 0 && styles.kindColDivider]}
              accessibilityRole="button"
              accessibilityLabel={`Jump to ${col.label} connections`}
            >
              <LineSample dash={col.dash} colour={col.colour} />
              <Text
                style={[
                  styles.kindLabel,
                  { color: col.colour === AMBER ? AMBER : "rgba(207,216,245,0.72)" },
                ]}
              >
                {col.label}
              </Text>
              <View style={styles.kindDots}>
                {col.dots.map((d) => (
                  <View
                    key={`kd-${d}`}
                    style={[
                      styles.kindDot,
                      { backgroundColor: d === page ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.26)" },
                    ]}
                  />
                ))}
              </View>
            </Pressable>
          ))}
        </Animated.View>
      )}

      {/* Module C — the stage pager */}
      {locked && (
        <Animated.View
          entering={FadeIn.duration(400)}
          exiting={FadeOut.duration(250)}
          style={[styles.railWrap, { bottom: insets.bottom + 138 }]}
        >
          <ScrollView
            ref={rail}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={STEP}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: SIDE_PAD, gap: CARD_GAP }}
            onScroll={onRailScroll}
            // onScrollEndDrag covers a release with no momentum; if momentum DOES
            // start, cancel that timer (it holds the pre-flick index) and let
            // onMomentumScrollEnd settle on the card the flick actually lands on.
            onScrollEndDrag={settleRelock}
            onMomentumScrollBegin={cancelRelock}
            onMomentumScrollEnd={settleRelock}
            scrollEventThrottle={16}
          >
            {items.map((it) => (
              <StageCard key={`stage-${it.id}`} item={it} />
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {/* Module D — spectrum scrub */}
      {sky.genres.length > 0 && (
        <View style={[styles.scrubWrap, { paddingBottom: insets.bottom + 12 }]}>
          <LinearGradient
            colors={["rgba(2,1,12,0)", "rgba(2,1,12,0.92)"]}
            locations={[0, 0.45]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <GestureDetector gesture={scrubGesture}>
            <View style={styles.scrubTrackArea} collapsable={false}>
              {scrub.active && (
                <Text
                  style={[
                    styles.scrubLabel,
                    {
                      left: `${Math.max(15, Math.min(85, scrub.active.centerPct))}%`,
                      color: tintHex(scrub.active.hue, 0.5),
                    },
                  ]}
                  numberOfLines={1}
                >
                  {scrub.active.label}
                </Text>
              )}
              <View style={styles.scrubTrack}>
                {scrub.bands.map((b, i) => (
                  <View
                    key={`band-${i}`}
                    style={{ flexGrow: b.widthPct, backgroundColor: `${b.hue}66` }}
                  />
                ))}
              </View>
              {scrub.bands.map((b, i) => {
                const on = i === nearGenre;
                return (
                  <View
                    key={`tick-${i}`}
                    style={[
                      styles.scrubTick,
                      {
                        left: `${b.centerPct}%`,
                        width: on ? 8 : 4.5,
                        height: on ? 8 : 4.5,
                        borderRadius: on ? 4 : 2.25,
                        marginLeft: on ? -4 : -2.25,
                        marginTop: on ? -4 : -2.25,
                        backgroundColor: on ? `${b.hue}f2` : `${b.hue}8c`,
                        borderWidth: on ? 1.5 : 0,
                        shadowColor: b.hue,
                        shadowOpacity: on ? 0.45 : 0,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </GestureDetector>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#02010c",
  },
  title: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 3.5,
    color: "rgba(255,255,255,0.35)",
  },
  close: {
    position: "absolute",
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    zIndex: 5,
  },
  hint: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 8.5,
    fontWeight: "600",
    letterSpacing: 2.5,
    color: "rgba(255,255,255,0.22)",
  },
  // Kind dot-index
  kindIndex: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    zIndex: 6,
  },
  kindCol: {
    alignItems: "center",
    gap: 4,
  },
  kindColDivider: {
    paddingLeft: 16,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.1)",
  },
  kindLabel: {
    fontSize: 6.5,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  kindDots: {
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
  },
  kindDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
  },
  // Stage pager
  railWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 6,
  },
  card: {
    width: CARD_W,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: "center",
    gap: 8,
  },
  cardKicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    justifyContent: "center",
  },
  kickerText: {
    fontSize: 7,
    fontWeight: "800",
    letterSpacing: 2,
  },
  posterWrap: {
    width: 88,
    height: 130,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  poster: {
    width: "100%",
    height: "100%",
  },
  cardTitle: {
    maxWidth: "100%",
    fontSize: 11.5,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
  },
  cardReason: {
    maxWidth: "100%",
    fontSize: 8.5,
    lineHeight: 12,
    color: "rgba(207,216,245,0.6)",
    textAlign: "center",
  },
  cardSub: {
    maxWidth: "100%",
    fontSize: 8,
    color: "rgba(255,255,255,0.42)",
    textAlign: "center",
  },
  // Spectrum scrub
  scrubWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
    paddingHorizontal: 26,
    zIndex: 5,
  },
  scrubTrackArea: {
    height: 38,
    justifyContent: "flex-start",
  },
  scrubLabel: {
    position: "absolute",
    top: 2,
    transform: [{ translateX: "-50%" }], // centre on the tick, not 50 points left of it
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  scrubTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 25,
    height: 2,
    borderRadius: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  scrubTick: {
    position: "absolute",
    top: 26,
    borderColor: "rgba(255,255,255,0.75)",
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
