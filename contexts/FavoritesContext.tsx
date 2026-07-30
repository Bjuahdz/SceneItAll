import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getFavorites,
  addFavorite,
  removeFavorite,
  deleteAllFavorites,
  type FavoriteMovie,
} from "@/services/db";

interface FavoritesContextValue {
  favorites: FavoriteMovie[];
  ready: boolean; // false until the first DB load resolves
  isFavorite: (id: number) => boolean;
  toggleFavorite: (movie: FavoriteMovie) => void;
  /** Dev-panel blank slate. Resolves with how many were removed. */
  clearFavorites: () => Promise<number>;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/**
 * Holds the favorites list in memory and writes through to SQLite. Updates are
 * optimistic — the UI flips instantly and the DB write happens in the background —
 * so saving/un-saving never feels laggy. Mounted once at the app root.
 */
export const FavoritesProvider = ({ children }: { children: React.ReactNode }) => {
  const [favorites, setFavorites] = useState<FavoriteMovie[]>([]);
  const [ready, setReady] = useState(false);

  // Load the persisted list once on startup.
  useEffect(() => {
    let mounted = true;
    getFavorites()
      .then((rows) => mounted && setFavorites(rows))
      .catch((e) => console.error("Failed to load favorites:", e))
      .finally(() => mounted && setReady(true));
    return () => {
      mounted = false;
    };
  }, []);

  const isFavorite = useCallback((id: number) => favorites.some((f) => f.id === id), [favorites]);

  const toggleFavorite = useCallback((movie: FavoriteMovie) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === movie.id);
      if (exists) {
        removeFavorite(movie.id).catch((e) => console.error("removeFavorite failed:", e));
        return prev.filter((f) => f.id !== movie.id);
      }
      addFavorite(movie).catch((e) => console.error("addFavorite failed:", e));
      return [movie, ...prev]; // newest first, matches the DB ordering
    });
  }, []);

  // Goes through the context rather than straight to the DB so every saved-state star
  // and slate row in the tree repaints as empty instead of holding a stale save.
  const clearFavorites = useCallback(async () => {
    const removed = await deleteAllFavorites();
    setFavorites([]);
    return removed;
  }, []);

  const value = useMemo(
    () => ({ favorites, ready, isFavorite, toggleFavorite, clearFavorites }),
    [favorites, ready, isFavorite, toggleFavorite, clearFavorites]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
};

export const useFavorites = (): FavoritesContextValue => {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within a FavoritesProvider");
  return ctx;
};
