import React, { useCallback, useRef } from "react";
import { Tabs } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

const ACCENT = "#9ccadf";
const INACTIVE = "rgba(255, 255, 255, 0.85)";

// Each nav tab in the pill. `family` lets us mix icon sets — the Saved tab uses a
// bookmark-plus glyph that only exists in MaterialCommunityIcons.
type TabIconSpec = {
  family: "ionicons" | "mci";
  active: string;
  inactive: string;
};

const TAB_CONFIG: Record<string, { label: string; icon: TabIconSpec }> = {
  index: { label: "Home", icon: { family: "ionicons", active: "home", inactive: "home-outline" } },
  search: { label: "Search", icon: { family: "ionicons", active: "search", inactive: "search-outline" } },
  saved: { label: "Saved", icon: { family: "mci", active: "bookmark-plus", inactive: "bookmark-plus-outline" } },
};

function TabIcon({ icon, focused }: { icon: TabIconSpec; focused: boolean }) {
  const name = focused ? icon.active : icon.inactive;
  const color = focused ? ACCENT : INACTIVE;
  if (icon.family === "mci") {
    return <MaterialCommunityIcons name={name as any} size={24} color={color} />;
  }
  return <Ionicons name={name as any} size={24} color={color} />;
}

// Voice-capture "orb": a ring of dots around a single accent core, built from plain
// Views so it matches the Figma without shipping an asset. Each dot is centered on
// the container, then pushed out onto the ring with a transform.
const ORB_DOTS = 12;
const ORB_RADIUS = 15;
const ORB_DOT = 4;

function VoiceOrb() {
  return (
    <View style={styles.orb}>
      {Array.from({ length: ORB_DOTS }).map((_, i) => {
        const angle = (i / ORB_DOTS) * Math.PI * 2 - Math.PI / 2;
        return (
          <View
            key={i}
            style={[
              styles.orbDot,
              {
                transform: [
                  { translateX: Math.cos(angle) * ORB_RADIUS },
                  { translateY: Math.sin(angle) * ORB_RADIUS },
                ],
              },
            ]}
          />
        );
      })}
      <View style={styles.orbCore} />
    </View>
  );
}

/**
 * Floating nav: a blurred 3-tab pill (Home / Search / Saved) plus a separate
 * blurred orb button that opens the voice-capture sheet. The active tab is shown
 * by an accent-colored icon — no labels, matching the Figma.
 */
function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);

  const onVoicePress = useCallback(() => {
    sheetRef.current?.present();
  }, []);

  // Dim + dismiss when tapping outside the sheet.
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
    ),
    []
  );

  return (
    <>
      <View
        style={[styles.wrapper, { bottom: Math.max(insets.bottom, 16) + 8 }]}
        pointerEvents="box-none"
      >
        <View style={styles.row}>
          <BlurView
            intensity={45}
            tint="dark"
            // Real blur on Android; without this it falls back to a plain translucent fill.
            experimentalBlurMethod="dimezisBlurView"
            style={styles.bar}
          >
            {state.routes.map((route, index) => {
              const config = TAB_CONFIG[route.name];
              if (!config) return null;

              const isFocused = state.index === index;

              const onPress = () => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });

                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="button"
                  accessibilityState={isFocused ? { selected: true } : {}}
                  accessibilityLabel={config.label}
                  onPress={onPress}
                  hitSlop={8}
                  style={styles.tab}
                >
                  <TabIcon icon={config.icon} focused={isFocused} />
                </Pressable>
              );
            })}
          </BlurView>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New voice note"
            onPress={onVoicePress}
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
          >
            <BlurView
              intensity={45}
              tint="dark"
              experimentalBlurMethod="dimezisBlurView"
              style={styles.orbButton}
            >
              <VoiceOrb />
            </BlurView>
          </Pressable>
        </View>
      </View>

      <BottomSheetModal
        ref={sheetRef}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
      >
        {/* Empty placeholder for now — capture states (listening / review) come later. */}
        <BottomSheetView style={[styles.sheetContent, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.sheetPlaceholder}>Voice capture — coming soon</Text>
        </BottomSheetView>
      </BottomSheetModal>
    </>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
      <Tabs.Screen name="saved" options={{ title: "Saved" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 100,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    // Gap between the nav pill (left) and the voice orb (right). Bump this up to make
    // the two sections read as more distinct.
    gap: 100,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    // Lower radius = less "bubbly": a soft rounded-rect instead of a full pill.
    borderRadius: 30,
    overflow: "hidden",
    // Tint over the blur; also the graceful fallback if blur is unavailable.
    backgroundColor: "rgba(15, 15, 20, 0.45)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  orbButton: {
    // Matches the new pill height (icon 24 + tab pv 10*2 + bar pv 6*2 = 56) so the two
    // sections line up. Kept fully round (radius = size / 2) to contrast the rounded-rect
    // pill and read as the primary capture action.
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 15, 20, 0.45)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  orb: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  orbDot: {
    position: "absolute",
    width: ORB_DOT,
    height: ORB_DOT,
    borderRadius: ORB_DOT / 2,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    left: "50%",
    top: "50%",
    marginLeft: -ORB_DOT / 2,
    marginTop: -ORB_DOT / 2,
  },
  orbCore: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: ACCENT,
  },
  sheetBackground: {
    backgroundColor: "#15151a",
  },
  sheetHandle: {
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  sheetContent: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 40,
    minHeight: 220,
  },
  sheetPlaceholder: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 15,
    fontWeight: "500",
  },
});
