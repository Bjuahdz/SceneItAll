import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";

import { getVaultFilms, type VaultFilm } from "@/services/db";

/**
 * The user's own library, as Search needs it: which films they have written about.
 *
 * Reloaded on FOCUS rather than once on mount, because the most common way this
 * goes stale is the user leaving to record a take and coming straight back — a
 * mount-only load would show the film they just journaled as un-starred.
 */
export function useVault() {
  const [films, setFilms] = useState<VaultFilm[]>([]);
  const [ready, setReady] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getVaultFilms()
        .then((rows) => active && setFilms(rows))
        .catch((e) => console.error("Failed to load vault films:", e))
        .finally(() => active && setReady(true));
      return () => {
        active = false;
      };
    }, [])
  );

  // O(1) lookup per row — the star is checked once for every result on every render.
  const entryIds = useMemo(() => new Set(films.map((f) => f.movie_id)), [films]);

  return { films, entryIds, ready };
}
