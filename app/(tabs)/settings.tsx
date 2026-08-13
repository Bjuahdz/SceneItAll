import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { deleteAllTakes, getTakes } from "@/services/db";
import { emitChanged } from "@/services/enrichment";
import {
  PREF_ANCHOR_GUIDE,
  PREF_ANCHOR_SKYLINE,
  PREF_LAND_HAPTICS,
  PREF_DEMO_ARRIVALS,
  PREF_DEMO_ARRIVAL_MAX,
  PREF_MIC_USED,
  PREF_SHOW_DOCS,
  PREF_SHOW_SHORTS,
  PREF_SKIP_COUNTDOWN,
  getBoolPref,
  getNumPref,
  setBoolPref,
  setNumPref,
} from "@/services/prefs";
import { useBoolPref } from "@/hooks/useBoolPref";
import { useFavorites } from "@/contexts/FavoritesContext";
import { useRecentSearches } from "@/contexts/RecentSearchesContext";
import { INK_RED, TICKET_ACCENT, ink } from "@/components/moviedetails/ticketTheme";

// DEV PANEL — not a product settings screen. This exists so the app can be put
// back to a blank slate while the Home / movie-detail surfaces are still being
// designed against real data. Everything here is destructive and unguarded by
// design; when this becomes a real Settings screen these rows move behind a
// build-time dev flag or leave entirely.

// Clears the floating nav pill, which sits ~64px tall above the safe area.
const NAV_CLEARANCE = 120;

function Row({
  icon,
  label,
  detail,
  danger,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string;
  danger?: boolean;
  busy?: boolean;
  onPress?: () => void;
}) {
  const tint = danger ? INK_RED : ink(0.9);
  // Touchables stay bare wrappers with all visuals on an inner View — style
  // functions on Pressable/Touchable silently drop on device in this app.
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} disabled={!onPress || busy}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={19} color={tint} />
        </View>
        <Text style={[styles.rowLabel, danger && { color: INK_RED }]}>{label}</Text>
        {busy ? (
          <ActivityIndicator size="small" color={tint} />
        ) : detail !== undefined ? (
          <Text style={styles.rowDetail}>{detail}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

/** A row whose trailing control is a switch — the label is not itself pressable. */
function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={19} color={ink(0.9)} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      {/* Fixed 51×31 slot. Left to size itself the iOS Switch takes a layout box taller
          than the control it actually draws, so it paints at the top of the box and the
          row's alignItems has nothing to centre. Pinning the box to UISwitch's real size
          makes it sit on the label's centre line. */}
      <View style={styles.switchSlot}>
        <Switch
          style={styles.switch}
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: "rgba(255,255,255,0.16)", true: TICKET_ACCENT }}
          thumbColor="#fff"
          ios_backgroundColor="rgba(255,255,255,0.16)"
        />
      </View>
    </View>
  );
}

/**
 * A two-mode segment row — for settings that are a CHOICE between equal presentations
 * rather than a feature being on or off. Same boolean pref underneath; the row just
 * stops pretending one mode is the absence of the other.
 */
