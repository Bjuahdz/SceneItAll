// ─────────────────────────────────────────────────────────────────────────────
// Permanent storage for take audio files.
//
// The recorder writes to the app's CACHES directory — iOS purges that on disk
// pressure and cache clears, which would silently kill every saved take. This
// service owns a `takes/` folder under the app's DOCUMENT directory (backed up,
// never purged) and the lifecycle of the files inside it: persist on save,
// rescue legacy temp files, delete alongside the DB row.
//
// Uses the new expo-file-system API (SDK 54 default): File/Directory are
// synchronous and THROW on failure — callers decide whether that's fatal.
// ─────────────────────────────────────────────────────────────────────────────
import { Directory, File, Paths } from "expo-file-system";

const TAKES_DIR_NAME = "takes";

export const takesDirectory = (): Directory => new Directory(Paths.document, TAKES_DIR_NAME);

const ensureTakesDir = (): Directory => {
  const dir = takesDirectory();
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
};

/** True when the URI already points inside our permanent takes directory. */
export const isPersistedTakeUri = (uri: string | null | undefined): boolean =>
  !!uri && uri.startsWith(takesDirectory().uri);

// Keep the recording's real container format (.m4a from the HIGH_QUALITY preset,
// but derived, not assumed) so playback and transcription uploads stay correct.
const extensionOf = (uri: string): string => {
  const m = /\.([A-Za-z0-9]+)$/.exec(uri);
  return m ? `.${m[1].toLowerCase()}` : ".m4a";
};

const freshTakeFile = (dir: Directory, sourceUri: string): File =>
  new File(dir, `take-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionOf(sourceUri)}`);

/**
 * Move a finished recording from the recorder's temp URI into permanent storage.
 * Returns the permanent file URI. Throws if the source file doesn't exist —
 * the save path catches and falls back to the temp URI (a fragile take beats a
 * lost one).
 */
export const persistTakeAudio = (tempUri: string): string => {
  const dir = ensureTakesDir();
  const src = new File(tempUri);
  if (!src.exists) throw new Error(`Recording not found at ${tempUri}`);
  const dest = freshTakeFile(dir, tempUri);
  src.move(dest);
  return dest.uri;
};

/**
 * Rescue a legacy take whose audio still sits at a recorder temp URI: move it
 * into permanent storage. Returns the new URI, or null when the temp file is
 * already gone (caller marks the take instead of crashing).
 */
export const rescueTakeAudio = (uri: string): string | null => {
  try {
    const src = new File(uri);
    if (!src.exists) return null;
    const dest = freshTakeFile(ensureTakesDir(), uri);
    src.move(dest);
    return dest.uri;
  } catch (e) {
    console.warn("takeFiles: failed to rescue legacy audio:", e);
    return null;
  }
};

/** Does the audio file behind this URI still exist on disk? */
export const takeAudioExists = (uri: string | null | undefined): boolean => {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
};

// ── Dev one-shot markers ──────────────────────────────────────────────────────
// Guarded dev operations (wipe, reprocess — services/enrichment.ts) leave a
// marker file so they can NEVER run twice — even when the env flag is left set,
// data touched after the operation is safe. Markers are written BEFORE acting.
export const devMarkerExists = (name: string): boolean => {
  try {
    return new File(Paths.document, name).exists;
  } catch {
    return false;
  }
};

/** Returns true when the marker is durably on disk (the operation may proceed). */
export const writeDevMarker = (name: string): boolean => {
  try {
    const f = new File(Paths.document, name);
    if (!f.exists) f.create();
    f.write(new Date().toISOString());
    return true;
  } catch (e) {
    console.error(`takeFiles: could not persist dev marker ${name}:`, e);
    return false;
  }
};

const WIPE_MARKER = "dev-wipe-takes.done";
export const wipeMarkerExists = (): boolean => devMarkerExists(WIPE_MARKER);
export const writeWipeMarker = (): boolean => writeDevMarker(WIPE_MARKER);

/**
 * Delete a take's audio file. Only touches files inside our own takes dir —
 * temp URIs belong to the OS and clean themselves up.
 */
export const deleteTakeAudio = (uri: string | null | undefined): void => {
  if (!isPersistedTakeUri(uri)) return;
  try {
    const f = new File(uri as string);
    if (f.exists) f.delete();
  } catch (e) {
    console.warn("takeFiles: failed to delete audio file:", e);
  }
};
