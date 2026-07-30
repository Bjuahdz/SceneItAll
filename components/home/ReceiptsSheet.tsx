import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from "react-native";
import { BlurView } from "expo-blur";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import type { ArcMoment } from "@/services/fingerprint";
import type { Take } from "@/services/db";
import { agoShort } from "./skyModel";

const RECEIPTS_LABEL = "IN YOUR OWN WORDS";

// ─────────────────────────────────────────────────────────────────────────────
// Module E — receipts. The one detail view Home owns: an arc's text VERBATIM
// plus the user's own words on both sides of the connection.
//
// Display contracts: insight text is never paraphrased or truncated; any take
// flagged is_spoiler is masked here (tap to reveal) because its words are
// appearing outside their own movie's context.
// ─────────────────────────────────────────────────────────────────────────────

const posterUri = (path: string | null) =>
  path
    ? `https://image.tmdb.org/t/p/w185${path}`
    : "https://placehold.co/185x278/12101c/FFFFFF.png";

const ReceiptRow = ({ take }: { take: Take }) => {
  const [revealed, setRevealed] = useState(false);
  const spoiler = take.is_spoiler === 1;
  const words = take.summary ?? take.transcript ?? "Still distilling…";
  const masked = spoiler && !revealed;

  return (
    <View style={styles.receipt}>
      <ExpoImage
        source={{ uri: posterUri(take.poster_path) }}
        style={styles.receiptPoster}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
      />
      <View style={styles.receiptBody}>
        <Text style={styles.receiptTitle} numberOfLines={1}>
          {take.movie_title}
        </Text>
        <Text style={styles.receiptAgo}>{agoShort(take.created_at)}</Text>
        {masked ? (
          <Pressable
            onPress={() => setRevealed(true)}
            style={styles.spoilerMask}
            accessibilityRole="button"
            accessibilityLabel="Reveal spoiler"
          >
            <Ionicons name="eye-off-outline" size={11} color="rgba(255,255,255,0.55)" />
            <Text style={styles.spoilerText}>SPOILER · TAP TO REVEAL</Text>
          </Pressable>
        ) : (
          <Text style={styles.receiptWords}>{words}</Text>
        )}
      </View>
    </View>
  );
};

interface ReceiptsSheetProps {
  arc: ArcMoment | null;
  takes: Take[];
  visible: boolean;
  onClose: () => void;
}

export default function ReceiptsSheet({ arc, takes, visible, onClose }: ReceiptsSheetProps) {
  const insets = useSafeAreaInsets();

  const related = useMemo(() => {
    if (!arc) return [];
    const byId = new Map(takes.map((t) => [t.id, t]));
    const ids = [arc.takeId, ...arc.relatedTakeIds];
    return ids.map((id) => byId.get(id)).filter((t): t is Take => !!t);
  }, [arc, takes]);

  if (!arc) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View entering={FadeIn.duration(220)} style={StyleSheet.absoluteFill}>
          <BlurView intensity={26} tint="dark" style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Pressable>

      <Animated.View
        entering={FadeInDown.duration(420)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 22 }]}
      >
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.kicker}>
            {(arc.arcType ?? "connection").toUpperCase()}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close receipts"
          >
            <Ionicons name="close" size={18} color="rgba(255,255,255,0.6)" />
          </Pressable>
        </View>

        {/* The arc, verbatim — never re-summarized */}
        <Text style={styles.arcText}>{arc.text}</Text>

        <Text style={styles.receiptsLabel}>{RECEIPTS_LABEL}</Text>
        <ScrollView
          style={styles.receiptsScroll}
          contentContainerStyle={styles.receiptsList}
          showsVerticalScrollIndicator={false}
        >
          {related.map((t) => (
            <ReceiptRow key={`receipt-${t.id}`} take={t} />
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,1,12,0.55)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "78%",
    backgroundColor: "rgba(12,10,26,0.97)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.16)",
    marginBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kicker: {
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 2,
    color: "rgba(156,202,223,0.85)",
  },
  arcText: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  receiptsLabel: {
    fontSize: 7,
    fontWeight: "800",
    letterSpacing: 2,
    color: "rgba(255,255,255,0.34)",
    marginTop: 20,
    marginBottom: 10,
  },
  receiptsScroll: {
    flexGrow: 0,
  },
  receiptsList: {
    gap: 14,
    paddingBottom: 6,
  },
  receipt: {
    flexDirection: "row",
    gap: 12,
  },
  receiptPoster: {
    width: 42,
    height: 63,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  receiptBody: {
    flex: 1,
    minWidth: 0,
  },
  receiptTitle: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12.5,
    fontWeight: "700",
  },
  receiptAgo: {
    color: "rgba(255,255,255,0.38)",
    fontSize: 9,
    marginTop: 1,
  },
  receiptWords: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 5,
  },
  spoilerMask: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    alignSelf: "flex-start",
  },
  spoilerText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 7.5,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
});
