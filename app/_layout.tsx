import { Stack } from "expo-router";
import './globals.css';
import { LogBox, StatusBar } from "react-native";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as ScreenOrientation from "expo-screen-orientation";
import { FavoritesProvider } from "@/contexts/FavoritesContext";
import { initEnrichment } from "@/services/enrichment";
import { loadPrefs } from "@/services/prefs";

// EXPO GO ONLY, AND IT IS TELLING THE TRUTH — expo-media-library cannot get full
// library access under Expo Go on Android, so saving artwork (ArtworkViewer) is
// genuinely limited until we cross the dev-build gate. Nothing here fixes that;
// the notice just fires on every launch and we already know. Kept as a single
// exact-prefix match so an unrelated media-library problem still surfaces.
LogBox.ignoreLogs([
  "Due to changes in Androids permission requirements, Expo Go can no longer provide full access to the media library.",
]);

export default function RootLayout() {
  // The app is portrait everywhere. app.json's orientation is now "default"
  // (required so iOS will PERMIT rotation at all), and we hold portrait at
  // startup — the trailer player is the one place that unlocks, then re-locks
  // here on close. Without this global lock the whole app would free-rotate.
  React.useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // Voice → structured-memory pipeline (Phase 3): rescue legacy take audio, then
  // keep the enrichment queue draining on launch / foreground / reconnect.
  React.useEffect(() => {
    initEnrichment();
  }, []);

  // Prefs are read synchronously in places that cannot await (the capture pre-roll),
  // so the cache is filled once here at the root. Reads before it lands fall back.
  React.useEffect(() => {
    loadPrefs();
  }, []);

  return (
    // GestureHandlerRootView must wrap the app so gesture-handler receives touches
    // (swipe-to-reveal on take cards, the nav's presses). FavoritesProvider loads
    // the on-device favorites once and shares them app-wide.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <FavoritesProvider>
        <StatusBar hidden={false} />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* Detail is presented as a sheet/modal over the list (no full-page push) —
              on iOS this is the card-over-list look; swipe down or the close button dismisses. */}
          <Stack.Screen
            name="movie/[id]"
            options={{
              headerShown: false,
              presentation: "modal",
              gestureEnabled: true,
              animation: "slide_from_bottom",
            }}
          />
          {/* Universe's sky, live — NOT Discover. Pushed full-screen from the
              Home dashboard so the same constellation simply comes alive; the
              ✕ dismisses it. Discover is a real tab and lives elsewhere. */}
          <Stack.Screen
            name="explore"
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: "fade",
            }}
          />
        </Stack>
      </FavoritesProvider>
    </GestureHandlerRootView>
  );
}
