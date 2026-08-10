// ─────────────────────────────────────────────────────────────────────────────
// QUICK SEARCHES — compose's dead air earns its keep.
//
// The Q3 board, CHOSEN 2026-08-08 ("simple, straight to the point, and it serves
// its purpose"). Three left-hugging cards above the island while the field is
// focused and EMPTY: today's trending films, each one a pre-typed query.
//
// ▸ A TAP RUNS THE SEARCH — never "open the movie". The card fills the field and
//   submits through the exact path the keyboard's Search key takes, so it costs
//   precisely what a typed query costs and lands on the results list (FILMS
//   default). The loupe at each card's tail is the glyph that says so.
//
// ▸ COMPOSE ONLY. The screen mounts this solely while `composing`; the first
//   keystroke unmounts it and the typing ladder takes over. It never appears on
//   the resting board — the Discover ruling stands: trending never fills the
//   recents surface.
//
// ▸ NOTHING OR CARDS, NEVER A SPINNER. Until the one cached trending request
//   resolves (see quickTrending — one request per app session), compose is
//   exactly the blank it was before this existed. A failed fetch means it stays
//   that way, silently.
//
// ▸ WHERE IT SITS. The island rides the keyboard at `kbH + KB_GAP` off the
//   screen bottom (the nav's lift), and is NAV_BAR_H tall — so the stack anchors
//   14 above that, off the same shared constants. Every other number is the Q3
//   board read with get_computed_styles; type runs one step up from the board
//   (14→15, 9→10) per the navMetrics lesson: Paper at 1:1 flatters micro type.
// ─────────────────────────────────────────────────────────────────────────────
import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  SlideInLeft,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { KB_GAP, NAV_BAR_H } from "@/constants/navMetrics";
import { FONT, ROW, SEARCH_LAYOUT, SIGNAL } from "@/constants/signal";
import { quickTrending, type QuickTrend } from "@/services/search";

import { Loupe } from "./glyphs";

/** Air between the stack and the island below it — the board's 14. */
const GAP_ABOVE_ISLAND = 14;

/* ── THE ENTRANCE — Bryan, 2026-08-08: "once the keyboard and the search field
   have come up... the three pills appear from bottom to top in a very fluid,
   smooth way."

   ▸ AFTER the keyboard settles, never during its ride. The render gate below
   waits for `keyboardDidShow`, so the cards' choreography starts on the frame
   the OS animation ends — two motions in sequence, not two fighting.

   ▸ BOTTOM TO TOP, each card sliding in from the LEFT EDGE on the nav morph's
   own spring ({damping 31, stiffness 350, mass 1} — lifted, not re-tuned; the
   same numbers already define "fluid, non-bouncy" everywhere else). The stagger
   is one beat between take-offs, and the header fades in last, as the sweep
   arrives at the top.

   ▸ THE EXIT IS JUST A FADE. It went choreographed unwind → simultaneous slide
   → this, in one device session (Bryan: "we really only care about the
   entrance, not really the unwind"). The lesson those three rounds bought: the
   entrance can afford choreography because nothing is waiting on it; the exit
   is ALWAYS in something's way — the ladder, or a keyboard already leaving —
   so it gets the cheapest move that exists. */
const ENTER_SPRING = { damping: 31, stiffness: 350, mass: 1 };
const ENTER_STAGGER_MS = 70;
const EXIT_MS = 100;

