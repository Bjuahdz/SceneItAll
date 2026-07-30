import { Stack } from "expo-router";
import './globals.css';
import { StatusBar } from "react-native";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as ScreenOrientation from "expo-screen-orientation";
import { FavoritesProvider } from "@/contexts/FavoritesContext";
import { initEnrichment } from "@/services/enrichment";
import { loadPrefs } from "@/services/prefs";

// THREE THIRD-PARTY STARTUP WARNINGS ARE EXPECTED AND DELIBERATELY NOT SILENCED.
// A console.warn filter was written and then removed: none is ours to fix, none is an error, and
// a permanent filter that hides library warnings costs more than three lines of terminal noise.
// If a NEW warning appears we want to read it — that is the whole point.
//
//   1. "SafeAreaView has been deprecated"   react-native-css-interop (NativeWind's runtime) does
//                                           cssInterop(react_native_1.SafeAreaView, …) at load.
//                                           Every SafeAreaView in OUR source already comes from
//                                           react-native-safe-area-context. Fixed upstream in
//                                           nativewind 4.2.6, but that is a styling-runtime bump
//                                           on a stack that has crashed this app before.
//   2. "…Expo Go…media library"             TRUE. ArtworkViewer's save-to-library really is
//                                           degraded until the dev-build gate.
//   3. "…outdated JSX transform"            react-native-youtube-iframe@2.3.0 ships the classic
//                                           transform in its dist. ⚠ DO NOT "FIX" THIS BY
//                                           BUMPING TO 2.4.x — it was tried 2026-07-30 and the
//                                           trailer stopped playing entirely (2.4.x loads a
//                                           different remote player page, iframe_v2.html, and
//                                           never fires playerReady). The dep is now pinned to
//                                           an EXACT 2.3.0 for this reason. See REVIVAL_LOG #23.

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
