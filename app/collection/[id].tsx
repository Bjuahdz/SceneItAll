import React, { useCallback, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";

import EntityScreen, { useOriginParam } from "@/components/entity/EntityScreen";
import { loadEntity } from "@/services/entities";

// A collection — TMDB's noun, and now the UI's too (Bryan, 2026-08-07): it is what
// someone has to type to find one, so the route, the label and the word all agree.
//
// `img` / `name` seed the hero so it paints on the first frame, and the `o*` rect is
// the card this page grows out of — see EntityScreen.
export default function CollectionScreen() {
  const { id, img, name } = useLocalSearchParams<{ id: string; img?: string; name?: string }>();
  const load = useCallback(
    (signal: AbortSignal) => loadEntity("collection", Number(id), signal),
    [id]
  );
  const seed = useMemo(
    () => (img ? { kind: "collection" as const, imagePath: img, name: name ?? "" } : null),
    [img, name]
  );
  return <EntityScreen load={load} seed={seed} origin={useOriginParam()} />;
}
