import React, { useCallback, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";

import EntityScreen, { useOriginParam } from "@/components/entity/EntityScreen";
import { loadEntity } from "@/services/entities";

// A person's page. Person first of the three, deliberately — it is the hardest
// (full-bleed portrait, vitals, biography, the widest no-artwork gap) so it proves
// the shared pattern before collection and studio reuse it.
//
// `img`, `name` and the `o*` rect are optional and come from the marquee that was
// tapped: the first two let the hero paint on the FIRST frame rather than after five
// requests, and the rect is what the page grows itself out of. See EntityScreen.
export default function PersonScreen() {
  const { id, img, name } = useLocalSearchParams<{ id: string; img?: string; name?: string }>();
  // `loadEntity`, not `fetchPerson` — it hands back the request the search screen
  // already started on the tap, so the page is not waiting on five round trips it
  // could have begun a transition earlier.
  const load = useCallback(
    (signal: AbortSignal) => loadEntity("person", Number(id), signal),
    [id]
  );
  const seed = useMemo(
    () => (img ? { kind: "person" as const, imagePath: img, name: name ?? "" } : null),
    [img, name]
  );
  return <EntityScreen load={load} seed={seed} origin={useOriginParam()} />;
}