function SegmentRow({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={19} color={ink(0.9)} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.segmentWrap}>
        {options.map((o) => (
          <TouchableOpacity key={o.key} onPress={() => onChange(o.key)} activeOpacity={0.7}>
            <View style={[styles.segment, value === o.key && styles.segmentOn]}>
              <Text style={[styles.segmentText, value === o.key && styles.segmentTextOn]}>
                {o.label}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/**
 * A bare-hands slider — `@react-native-community/slider` is not a dependency and one
 * dev-panel control does not earn one. The track is a responder view: it CLAIMS the
 * touch at grant and refuses termination, which is what keeps a horizontal drag from
 * being stolen by the ScrollView it lives in. Integer snapping makes locationX
 * precision irrelevant.
 */
function SliderRow({
  icon,
  label,
  min,
  max,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  min: number;
  max: number;
  value: number;
  onValueChange: (v: number) => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const THUMB = 18;
  const travel = Math.max(0, trackW - THUMB);
  const t = (value - min) / (max - min);
  const fromX = (x: number) => {
    if (trackW <= 0) return;
    const f = Math.max(0, Math.min(1, x / trackW));
    onValueChange(Math.round(min + f * (max - min)));
  };
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={19} color={ink(0.9)} />
        </View>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDetail}>{value}</Text>
      </View>
      <View
        style={styles.sliderHit}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => fromX(e.nativeEvent.locationX)}
        onResponderMove={(e) => fromX(e.nativeEvent.locationX)}
      >
        <View style={styles.sliderTrack} />
        <View style={[styles.sliderFill, { width: t * travel + THUMB / 2 }]} />
        <View style={[styles.sliderThumb, { left: t * travel }]} />
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const [takeCount, setTakeCount] = useState<number | null>(null);
  const [wiping, setWiping] = useState(false);
  const [clearingList, setClearingList] = useState(false);
  const [clearingRecents, setClearingRecents] = useState(false);
  const [skipCountdown, setSkipCountdown] = useState(() => getBoolPref(PREF_SKIP_COUNTDOWN));
  // These two read through useBoolPref rather than the local-state-plus-focus-refresh
  // pattern above, because the same hook is what makes an open person page react to the
  // flip. One subscription, both ends.
  const showShorts = useBoolPref(PREF_SHOW_SHORTS, true);
  const showDocs = useBoolPref(PREF_SHOW_DOCS, true);
  const demoArrivals = useBoolPref(PREF_DEMO_ARRIVALS, false);
  const anchorSkyline = useBoolPref(PREF_ANCHOR_SKYLINE, false);
  const anchorGuide = useBoolPref(PREF_ANCHOR_GUIDE, false);
  const landHaptics = useBoolPref(PREF_LAND_HAPTICS, false);
  /**
   * LOCAL until Apply — the whole point of the button is that dragging around to
   * explore numbers commits nothing. Only Apply writes the pref the seeder reads.
   */
  const [demoMax, setDemoMax] = useState(() => getNumPref(PREF_DEMO_ARRIVAL_MAX, 30));
  const [demoMaxApplied, setDemoMaxApplied] = useState<number | null>(null);
  const demoMaxToast = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (demoMaxToast.current && clearTimeout(demoMaxToast.current)), []);
  const applyDemoMax = useCallback(() => {
    setNumPref(PREF_DEMO_ARRIVAL_MAX, demoMax);
    // The toast, at its simplest: a line of text that names the number it saved and
    // leaves on its own. Reapplying restarts the clock.
    setDemoMaxApplied(demoMax);
    if (demoMaxToast.current) clearTimeout(demoMaxToast.current);
    demoMaxToast.current = setTimeout(() => setDemoMaxApplied(null), 1800);
  }, [demoMax]);
  const { favorites, clearFavorites } = useFavorites();
  // Goes through the context rather than straight to the DB so an open Search tab
  // repaints as the new-account state instead of holding rows that no longer exist.
  const { recents, clearRecents } = useRecentSearches();
  // Rows written before the `hits` column existed default to 1, which is the honest
  // floor — we know they were searched at least once.
  const totalHits = recents.reduce((sum, r) => sum + (r.hits ?? 1), 0);
  // Distinct sittings at the search field. Rows written before R2 carry no session
  // and are not counted — there is no honest one to reconstruct for them.
  const sessionCount = new Set(
    recents.map((r) => r.session_id).filter((id): id is number => id != null)
  ).size;

  const refresh = useCallback(() => {
    let alive = true;
    getTakes()
      .then((rows) => {
        if (alive) setTakeCount(rows.length);
      })
      .catch(() => {
        if (alive) setTakeCount(null);
      });
    // Prefs load asynchronously at the root, so re-read on focus — the first mount can
    // land before the cache is filled.
    if (alive) setSkipCountdown(getBoolPref(PREF_SKIP_COUNTDOWN));
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(refresh);

  const confirmWipe = useCallback(() => {
    const n = takeCount ?? 0;
    if (n === 0) {
      Alert.alert("Nothing to delete", "There are no takes on this device.");
      return;
    }
    Alert.alert(
      "Delete all takes?",
      `This permanently removes ${n} take${n === 1 ? "" : "s"}, their transcripts, insights and audio files. Your slate is not touched. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: async () => {
            setWiping(true);
            try {
              const removed = await deleteAllTakes();
              // Wake every open entries list / star / progress bar so the app
              // repaints as empty instead of holding stale rows.
              emitChanged();
              setTakeCount(0);
              Alert.alert("Blank slate", `Deleted ${removed} take${removed === 1 ? "" : "s"}.`);
            } catch (e) {
              Alert.alert("Delete failed", e instanceof Error ? e.message : String(e));
            } finally {
              setWiping(false);
            }
          },
        },
      ]
    );
  }, [takeCount]);

  const confirmClearList = useCallback(() => {
    const n = favorites.length;
    if (n === 0) {
      Alert.alert("Nothing to delete", "There is nothing on your slate.");
      return;
    }
    Alert.alert(
      "Clear your slate?",
      `This removes ${n} slated title${n === 1 ? "" : "s"}. Your takes are not touched. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear all",
          style: "destructive",
          onPress: async () => {
            setClearingList(true);
            try {
              const removed = await clearFavorites();
              Alert.alert("Slate cleared", `Removed ${removed} title${removed === 1 ? "" : "s"}.`);
            } catch (e) {
              Alert.alert("Clear failed", e instanceof Error ? e.message : String(e));
            } finally {
              setClearingList(false);
            }
          },
        },
      ]
    );
  }, [favorites.length, clearFavorites]);

  /**
   * Blank-slate the Search tab's recents ledger.
   *
   * Exists for the RECENT BOARD build: the skyline packer's output depends entirely
   * on the ORDER and SHAPE of what you searched, so testing it means getting back to
   * an empty board and typing a specific sequence. Without this the only way to reset
   * was reinstalling the app.
   */
  const confirmClearRecents = useCallback(() => {
    const n = recents.length;
    if (n === 0) {
      Alert.alert("Nothing to delete", "There are no recent searches on this device.");
      return;
    }
    Alert.alert(
      "Clear search history?",
      `This removes ${n} recent search${n === 1 ? "" : "es"}. Your takes and your slate are not touched. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear all",
          style: "destructive",
          onPress: async () => {
            setClearingRecents(true);
            try {
              const removed = await clearRecents();
              Alert.alert(
                "History cleared",
                `Removed ${removed} search${removed === 1 ? "" : "es"}.`
              );
            } catch (e) {
              Alert.alert("Clear failed", e instanceof Error ? e.message : String(e));
            } finally {
              setClearingRecents(false);
            }
          },
        },
      ]
    );
  }, [recents.length, clearRecents]);

  const toggleCountdown = useCallback((v: boolean) => {
    setSkipCountdown(v); // optimistic — the cache is written through synchronously
    setBoolPref(PREF_SKIP_COUNTDOWN, v);
  }, []);

  // The capture disc's beat retires on the first tap and never comes back, which makes it
  // a one-shot to review. This puts it back.
  const replayMicHint = useCallback(async () => {
    await setBoolPref(PREF_MIC_USED, false);
    Alert.alert("Hint restored", "The mic will beat again next time you open a film.");
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        <Text style={styles.sectionLabel}>DEVELOPER</Text>
        <View style={styles.card}>
          <Row
            icon="mic-outline"
            label="Takes on device"
            detail={takeCount === null ? "—" : String(takeCount)}
          />
          <View style={styles.divider} />
          <Row
            icon="trash-outline"
            label="Delete all takes"
            danger
            busy={wiping}
            onPress={confirmWipe}
          />
        </View>
        <Text style={styles.footnote}>
          Removes every take, transcript, insight and audio file so the app can be seen fresh. Your
          slate is left alone.
        </Text>

        <Text style={[styles.sectionLabel, styles.sectionGap]}>SLATES</Text>
        <View style={styles.card}>
          <Row icon="bookmark-outline" label="Slated titles" detail={String(favorites.length)} />
          <View style={styles.divider} />
          <Row
            icon="trash-outline"
            label="Clear your slate"
            danger
            busy={clearingList}
            onPress={confirmClearList}
          />
        </View>
        <Text style={styles.footnote}>Empties your slate only. Takes are left alone.</Text>

        <Text style={[styles.sectionLabel, styles.sectionGap]}>SEARCH</Text>
        <View style={styles.card}>
          <Row icon="time-outline" label="Recent searches" detail={String(recents.length)} />
          <View style={styles.divider} />
          {/* The only way to SEE `hits` working. Distinct entities vs total searches:
              re-search something you already looked up and the top number holds while
              this one climbs. Without it R1 is an unverifiable increment. */}
          <Row icon="repeat-outline" label="Times searched" detail={String(totalHits)} />
          <View style={styles.divider} />
          {/* The only way to SEE session boundaries, which is the subtle half of R2
              and what the board's span gate reads. Several searches in one sitting
              must land on ONE session; leaving to the board and coming back must
              start another. */}
          <Row icon="layers-outline" label="Search sessions" detail={String(sessionCount)} />
          <View style={styles.divider} />
          <Row
            icon="trash-outline"
            label="Clear search history"
            danger
            busy={clearingRecents}
            onPress={confirmClearRecents}
          />
          <View style={styles.divider} />
          {/* Fakes the SEARCHES, not the animation — 8–11 real entities from the
              archive stamped as one session and pushed through the live pipeline.
              In-memory only; flipping this off returns the real board untouched. */}
          <ToggleRow
            icon="sparkles-outline"
            label="Demo arrivals"
            value={demoArrivals}
            onValueChange={(v) => setBoolPref(PREF_DEMO_ARRIVALS, v)}
          />
          <View style={styles.divider} />
          {/* Two arrival modes, not a feature switch: TOP is the original default —
              page at the top, the board building bottom-up as the rain lands —
              ANCHOR holds the previous skyline at the lift line and lets the user
              scroll up into the fresh session. Same pref as the old toggle. */}
          <SegmentRow
            icon="magnet-outline"
            label="Arrival view"
            value={anchorSkyline ? "anchor" : "top"}
            options={[
              { key: "top", label: "TOP" },
              { key: "anchor", label: "ANCHOR" },
            ]}
            onChange={(k) => setBoolPref(PREF_ANCHOR_SKYLINE, k === "anchor")}
          />
          <View style={styles.divider} />
          {/* One soft tap as each arriving tile settles. Silenced when the Search
              tab is not the one you are looking at. */}
          <ToggleRow
            icon="pulse-outline"
            label="Landing haptics"
            value={landHaptics}
            onValueChange={(v) => setBoolPref(PREF_LAND_HAPTICS, v)}
          />
          <View style={styles.divider} />
          {/* The dashed tuning lines: fixed LIFT line + moving PREV SKYLINE line.
              Anchored correctly, they meet — and the readout names any gap. */}
          <ToggleRow
            icon="remove-outline"
            label="Show anchor guide"
            value={anchorGuide}
            onValueChange={(v) => setBoolPref(PREF_ANCHOR_GUIDE, v)}
          />
          <View style={styles.divider} />
          <SliderRow
            icon="options-outline"
            label="Demo session size"
            min={1}
            max={30}
            value={demoMax}
            onValueChange={setDemoMax}
          />
          <View style={styles.applyRow}>
            {demoMaxApplied !== null && (
              <Text style={styles.applyNote}>
                Applied — next arrivals bring up to {demoMaxApplied}
              </Text>
            )}
            <TouchableOpacity onPress={applyDemoMax} activeOpacity={0.7}>
              <View style={styles.applyBtn}>
                <Text style={styles.applyBtnText}>APPLY</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.footnote}>
          Empties the Search tab&apos;s recents back to the new-account state. Takes and your
          slate are left alone. Built for testing the recents board — the layout depends on the
          exact order you searched things in, so it has to be resettable. Demo arrivals replays
          a fake 8–11 search sitting each time you return to the tab, sampled from your real
          history and never written to it.
        </Text>

        <Text style={[styles.sectionLabel, styles.sectionGap]}>CAPTURE</Text>
        <View style={styles.card}>
          <ToggleRow
            icon="timer-outline"
            label="Skip the 3·2·1 countdown"
            value={skipCountdown}
            onValueChange={toggleCountdown}
          />
          <View style={styles.divider} />
          <Row icon="sparkles-outline" label="Show the mic hint again" onPress={replayMicHint} />
        </View>
        <Text style={styles.footnote}>
          Starts the mic the instant you tap record, with no get-ready. Applies to starting,
          resuming and starting over. Survives a reload.
        </Text>

        <Text style={[styles.sectionLabel, styles.sectionGap]}>PERSON PAGES</Text>
        <View style={styles.card}>
          <ToggleRow
            icon="film-outline"
            label="Show shorts"
            value={showShorts}
            onValueChange={(v) => setBoolPref(PREF_SHOW_SHORTS, v)}
          />
          <View style={styles.divider} />
          <ToggleRow
            icon="documents-outline"
            label="Show documentaries"
            value={showDocs}
            onValueChange={(v) => setBoolPref(PREF_SHOW_DOCS, v)}
          />
        </View>
        <Text style={styles.footnote}>
          A person&apos;s shorts and documentaries sit in their own sections below the features.
          Turn either off to leave it out of the page entirely — the counts under the name follow.
          Collections and studios are not affected.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0b0b0f",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: NAV_CLEARANCE,
  },
  title: {
    color: ink(0.95),
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.4,
    marginBottom: 26,
  },
  sectionLabel: {
    color: ink(0.4),
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    marginBottom: 10,
  },
  sectionGap: {
    marginTop: 30,
  },
  card: {
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    height: 54,
  },
  rowIcon: {
    width: 22,
    alignItems: "center",
  },
  rowLabel: {
    flex: 1,
    color: ink(0.9),
    fontSize: 15,
    fontWeight: "500",
  },
  rowDetail: {
    color: TICKET_ACCENT,
    fontSize: 15,
    fontWeight: "600",
  },
  switchSlot: {
    width: 51, // UISwitch's intrinsic size
    height: 31,
    flexShrink: 0,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  switch: {
    width: 51,
    height: 31,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  footnote: {
    color: ink(0.4),
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  // Tall hit box, thin track: the finger needs 34pt even though the line is 3.
  sliderHit: {
    height: 34,
    justifyContent: "center",
    marginHorizontal: 16,
    marginTop: -8,
  },
  sliderTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: TICKET_ACCENT,
  },
  sliderThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#fff",
  },
  applyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 2,
  },
  applyNote: {
    flex: 1,
    color: ink(0.55),
    fontSize: 12,
  },
  applyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  applyBtnText: {
    color: ink(0.9),
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  segmentWrap: {
    flexDirection: "row",
    gap: 2,
    padding: 2,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  segmentOn: { backgroundColor: TICKET_ACCENT },
  segmentText: {
    color: ink(0.45),
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  segmentTextOn: { color: "#101010" },
});
