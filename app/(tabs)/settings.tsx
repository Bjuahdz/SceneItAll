import React, { useCallback, useState } from "react";
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
import { PREF_MIC_USED, PREF_SKIP_COUNTDOWN, getBoolPref, setBoolPref } from "@/services/prefs";
import { useFavorites } from "@/contexts/FavoritesContext";
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

export default function SettingsScreen() {
  const [takeCount, setTakeCount] = useState<number | null>(null);
  const [wiping, setWiping] = useState(false);
  const [clearingList, setClearingList] = useState(false);
  const [skipCountdown, setSkipCountdown] = useState(() => getBoolPref(PREF_SKIP_COUNTDOWN));
  const { favorites, clearFavorites } = useFavorites();

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
});
