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

/**
 * Show a person's SHORTS / DOCUMENTARIES sections.
 *
 * Both default ON, which is the behaviour that already shipped — a pref that hides
 * things by default would silently change the app for anyone who never opens the
 * panel. Person pages only: a collection's parts and a studio's catalogue are not
 * split this way.
 */
export const PREF_SHOW_SHORTS = "person.showShorts";
export const PREF_SHOW_DOCS = "person.showDocs";

/**
 * Seed a fake search session (entities sampled from the REAL archive; count set by
 * PREF_DEMO_ARRIVAL_MAX below) every time the Search tab regains focus, so the arrival
 * choreography can be iterated without hand-searching eight things first. Dev
 * convenience, defaults OFF.
 *
 * In-memory only: nothing is ever written to `search_history`, demo rows carry
 * NEGATIVE session ids so they are unmistakable, and flipping the toggle off (or
 * restarting) returns the real ledger untouched.
 */
export const PREF_DEMO_ARRIVALS = "search.demoArrivals";

/**
 * How many entities one demo arrival seeds — Bryan's slider, so different session
 * sizes can be watched without hunting for them ("just so I can see how it looks for
 * different amounts of things"). A CAP against the archive: a value of 30 with 12
 * archived entities seeds 12. Default 30, his number.
 */
export const PREF_DEMO_ARRIVAL_MAX = "search.demoArrivalMax";

/**
 * Bryan's experiment: when an arrival begins, start the page scrolled so the TOP of
 * the previous sessions' skyline waits at the bottom of the screen — the new cards
 * rain into the visible space above it, instead of into a black screen that only
 * fills once the cascade reaches the top. Scrolling up afterwards = most recent.
 * Dev toggle, defaults OFF; does nothing on visits with no arrival.
 */
export const PREF_ANCHOR_SKYLINE = "search.anchorSkyline";

/**
 * Draw the anchor's dashed guide lines: the fixed LIFT line (where the previous
 * skyline's top row is supposed to sit) and the moving PREV SKYLINE line (where it
 * actually is). Bryan's tuning instrument — "it's hard to tell where exactly things
 * are moving when changing the anchor lift" — and the diagnostic that turns "it
 * didn't anchor" into two numbers. Dev toggle, defaults OFF.
 */
export const PREF_ANCHOR_GUIDE = "search.anchorGuide";

/**
 * A haptic tap as each arriving tile lands — Bryan's "little oomph" experiment.
 * Dev toggle, defaults OFF: haptics are the one embellishment that cannot be
 * ignored by a user who dislikes them, so it ships opt-in until it is judged.
 */
export const PREF_LAND_HAPTICS = "search.landHaptics";

let cache: Record<string, string> = {};
let loaded = false;
const readyWaiters = new Set<() => void>();
const watchers = new Set<() => void>();

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

/** Same contract as the bool pair: synchronous read off the cache, fallback until
 *  loaded. A stored value that does not parse is treated as absent, not as zero. */
export const getNumPref = (key: string, fallback: number): number => {
  const v = cache[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Subscribe to every write. Returns an unsubscribe.
 *
 * `onPrefsReady` answers "are the prefs loaded yet", which is a one-shot; this answers
 * "did one just change", which a screen already on screen needs. Without it a pref is
 * only picked up by a mount, so flipping a toggle and going back to a page that was
 * still in the stack shows the old state until it happens to remount.
 */
export const onPrefsChanged = (fn: () => void): (() => void) => {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
};

export const setNumPref = async (key: string, value: number): Promise<void> => {
  cache[key] = String(value);
  watchers.forEach((fn) => fn());
  try {
    await writePref(key, String(value));
  } catch (e) {
    console.error("Failed to persist pref:", key, e);
  }
};

/** Writes through to the cache immediately so the next synchronous read is correct. */
export const setBoolPref = async (key: string, value: boolean): Promise<void> => {
  cache[key] = value ? "1" : "0";
  // Notified off the CACHE write, not the disk write: every reader reads the cache, so
  // waiting for SQLite would only delay the repaint — and a failed persist still leaves
  // the session correct.
  watchers.forEach((fn) => fn());
  try {
    await writePref(key, value ? "1" : "0");
  } catch (e) {
    console.error("Failed to persist pref:", key, e);
  }
};
