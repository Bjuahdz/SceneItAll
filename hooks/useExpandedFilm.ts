import { useEffect, useState } from "react";

import { fetchDirectorSurname, isAbort } from "@/services/search";

/**
 * The director for whichever film is currently open, and nothing else.
 *
 * This exists to enforce a budget rule rather than to be clever: a director is in
 * no search response, so showing `2017 · VILLENEUVE` on every row would cost one
 * request per row per query. Keyed on the OPEN film's id, it costs one request per
 * expansion — and re-collapsing and re-opening the same film costs nothing, because
 * the answer stays cached for the life of the screen.
 */
export function useExpandedFilm(movieId: number | null) {
  const [cache, setCache] = useState<Record<number, string | null>>({});

  useEffect(() => {
    if (movieId == null || movieId in cache) return;
    const controller = new AbortController();
    fetchDirectorSurname(movieId, controller.signal)
      .then((surname) => setCache((c) => ({ ...c, [movieId]: surname })))
      .catch((e) => {
        if (isAbort(e)) return;
        // Cache the miss too — a film whose credits 404 should not be retried on
        // every re-open.
        setCache((c) => ({ ...c, [movieId]: null }));
      });
    return () => controller.abort();
  }, [movieId, cache]);

  return movieId == null ? null : cache[movieId] ?? null;
}
