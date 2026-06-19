import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from "react-native-reanimated";
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop } from "react-native-svg";

const ACCENT = "#9ccadf";
// Cooler, slightly muted gain/loss so they sit in the app's cool palette next to the
// cyan accent instead of reading as neon. Position (above/below the line) still carries
// the meaning; colour just reinforces it.
const GAIN = "#46d29a";
const LOSS = "#e96a67";

const PAD_X = 24; // horizontal inset so edge peaks/labels aren't clipped
const CHART_H = 400; // plot area height — taller so magnitudes read clearly
const HALF = CHART_H / 2; // the zero (break-even) line
const PEAK_PAD = 10; // keep peaks off the very top/bottom edges
// Reserve a band at the very top of the plot for the floating readout — this is what
// lets the readout sit above the user's thumb while scrubbing.
const TOP_BAND = 56;
const CALLOUT_W = 158;

type BoxOfficeMovie = {
  id: number;
  title: string;
  release_date?: string;
  budget: number;
  revenue: number;
};

type ChartPoint = {
  id: number;
  title: string;
  date?: string;
  profit: number;
  x: number;
  y: number;
  gain: boolean;
};

const fmtMoney = (n: number) => {
  const abs = Math.abs(n);
  const sign = n >= 0 ? "+" : "-";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${Math.round(abs / 1e6)}M`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
};

const fmtDate = (d?: string) => {
  if (!d) return "—";
  const date = new Date(d);
  return isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

const fmtAxis = (d?: string) => {
  if (!d) return "";
  const date = new Date(d);
  return isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

// Catmull-Rom → cubic Bézier: a smooth curve through the points (the "stock chart" look).
const smoothLinePath = (pts: ChartPoint[]) => {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  }
  return d;
};

interface Props {
  cashCowMovies: BoxOfficeMovie[];
  moneyPitMovies: BoxOfficeMovie[];
  title?: string;
}

/**
 * Box Office as one diverging area chart instead of poster cards: a smooth curve over
 * the movies (ordered by release date), filled green where it rises above the
 * break-even line (cash cows) and red where it dips below (money pits) — peaks are the
 * movies. Drag the crosshair to glide between them; a readout floats at the TOP of the
 * chart (above your thumb) showing title · date · gain/loss, and the crosshair + marker
 * take the selected point's colour. Tap a point to open its detail page. Needs only
 * title/date/budget/revenue — no posters or logos — so it's lean.
 *
 * Frosted-glass "stat card" matching the app's nav/header surfaces. Up and down halves
 * are scaled independently so one billion-dollar hit doesn't flatten the flops. The
 * fill/stroke gradients flip colour exactly at the zero line (its 50% offset).
 */
const BoxOfficeChart = ({ cashCowMovies, moneyPitMovies, title = "Box Office" }: Props) => {
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const widthSV = useSharedValue(0);
  const crosshairX = useSharedValue(0);
  const lastIdx = useSharedValue(-1);

  const points = useMemo<ChartPoint[]>(() => {
    if (!width) return [];

    // Balance the two sides so the chart shows EQUAL counts of winners and losers,
    // regardless of how many flops the (supply-limited) money-pit scan surfaced. Both
    // arrays arrive pre-ranked (biggest gain / biggest loss first), so slicing to the
    // smaller count keeps the most extreme movers on each side. If one side is empty,
    // fall back to the other rather than rendering a blank chart.
    const cows = (cashCowMovies || []).filter((m) => m && typeof m.budget === "number" && typeof m.revenue === "number");
    const pits = (moneyPitMovies || []).filter((m) => m && typeof m.budget === "number" && typeof m.revenue === "number");
    const balance = Math.min(cows.length, pits.length);
    const picked = balance > 0 ? [...cows.slice(0, balance), ...pits.slice(0, balance)] : [...cows, ...pits];

    const merged = picked
      .map((m) => ({ id: m.id, title: m.title, date: m.release_date, profit: m.revenue - m.budget }))
      .sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return ta - tb;
      });

    const n = merged.length;
    if (n === 0) return [];

    const gains = merged.filter((p) => p.profit >= 0).map((p) => p.profit);
    const losses = merged.filter((p) => p.profit < 0).map((p) => -p.profit);
    const maxGain = gains.length ? Math.max(...gains) : 1;
    const maxLoss = losses.length ? Math.max(...losses) : 1;
    const gap = n > 1 ? (width - PAD_X * 2) / (n - 1) : 0;
    // Usable half-height for the peaks, with the top readout band held clear.
    const reach = HALF - TOP_BAND - PEAK_PAD;

    return merged.map((p, i) => {
      const x = n > 1 ? PAD_X + i * gap : width / 2;
      const y =
        p.profit >= 0
          ? HALF - (p.profit / maxGain) * reach
          : HALF + (-p.profit / maxLoss) * reach;
      return { ...p, x, y, gain: p.profit >= 0 };
    });
  }, [cashCowMovies, moneyPitMovies, width]);

  const pointsRef = useRef(points);
  pointsRef.current = points;
  const n = points.length;

  // Smooth curve + the area beneath it (down to the zero line). Depend on points only,
  // so they aren't rebuilt while scrubbing (only the active marker moves then).
  const linePath = useMemo(() => smoothLinePath(points), [points]);
  const areaPath = useMemo(
    () => (linePath && n > 1 ? `${linePath} L ${points[n - 1].x} ${HALF} L ${points[0].x} ${HALF} Z` : ""),
    [linePath, points, n]
  );

  // Default the crosshair to the biggest mover so the card looks alive on load.
  useEffect(() => {
    if (n === 0) return;
    let di = 0;
    let best = -Infinity;
    points.forEach((p, i) => {
      const mag = Math.abs(p.profit);
      if (mag > best) {
        best = mag;
        di = i;
      }
    });
    setActive(di);
    crosshairX.value = points[di].x;
    lastIdx.value = di;
  }, [points, n]);

  const openMovie = useCallback(
    (idx: number) => {
      const p = pointsRef.current[idx];
      if (p) router.push(`/movie/${p.id}`);
    },
    [router]
  );

  const gesture = useMemo(() => {
    const snap = (x: number) => {
      "worklet";
      const gap = n > 1 ? (widthSV.value - PAD_X * 2) / (n - 1) : 0;
      let idx = gap > 0 ? Math.round((x - PAD_X) / gap) : 0;
      if (idx < 0) idx = 0;
      if (idx > n - 1) idx = n - 1;
      return idx;
    };
    const move = (x: number) => {
      "worklet";
      if (n === 0) return;
      const idx = snap(x);
      const gap = n > 1 ? (widthSV.value - PAD_X * 2) / (n - 1) : 0;
      crosshairX.value = withTiming(n > 1 ? PAD_X + idx * gap : widthSV.value / 2, { duration: 90 });
      if (idx !== lastIdx.value) {
        lastIdx.value = idx;
        runOnJS(setActive)(idx);
      }
    };

    const pan = Gesture.Pan()
      .activeOffsetX([-8, 8])
      .onBegin((e) => move(e.x))
      .onUpdate((e) => move(e.x));

    const tap = Gesture.Tap()
      .maxDistance(14)
      .onEnd((e) => {
        if (n === 0) return;
        runOnJS(openMovie)(snap(e.x));
      });

    return Gesture.Race(pan, tap);
  }, [n, openMovie]);

  const crosshairStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: crosshairX.value }],
  }));

  // The readout follows the crosshair horizontally, clamped so it never spills past
  // the chart edges.
  const calloutStyle = useAnimatedStyle(() => {
    const w = widthSV.value || 1;
    const half = CALLOUT_W / 2;
    let cx = crosshairX.value;
    if (cx < half) cx = half;
    if (cx > w - half) cx = w - half;
    return { transform: [{ translateX: cx - half }] };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    widthSV.value = w;
  };

  const activePoint = active != null ? points[active] : null;
  const hasData = (cashCowMovies?.length || 0) + (moneyPitMovies?.length || 0) > 0;
  // Crosshair + marker take on the selected point's colour (green cash cow, red pit).
  const accentForActive = activePoint ? (activePoint.gain ? GAIN : LOSS) : ACCENT;

  return (
    <BlurView
      intensity={28}
      tint="dark"
      experimentalBlurMethod="dimezisBlurView"
      style={styles.card}
    >
      {/* TOP: chart title + key only */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconCircle}>
            <Ionicons name="stats-chart" size={14} color={ACCENT} />
          </View>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: GAIN }]} />
          <Text style={styles.legendText}>Cash cows</Text>
          <View style={[styles.legendDot, { backgroundColor: LOSS, marginLeft: 10 }]} />
          <Text style={styles.legendText}>Money pits</Text>
        </View>
      </View>

      {/* CHART */}
      <GestureDetector gesture={gesture}>
        <View style={styles.chart} onLayout={onLayout}>
          {width > 0 && (
            <Svg width={width} height={CHART_H} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                {/* Fill + stroke flip colour exactly at the zero line (its 50% offset). */}
                <LinearGradient id="boFill" x1="0" y1="0" x2="0" y2={CHART_H} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={GAIN} stopOpacity={0.4} />
                  <Stop offset="0.5" stopColor={GAIN} stopOpacity={0.04} />
                  <Stop offset="0.5" stopColor={LOSS} stopOpacity={0.04} />
                  <Stop offset="1" stopColor={LOSS} stopOpacity={0.4} />
                </LinearGradient>
                <LinearGradient id="boStroke" x1="0" y1="0" x2="0" y2={CHART_H} gradientUnits="userSpaceOnUse">
                  <Stop offset="0.5" stopColor={GAIN} />
                  <Stop offset="0.5" stopColor={LOSS} />
                </LinearGradient>
              </Defs>

              {/* faint gridlines + break-even line */}
              <Line x1={0} y1={HALF * 0.5} x2={width} y2={HALF * 0.5} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <Line x1={0} y1={HALF * 1.5} x2={width} y2={HALF * 1.5} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <Line x1={0} y1={HALF} x2={width} y2={HALF} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />

              {areaPath ? <Path d={areaPath} fill="url(#boFill)" /> : null}
              {linePath ? (
                <Path d={linePath} stroke="url(#boStroke)" strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              ) : null}

              {/* active marker on the curve */}
              {activePoint && (
                <>
                  <Circle cx={activePoint.x} cy={activePoint.y} r={11} fill={accentForActive} opacity={0.22} />
                  <Circle cx={activePoint.x} cy={activePoint.y} r={5} fill={accentForActive} stroke="#fff" strokeWidth={1.5} />
                </>
              )}
            </Svg>
          )}

          {hasData && (
            <Animated.View
              pointerEvents="none"
              style={[styles.crosshair, crosshairStyle, { backgroundColor: accentForActive }]}
            />
          )}

          {/* Floating readout — pinned to the top band, tracks the crosshair, stays
              above the scrubbing thumb. pointerEvents none so taps reach the chart. */}
          {activePoint && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.callout,
                calloutStyle,
                { borderColor: activePoint.gain ? "rgba(70,210,154,0.45)" : "rgba(233,106,103,0.45)" },
              ]}
            >
              <Text style={styles.calloutTitle} numberOfLines={1}>
                {activePoint.title}
              </Text>
              <View style={styles.calloutMeta}>
                <Text style={styles.calloutDate}>{fmtDate(activePoint.date)}</Text>
                <Text style={styles.calloutSep}>·</Text>
                <Text style={[styles.calloutProfit, { color: activePoint.gain ? GAIN : LOSS }]}>
                  {fmtMoney(activePoint.profit)}
                </Text>
              </View>
            </Animated.View>
          )}
        </View>
      </GestureDetector>

      {n > 1 && (
        <View style={styles.axisRow}>
          <Text style={styles.axisLabel}>{fmtAxis(points[0].date)}</Text>
          <Text style={styles.axisLabel}>{fmtAxis(points[n - 1].date)}</Text>
        </View>
      )}
    </BlurView>
  );
};

export default BoxOfficeChart;

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(18,20,26,0.4)",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  iconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(156,202,223,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  title: { color: "#fff", fontSize: 17, fontWeight: "800" },
  legend: { flexDirection: "row", alignItems: "center" },
  legendDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  legendText: { color: "rgba(255,255,255,0.5)", fontSize: 10.5, fontWeight: "600" },
  chart: { height: CHART_H, position: "relative" },
  crosshair: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 2,
    height: CHART_H,
    opacity: 0.5,
  },
  callout: {
    position: "absolute",
    top: 4,
    left: 0,
    width: CALLOUT_W,
    backgroundColor: "rgba(20,22,28,0.92)",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  calloutTitle: { color: "#fff", fontSize: 13, fontWeight: "700", textAlign: "center" },
  calloutMeta: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  calloutDate: { color: "rgba(255,255,255,0.5)", fontSize: 11.5 },
  calloutSep: { color: "rgba(255,255,255,0.3)", fontSize: 11.5, marginHorizontal: 5 },
  calloutProfit: { fontSize: 13, fontWeight: "800" },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: PAD_X,
  },
  axisLabel: { color: "rgba(255,255,255,0.35)", fontSize: 11 },
});
