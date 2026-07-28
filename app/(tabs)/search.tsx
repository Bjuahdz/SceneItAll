import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Link } from "expo-router";

import { fetchMovies } from "@/services/api";
import { useSearchIsland } from "@/contexts/SearchIslandContext";

// The dedicated search page. It does exactly one job: show the films you typed.
// The old implementation was a pop-up bolted onto the Discover browse page; that
// page is now Discover proper (app/(tabs)/discover.tsx) and this is a real
// destination reached from the nav's search satellite.
//
// The input is NOT here — it lives in the nav's search satellite, which expands
// in place while the pill collapses to the tab you came from. This page only
// reads the query and renders what matches.

const ACCENT = "#9ccadf";
const H_PAD = 16;
const GAP = 12;
const { width: SCREEN_W } = Dimensions.get("window");
const CELL_W = (SCREEN_W - H_PAD * 2 - GAP * 2) / 3;
const NAV_CLEARANCE = 120;
const PLACEHOLDER = "https://placehold.co/600x900/1a1a1a/FFFFFF.png";

type Result = {
  id: number;
  title: string;
  poster_path: string | null;
  release_date?: string;
  vote_average?: number;
};

function ResultCell({ movie }: { movie: Result }) {
  const uri = movie.poster_path
    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
    : PLACEHOLDER;
  const year = movie.release_date ? movie.release_date.slice(0, 4) : "";
  return (
    <Link href={`/movie/${movie.id}`} asChild>
      <Pressable style={styles.cell} accessibilityRole="button">
        <View style={styles.posterWrap}>
          <Image source={{ uri }} style={styles.poster} contentFit="cover" transition={180} />
        </View>
        <Text numberOfLines={1} style={styles.cellTitle}>
          {movie.title}
        </Text>
        {year ? <Text style={styles.cellYear}>{year}</Text> : null}
      </Pressable>
    </Link>
  );
}

export default function SearchScreen() {
  const { query } = useSearchIsland();
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length === 0) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    // Debounced so a fast typist fires one request, not one per keystroke.
    const t = setTimeout(async () => {
      try {
        const rows = await fetchMovies({ query: trimmed });
        if (!alive) return;
        setResults(rows ?? []);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setResults([]);
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (alive) setLoading(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [trimmed]);

  const empty = useMemo(() => {
    if (loading) return null;
    if (error) return error;
    if (trimmed.length === 0) return "Type a title to search.";
    return `No films matching “${trimmed}”.`;
  }, [loading, error, trimmed]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <FlatList
        data={results}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => <ResultCell movie={item} />}
        numColumns={3}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.spinner} color={ACCENT} />
          ) : (
            <Text style={styles.empty}>{empty}</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b0f" },
  list: { paddingHorizontal: H_PAD, paddingTop: 18, paddingBottom: NAV_CLEARANCE },
  row: { gap: GAP, marginBottom: 18 },
  cell: { width: CELL_W },
  posterWrap: {
    width: CELL_W,
    height: CELL_W * 1.5,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  poster: { width: "100%", height: "100%" },
  cellTitle: { color: "#fff", fontSize: 12, fontWeight: "600", marginTop: 6 },
  cellYear: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 1 },
  spinner: { marginTop: 40 },
  empty: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
    paddingHorizontal: 24,
  },
});
