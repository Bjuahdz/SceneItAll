import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { images } from "@/constants/images";

const ACCENT = "#9ccadf";

/**
 * Home is the user's personal dashboard — a glance at their notes and stats.
 * Placeholder for now: the real analytics get wired once the capture flow exists
 * and there are notes to summarize. Discovery/browse now lives on the Search tab.
 */
const Home = () => {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-primary">
      <Image
        source={images.bg}
        className="absolute w-full z-0"
        resizeMode="cover"
      />

      <View style={[styles.content, { paddingTop: insets.top + 32 }]}>
        <Text style={styles.kicker}>YOUR DASHBOARD</Text>
        <Text style={styles.title}>Your notes live here</Text>
        <Text style={styles.subtitle}>
          Capture a thought with the voice button and your activity, ratings, and
          stats will start showing up on this screen.
        </Text>
      </View>
    </View>
  );
};

export default Home;

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  kicker: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 12,
  },
  subtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 320,
  },
});
