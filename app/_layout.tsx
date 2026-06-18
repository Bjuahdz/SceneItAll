import { Stack } from "expo-router";
import './globals.css';
import { StatusBar } from "react-native";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

export default function RootLayout() {
  return (
    // GestureHandlerRootView must wrap the app so gesture-handler (and the bottom
    // sheet's drag) receives touches; BottomSheetModalProvider lets a sheet render
    // above everything when presented from a button anywhere in the tree.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <StatusBar hidden={false} />
        <Stack>
          <Stack.Screen
            name="(tabs)"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="movie/[id]"
            options={{ headerShown: false }}
          />
        </Stack>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
