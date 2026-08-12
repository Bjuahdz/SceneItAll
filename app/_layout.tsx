import { Stack } from "expo-router";
import './globals.css';
import { StatusBar } from "react-native";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as ScreenOrientation from "expo-screen-orientation";
import { useFonts } from "expo-font";
import { EntityOverlayProvider } from "@/contexts/EntityOverlayContext";
import { MovieSheetProvider } from "@/contexts/MovieSheetContext";
import { FavoritesProvider } from "@/contexts/FavoritesContext";
import { RecentSearchesProvider } from "@/contexts/RecentSearchesContext";
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
  // The Signal type system: Bricolage Grotesque for display, JetBrains Mono for the
  // micro labels. Static instances rather than the variable originals — React Native
  // cannot reliably select a weight axis, so each weight ships as its own family.
  // Both are SIL Open Font License, so bundling them is fine.
  //
  // The KEY is the family name you reference in styles; keep these in sync with
  // FONT in constants/signal.ts.
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_800ExtraBold: require("../assets/fonts/BricolageGrotesque-ExtraBold.ttf"),
    JetBrainsMono_400Regular: require("../assets/fonts/JetBrainsMono-Regular.ttf"),
    JetBrainsMono_500Medium: require("../assets/fonts/JetBrainsMono-Medium.ttf"),
  });

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

  // Hold the first frame until the faces are ready, so text never paints in the
  // system font and then reflows. Gated on `|| fontError` deliberately: if a file
  // fails to load we degrade to the system face rather than hanging on a blank
  // screen forever.
  if (!fontsLoaded && !fontError) return null;

  return (
    // GestureHandlerRootView must wrap the app so gesture-handler receives touches
    // (swipe-to-reveal on take cards, the nav's presses). FavoritesProvider loads
    // the on-device favorites once and shares them app-wide; RecentSearchesProvider
    // does the same for the Search tab's recents ledger — at the ROOT, because the
    // entity destination pages are pushed routes that live outside (tabs).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <FavoritesProvider>
        <RecentSearchesProvider>
        {/* EntityOverlayProvider holds the entity-page REQUEST only — the layer
            itself (EntityOverlayHost) is rendered inside the search screen, under
            the nav pill, so the pill stays available on entity pages and the page
            survives tab switches. The provider sits here so the nav bar can read
            `isOpen` and any screen can open a page. See EntityOverlayContext. */}
        <EntityOverlayProvider>
        {/* MovieSheetProvider carries the movie sheet's presentation clock — one
            shared value the /movie route writes and the (tabs) recede stage reads,
            so the sheet's travel and the old screen's recede can never disagree.
            See contexts/MovieSheetContext. */}
        <MovieSheetProvider>
          <StatusBar hidden={false} />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            {/* The movie detail SHEET. Transparent + no OS animation, because the
                app draws this presentation itself: the route's content slides up as
                a rounded card while the screen underneath recedes in step (the
                card-stack look — MovieSheetContext is the one clock both read).
                A native "modal" cannot do this: its interactive drag never reaches
                JS, so the background could only react late. The known risk of
                `animation: "none"` (the OS occasionally animating anyway — see the
                entity-page note below) is harmless here: the sheet mounts already
                translated off-screen, so a declined "none" has nothing to flash. */}
            <Stack.Screen
              name="movie/[id]"
              options={{
                headerShown: false,
                presentation: "transparentModal",
                animation: "none",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            {/* LEGACY ROUTES — search does not push these any more. The entity pages
                are presented by EntityOverlayProvider (above), because THREE
                route-based attempts at the marquee grow (fade, transparentModal,
                containedTransparentModal) all stayed intermittently wrong the same
                way: a native screen presentation is OS-owned, and "animation: none"
                is a request it sometimes declines. The routes stay for URL
                navigation and deep links; they render the same EntityScreen with no
                origin, so they simply appear. The transparent contentStyle stays
                because react-navigation's default screen background is opaque WHITE. */}
            <Stack.Screen
              name="person/[id]"
              options={{
                headerShown: false,
                presentation: "containedTransparentModal",
                animation: "none",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen
              name="collection/[id]"
              options={{
                headerShown: false,
                presentation: "containedTransparentModal",
                animation: "none",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen
              name="company/[id]"
              options={{
                headerShown: false,
                presentation: "containedTransparentModal",
                animation: "none",
                contentStyle: { backgroundColor: "transparent" },
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
        </MovieSheetProvider>
        </EntityOverlayProvider>
        </RecentSearchesProvider>
      </FavoritesProvider>
    </GestureHandlerRootView>
  );
}
