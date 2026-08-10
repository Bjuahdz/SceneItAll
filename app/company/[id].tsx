import React, { useCallback } from "react";
import { useLocalSearchParams } from "expo-router";

import EntityScreen from "@/components/entity/EntityScreen";
import { loadEntity } from "@/services/entities";

// A studio. Always renders the no-artwork header by design: `fetchCompany` returns
// a null image because TMDB studio logos are unusable — their polarity is unknowable
// (A24's is black-on-transparent and vanishes on our ground, others are white) and
// there is no field distinguishing them. The name set in Bricolage IS the wordmark.
//
// No `origin` and no seed, and there never will be: with no artwork there is no marquee
// to grow out of. Studios open the way they always did. It still uses `loadEntity` so it
// picks up the request the search screen warmed on the tap.
export default function CompanyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(
    (signal: AbortSignal) => loadEntity("company", Number(id), signal),
    [id]
  );
  return <EntityScreen load={load} />;
}
