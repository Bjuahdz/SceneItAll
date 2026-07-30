import { View, Text, StyleSheet, FlatList, Pressable, Dimensions, ActivityIndicator } from "react-native";
import React, { useMemo } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Link } from "expo-router";

import { useFavorites } from "@/contexts/FavoritesContext";
import { useNavMorph } from "@/contexts/NavMorphContext";
import type { FavoriteMovie } from "@/services/db";

const ACCENT = "#9ccadf";

// 3-column poster grid (fixed cell width so a partial last row stays left-aligned).
const H_PAD = 16;
const GAP = 12;
const { width: SCREEN_W } = Dimensions.get("window");
const CELL_W = (SCREEN_W - H_PAD * 2 - GAP * 2) / 3;
const PLACEHOLDER = "https://placehold.co/600x900/1a1a1a/FFFFFF.png";

function PosterCell({ movie }: { movie: FavoriteMovie }) {
  const uri = movie.poster_path
    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
    : PLACEHOLDER;

  return (
    <Link href={`/movie/${movie.id}`} asChild>
      <Pressable style={styles.cell} accessibilityRole="button">
        <View style={styles.posterWrap}>
          <Image
            source={{ uri }}
            style={styles.poster}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        </View>
        <Text style={styles.cellTitle} numberOfLines={1}>
          {movie.title}
        </Text>
        <Text style={styles.cellYear}>{movie.release_date?.split("-")[0] || ""}</Text>
      </Pressable>
    </Link>
  );
}

const Saved = () => {
  const { favorites, ready } = useFavorites();
  // Nav pill morph: this screen's scroll drives the collapse/expand of the floating nav.
  const { makeScrollHandler } = useNavMorph();
  const navScroll = useMemo(() => makeScrollHandler(), [makeScrollHandler]);

  if (!ready) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={ACCENT} />
        </View>
      </SafeAreaView>
    );
  }

  if (favorites.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="heart-outline" size={48} color={ACCENT} />
          <Text style={styles.emptyTitle}>No saved movies yet</Text>
          <Text style={styles.emptySubtext}>Tap the heart on a movie to save it here</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={favorites}
        keyExtractor={(item) => `saved-${item.id}`}
        renderItem={({ item }) => <PosterCell movie={item} />}
        numColumns={3}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScroll={navScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          // Header held a CameraLogo on the right (a Paper import, removed
          // 2026-07-28 — it was only ever a trial). `header` keeps its
          // space-between so a right-hand element can return without a
          // re-layout; with one child it simply reads left-aligned.
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Saved</Text>
              <Text style={styles.count}>{favorites.length}</Text>
            </View>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    marginTop: 6,
  },
  emptySubtext: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
  },
  count: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 16,
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: H_PAD,
    paddingBottom: 120, // clears the floating nav
  },
  row: {
    gap: GAP,
    marginBottom: 18,
  },
  cell: {
    width: CELL_W,
  },
  posterWrap: {
    width: "100%",
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  poster: {
    width: "100%",
    height: "100%",
  },
  cellTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
  },
  cellYear: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 2,
  },
});

export default Saved;