export default function QuickSearches({ onPick }: { onPick: (title: string) => void }) {
  const [rows, setRows] = useState<QuickTrend[] | null>(null);
  /**
   * Seeded from the live keyboard, not from 0: on iOS `keyboardWillShow` is what
   * flips `composing` true, so this component mounts AFTER that event has fired
   * and a listener added here would have missed it. `metrics()` replays the last
   * event's end frame. The listeners below then cover every later change,
   * including Android, where only `keyboardDidShow` exists.
   */
  const [kbHeight, setKbHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  /**
   * "The keyboard's ride is over" — what the entrance waits for. Seeded from
   * `isVisible()` for the one path with no coming event: backspacing to an empty
   * field remounts this component under a keyboard that is ALREADY up and settled,
   * so `didShow` will never re-fire. (`isVisible` flips on `didShow`, so a cold
   * first session correctly seeds false and waits.)
   */
  const [settled, setSettled] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    // ⚠ `keyboardDidShow` IS THE LOAD-BEARING ONE. On the FIRST keyboard session
    // of an app launch this component mounts after `keyboardWillShow` has already
    // fired (that event is what flips `composing` true) and before `didShow` —
    // and on a cold keyboard `Keyboard.metrics()` above is still empty. A
    // will-only subscription therefore never learned the height and the stack
    // stayed null exactly once per launch: blank on the first tap, fine on every
    // later one (Bryan, device, 2026-08-08). `didShow` always fires AFTER mount
    // in that race, so it is the guaranteed catch-up; `willShow` stays because it
    // is earlier on every warm session.
    const listeners = [
      Keyboard.addListener("keyboardDidShow", (e) => {
        setKbHeight(e.endCoordinates.height);
        setSettled(true);
      }),
    ];
    if (Platform.OS === "ios") {
      listeners.push(
        Keyboard.addListener("keyboardWillShow", (e) => setKbHeight(e.endCoordinates.height))
      );
    }
    return () => listeners.forEach((l) => l.remove());
  }, []);

  useEffect(() => {
    let mounted = true;
    quickTrending().then((r) => {
      if (mounted) setRows(r);
    });
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * ▸ THE EXIT RUNS ON THE UI THREAD, NOT ON REACT'S CLOCK — the fix for "still
   * really delayed" (Bryan, device, 2026-08-08, second round).
   *
   * When the keyboard starts leaving, the SAME React commit that unmounts this
   * component also MOUNTS THE ENTIRE RECENTS BOARD — 44 tiles, images, worklets.
   * Any unmount-driven exit (root `exiting` included) is queued behind that
   * build, so the cards sat at full opacity over the returned board for however
   * long the commit took. His screenshots even catch the masthead still reading
   * SEARCH with the keyboard fully down: the whole screen was waiting on one
   * heavy commit.
   *
   * So the fade is a shared value written straight from the keyboard listener:
   * it starts the frame `keyboardWillHide` fires, whatever the JS thread is
   * busy with.
   *
   * ⚠ AND THERE IS NO `exiting` ON THE ROOT ANY MORE. FadeOut does not fade from
   * the view's current opacity — its initialValues RESET it to 1 — so when the
   * delayed unmount finally landed it snapped the already-invisible stack back
   * to full opacity for its own 100ms fade: gone, FLASH, gone again (Bryan,
   * device, 2026-08-08, third round). One exit mechanism, not two: the shared
   * value fades, the unmount just removes what is already invisible. The typing
   * path therefore removes instantly, which is fine by the standing ruling —
   * "we really only care about the entrance" — and the ladder is taking the
   * screen in that same commit anyway.
   */
  const leaving = useSharedValue(0);
  useEffect(() => {
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hide = Keyboard.addListener(hideEvt, () => {
      leaving.value = withTiming(1, { duration: EXIT_MS });
    });
    // A keyboard that comes straight back (focus bounced) must bring the cards
    // back with it rather than leaving them at zero under a live compose.
    const show = Keyboard.addListener(showEvt, () => {
      leaving.value = 0;
    });
    return () => {
      hide.remove();
      show.remove();
    };
  }, [leaving]);
  const leaveStyle = useAnimatedStyle(() => ({ opacity: 1 - leaving.value }));

  // No data yet (or none at all), the keyboard's frame still unknown, or its ride
  // still running — render nothing. This is an overlay, not the ScrollView's
  // anchor child, so `null` is safe here in a way it is not in ComposeState.
  // The `settled` gate is what makes the choreography START at the frame the
  // keyboard's own animation ends instead of running underneath it.
  if (!rows || rows.length === 0 || kbHeight === 0 || !settled) return null;

  const n = rows.length;
  return (
    // ⚠ NO `exiting` ANYWHERE IN THIS TREE — the exit is `leaveStyle`, above.
    // The history, so nobody re-adds one: per-child exiting orphaned frozen
    // snapshots on Fabric (cards parked over the board forever); root exiting
    // waited out the board-mount commit AND FadeOut reset the already-faded
    // stack to opacity 1 for its own ramp — the gone-FLASH-gone. Children carry
    // `entering` only; removal is instant because the view is invisible by then.
    <Animated.View
      style={[
        styles.stack,
        { bottom: kbHeight + KB_GAP + NAV_BAR_H + GAP_ABOVE_ISLAND },
        leaveStyle,
      ]}
    >
      {/* The header resolves LAST on the way in — the bottom-to-top sweep arrives
          at the top and the label caps it. */}
      <Animated.View
        entering={FadeIn.delay(n * ENTER_STAGGER_MS).duration(180)}
        style={styles.header}
      >
        <Text style={styles.headerLabel}>TRENDING</Text>
        <Text style={styles.headerCount}>{String(n).padStart(2, "0")}</Text>
      </Animated.View>
      {rows.map((r, i) => (
        <Animated.View
          key={r.id}
          // Bottom card takes off first: index n-1 gets delay 0, the top card the
          // longest — the stack builds upward. The spring is the nav morph's.
          entering={SlideInLeft.delay((n - 1 - i) * ENTER_STAGGER_MS)
            .springify()
            .damping(ENTER_SPRING.damping)
            .stiffness(ENTER_SPRING.stiffness)
            .mass(ENTER_SPRING.mass)}
          style={styles.cardSlot}
        >
          <Pressable
            style={styles.card}
            onPress={() => onPick(r.title)}
            accessibilityRole="button"
            accessibilityLabel={`Search for ${r.title}`}
          >
            <Image
              source={{ uri: `https://image.tmdb.org/t/p/w92${r.posterPath}` }}
              style={styles.thumb}
              contentFit="cover"
              transition={120}
            />
            <View style={styles.textCol}>
              <Text style={styles.title} numberOfLines={1}>
                {r.title.toUpperCase()}
              </Text>
              <Text style={styles.meta}>{r.year ? `FILM · ${r.year}` : "FILM"}</Text>
            </View>
            <Loupe />
          </Pressable>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** Left+right set so long titles have a ceiling to ellipsize against, but the
   *  CARDS hug their content — `alignItems: flex-start` is the ragged right edge
   *  Bryan asked for ("all on the left side"). */
  stack: {
    position: "absolute",
    left: SEARCH_LAYOUT.padH,
    right: SEARCH_LAYOUT.padH,
    alignItems: "flex-start",
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingBottom: 4,
  },
  headerLabel: {
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.2, // 0.12em at 10px
    color: SIGNAL.muted,
  },
  headerCount: {
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.2,
    color: ROW.indexDim,
  },
  /** The animated wrapper — carries the entrance/exit so the Pressable inside
   *  keeps a plain style. maxWidth mirrors the card's, so the ellipsis ceiling
   *  survives the extra layer. */
  cardSlot: {
    maxWidth: "100%",
  },
  /** The Q3 card: surface fill, r14, pad 8 16 8 8, one gap of 12 spacing all. */
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 16,
    backgroundColor: SIGNAL.surface,
    borderRadius: 14,
    maxWidth: "100%",
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 9,
  },
  textCol: {
    flexShrink: 1,
    gap: 3,
  },
  title: {
    fontFamily: FONT.display,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: -0.15, // -0.01em at 15px
    color: SIGNAL.ink,
  },
  meta: {
    fontFamily: FONT.mono,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.0, // 0.1em at 10px
    color: SIGNAL.muted,
  },
});
