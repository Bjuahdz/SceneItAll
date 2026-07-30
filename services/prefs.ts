import { readPrefs, writePref } from "./db";

/**
 * App preferences, cached in memory so they can be read SYNCHRONOUSLY from places that
 * cannot await — `useCaptureSession.start()` is deliberately synchronous so a quick
 * cancel always lands, and it needs to know whether to run the pre-roll on the same
 * tick it flips state.
 *
 * Backed by a key/value table in the app's existing SQLite file: one boolean did not
 * justify adding a storage dependency, and a dev toggle that resets on every reload is
 * worse than no toggle at all.
 *
 * Loaded once at the app root (see app/_layout.tsx). Reads before that resolve to their
 * fallback, which is the correct behaviour for every pref here.
 */

/** Skip the 3·2·1 pre-roll and start recording immediately. Dev convenience. */
export const PREF_SKIP_COUNTDOWN = "dev.skipCountdown";

/** The user has started a take at least once, so the capture disc stops hinting. */
export const PREF_MIC_USED = "hint.micUsed";

let cache: Record<string, string> = {};
let loaded = false;
const readyWaiters = new Set<() => void>();

export const loadPrefs = async (): Promise<void> => {
  try {
    cache = await readPrefs();
  } catch (e) {
    console.error("Failed to load prefs:", e);
    cache = {};
  } finally {
    loaded = true;
    readyWaiters.forEach((fn) => fn());
    readyWaiters.clear();
  }
};

/**
 * Run `fn` once the cache is in memory — immediately if it already is. Returns an
 * unsubscribe.
 *
 * Needed because a screen can mount before the root's load resolves, and a pref read at
 * that moment silently returns its FALLBACK. For a dev toggle that is harmless; for the
 * capture disc's first-run hint it is not, because "have they used this before?" answers
 * false and the hint would run for someone who retired it months ago.
 */
export const onPrefsReady = (fn: () => void): (() => void) => {
  if (loaded) {
    fn();
    return () => {};
  }
  readyWaiters.add(fn);
  return () => {
    readyWaiters.delete(fn);
  };
};

export const getBoolPref = (key: string, fallback = false): boolean => {
  const v = cache[key];
  return v === undefined ? fallback : v === "1";
};

/** Writes through to the cache immediately so the next synchronous read is correct. */
export const setBoolPref = async (key: string, value: boolean): Promise<void> => {
  cache[key] = value ? "1" : "0";
  try {
    await writePref(key, value ? "1" : "0");
  } catch (e) {
    console.error("Failed to persist pref:", key, e);
  }
};
