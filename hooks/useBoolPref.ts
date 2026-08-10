import { useEffect, useState } from "react";

import { getBoolPref, onPrefsChanged, onPrefsReady } from "@/services/prefs";

/**
 * A boolean preference, live.
 *
 * Two subscriptions, because a pref can arrive late for two different reasons:
 *   · READY — the cache is filled asynchronously at the app root, so a screen that
 *     mounts first reads the fallback. Re-read when the load lands.
 *   · CHANGED — someone flipped the toggle while this screen was mounted.
 *
 * Both funnel into the same read, so the component sees one value from one place.
 */
export function useBoolPref(key: string, fallback = false): boolean {
  const [value, setValue] = useState(() => getBoolPref(key, fallback));

  useEffect(() => {
    const read = () => setValue(getBoolPref(key, fallback));
    // Fires immediately when the cache is already loaded, which is the common case.
    read();
    const offReady = onPrefsReady(read);
    const offChanged = onPrefsChanged(read);
    return () => {
      offReady();
      offChanged();
    };
  }, [key, fallback]);

  return value;
}
