import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

import { addTake } from "@/services/db";
import { kickEnrichment } from "@/services/enrichment";
import { persistTakeAudio } from "@/services/takeFiles";

// Max recorded length of a single take before it auto-ends. One knob.
export const CAPTURE_DURATION_MS = 60_000;
// "Get ready" pre-roll before recording actually starts (collect your thoughts).
export const ARM_DURATION_MS = 3_000;
// Discard sub-1.5s recordings as accidental taps.
const MIN_TAKE_MS = 1_500;
// Live-waveform mic metering: poll cadence (~16 Hz) and the dBFS floor we treat as
// silence. RecorderState.metering is in dBFS (≤ 0); we map [floor, 0] → [0, 1].
const METER_INTERVAL_MS = 60;
const METER_FLOOR_DB = -65;

// dBFS metering → 0..1 bar level. Silence / invalid → 0, 0 dBFS → 1.
const normalizeMeter = (db: number | undefined | null): number => {
  if (db == null || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / (0 - METER_FLOOR_DB)));
};

// ms → "m:ss" (e.g. 58200 → "0:58"). Ceil so the last second reads "0:01", not "0:00".
export const formatCaptureTime = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export type CaptureStatus = "idle" | "arming" | "recording" | "paused";

export interface CaptureMovie {
  id: number;
  title: string;
  poster_path: string | null;
}

export interface CaptureSession {
  status: CaptureStatus;
  isActive: boolean; // arming | recording | paused
  isRecording: boolean;
  isPaused: boolean;
  armSecondsLeft: number; // 3 → 1 during the pre-roll
  remainingMs: number; // recording countdown (frozen while paused)
  durationMs: number;
  meterLevel: SharedValue<number>; // live mic level 0..1 on the UI thread (drives the waveform)
  // Pending entry metadata, set from the capture pill's menu, persisted on done().
  isSpoiler: boolean;
  tags: string[];
  start: () => void; // idle → arming (asks permission, then the pre-roll)
  cancel: () => void; // arming → idle
  pause: () => void;
  resume: () => void; // paused → 3·2·1 → recording ("Continue"; cancel returns to paused)
  startOver: () => void; // discard the current audio → 3·2·1 → record from scratch
  toggleSpoiler: () => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  done: () => void; // recording/paused → save → idle
  discard: () => void; // recording/paused → drop without saving → idle ("Delete")
}

/**
 * The capture session for one movie-detail screen ("What's your take?").
 *
 * Lifecycle: idle → arming (3s haptic countdown) → recording ⇄ paused → done.
 * The recording countdown is tracked as accumulated recorded time (each segment summed),
 * so pausing genuinely freezes the clock and resuming continues the same audio file. On
 * `done` the recording is stopped and saved as a take (movie + audio uri + duration).
 *
 * Audio is via `expo-audio`. The recorder's URI is stored as-is for now; moving it to
 * permanent storage (so it survives a cache clear) is a follow-up.
 */
export function useCaptureSession(
  movie: CaptureMovie | null | undefined,
  options: { durationMs?: number; onSaved?: () => void } = {}
): CaptureSession {
  const durationMs = options.durationMs ?? CAPTURE_DURATION_MS;
  // isMeteringEnabled surfaces RecorderState.metering, which feeds the capture sheet's
  // live waveform on the detail screen.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });

  // Latest onSaved, called after a take is persisted (so the screen can refresh the
  // inbox + light up the envelope's new-entry indicator) without re-creating `done`.
  const onSavedRef = useRef(options.onSaved);
  onSavedRef.current = options.onSaved;

  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [armSecondsLeft, setArmSecondsLeft] = useState(0);
  const [remainingMs, setRemainingMs] = useState(durationMs);

  // Live mic level (UI thread). The waveform reads this; keeping it off React state means
  // the 16 Hz metering poll never re-renders the detail screen.
  const meterLevel = useSharedValue(0);

  // Pending entry metadata (set from the pill menu, saved on done()). Mirrored into refs so
  // the auto-end-at-cap path inside the rec timer reads the latest values, not a stale capture.
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const isSpoilerRef = useRef(isSpoiler);
  isSpoilerRef.current = isSpoiler;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  // Latest movie, read inside async callbacks without stale closures.
  const movieRef = useRef(movie);
  movieRef.current = movie;

  const armIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0); // recorded ms banked from completed segments
  const segStartRef = useRef(0); // Date.now() when the current segment began

  const clearArm = useCallback(() => {
    if (armIntervalRef.current) {
      clearInterval(armIntervalRef.current);
      armIntervalRef.current = null;
    }
  }, []);
  const clearRec = useCallback(() => {
    if (recIntervalRef.current) {
      clearInterval(recIntervalRef.current);
      recIntervalRef.current = null;
    }
  }, []);
  const clearMeter = useCallback(() => {
    if (meterIntervalRef.current) {
      clearInterval(meterIntervalRef.current);
      meterIntervalRef.current = null;
    }
  }, []);

  // Poll the recorder's metering while a segment is live and push a 0..1 level into
  // the shared value through an attack/release envelope: RISING levels pass almost
  // instantly (speech onsets actually register instead of being averaged away) while
  // FALLING levels decay gently (bars sink instead of stuttering). Wrapped in
  // try/catch because getStatus() can throw between the prepare/record transitions.
  const startMeter = useCallback(() => {
    clearMeter();
    meterIntervalRef.current = setInterval(() => {
      try {
        const next = normalizeMeter(recorder.getStatus().metering);
        const cur = meterLevel.value;
        meterLevel.value = next > cur
          ? cur * 0.25 + next * 0.75 // fast attack
          : cur * 0.78 + next * 0.22; // slow release
      } catch {
        // recorder not ready this tick — skip
      }
    }, METER_INTERVAL_MS);
  }, [recorder, clearMeter, meterLevel]);

  const done = useCallback(async () => {
    const wasRecording = recIntervalRef.current !== null;
    const recordedMs = elapsedRef.current + (wasRecording ? Date.now() - segStartRef.current : 0);
    const spoiler = isSpoilerRef.current; // capture before the resets below clear them
    const entryTags = tagsRef.current;
    clearArm();
    clearRec();
    clearMeter();
    elapsedRef.current = 0;
    meterLevel.value = 0;
    setArmSecondsLeft(0);
    setRemainingMs(durationMs);
    setStatus("idle");
    setIsSpoiler(false);
    setTags([]);
    try {
      await recorder.stop();
      // Switch the iOS session back to playback so takes play through the main speaker,
      // not the earpiece (allowsRecording: true forces the call-style earpiece route).
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      const m = movieRef.current;
      if (uri && m && recordedMs >= MIN_TAKE_MS) {
        // Move the audio out of the recorder's temp dir into permanent storage
        // (temp files die on cache clears). If the move fails we keep the temp
        // URI — a fragile take beats a lost one.
        let audioUri = uri;
        try {
          audioUri = persistTakeAudio(uri);
        } catch (e) {
          console.error("Failed to persist take audio (keeping temp uri):", e);
        }
        await addTake({
          movie_id: m.id,
          movie_title: m.title,
          poster_path: m.poster_path,
          audio_uri: audioUri,
          duration_ms: Math.round(recordedMs),
          is_spoiler: spoiler,
          tags: entryTags,
        });
        onSavedRef.current?.();
        kickEnrichment(); // transcription/enrichment picks the new take up in the background
      }
    } catch (e) {
      console.error("Failed to stop / save take:", e);
    }
  }, [recorder, clearArm, clearRec, clearMeter, meterLevel, durationMs]);

  // Recording ticker — recomputes remaining from accumulated elapsed time.
  const startRecTimer = useCallback(() => {
    clearRec();
    recIntervalRef.current = setInterval(() => {
      const elapsed = elapsedRef.current + (Date.now() - segStartRef.current);
      const remaining = durationMs - elapsed;
      if (remaining <= 0) {
        done(); // auto-end at the cap
        return;
      }
      setRemainingMs((prev) =>
        Math.ceil(remaining / 1000) !== Math.ceil(prev / 1000) ? remaining : prev
      );
    }, 250);
  }, [clearRec, durationMs, done]);

  const beginRecording = useCallback(async () => {
    elapsedRef.current = 0;
    meterLevel.value = 0;
    segStartRef.current = Date.now();
    setRemainingMs(durationMs);
    setStatus("recording");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); // the "go"
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      console.error("Failed to start recording:", e);
    }
    startRecTimer();
    startMeter();
  }, [recorder, durationMs, startRecTimer, startMeter, meterLevel]);

  // The shared 3·2·1 countdown (haptic tick each second). Every way into recording — fresh
  // start, start-over AND continue-after-pause — runs through this same get-ready pre-roll.
  // `next` fires at zero; `cancelTo` is where cancel() lands (continue cancels back to
  // paused so the take isn't lost; the others cancel to idle).
  const armNextRef = useRef<() => void>(() => {});
  const armCancelToRef = useRef<"idle" | "paused">("idle");
  const beginArming = useCallback(
    (next: () => void, cancelTo: "idle" | "paused" = "idle") => {
      armNextRef.current = next;
      armCancelToRef.current = cancelTo;
      clearArm();
      let n = Math.round(ARM_DURATION_MS / 1000); // 3
      setArmSecondsLeft(n);
      setStatus("arming");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); // tick on "3"
      armIntervalRef.current = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          clearArm();
          armNextRef.current();
        } else {
          setArmSecondsLeft(n);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); // tick on 2, 1
        }
      }, 1000);
    },
    [clearArm]
  );

  // `start` is intentionally SYNCHRONOUS: it flips to "arming" and kicks off the countdown
  // immediately so a quick cancel works reliably. The permission / audio-session setup
  // runs in the background and only aborts the countdown if it's denied.
  const start = useCallback(() => {
    setIsSpoiler(false); // fresh entry — clear any leftover metadata
    setTags([]);
    beginArming(beginRecording, "idle");

    (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          clearArm();
          setArmSecondsLeft(0);
          setStatus((s) => (s === "arming" ? "idle" : s));
          Alert.alert(
            "Microphone access needed",
            "Enable microphone access in Settings to record your take."
          );
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      } catch (e) {
        console.error("Audio setup failed:", e);
        clearArm();
        setStatus((s) => (s === "arming" ? "idle" : s));
      }
    })();
  }, [clearArm, beginArming, beginRecording]);

  // Guarded so it's a safe no-op unless we're still arming. Cancelling a continue-countdown
  // returns to paused (the take survives); cancelling a fresh/start-over countdown → idle.
  const cancel = useCallback(() => {
    clearArm();
    setArmSecondsLeft(0);
    setStatus((s) => (s === "arming" ? armCancelToRef.current : s));
  }, [clearArm]);

  const pause = useCallback(() => {
    clearRec();
    clearMeter(); // freeze the waveform at its last frame
    elapsedRef.current += Date.now() - segStartRef.current; // bank the segment
    try {
      recorder.pause();
    } catch (e) {
      console.error("Failed to pause recording:", e);
    }
    setStatus("paused");
  }, [clearRec, clearMeter, recorder]);

  // The actual resume of a paused take (same audio file continues).
  const continueRecording = useCallback(() => {
    segStartRef.current = Date.now();
    setStatus("recording");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); // the "go"
    try {
      recorder.record(); // continues the same file
    } catch (e) {
      console.error("Failed to resume recording:", e);
    }
    startRecTimer();
    startMeter();
  }, [recorder, startRecTimer, startMeter]);

  // "Continue" also gets a 3·2·1 get-ready countdown; cancelling it returns to paused.
  const resume = useCallback(() => {
    beginArming(continueRecording, "paused");
  }, [beginArming, continueRecording]);

  // "Start over" — discard the current audio and re-arm with a fresh 3·2·1 countdown
  // (same get-ready pre-roll as a new take, not an instant hot mic). The old recording is
  // stopped in the background while the countdown runs; metadata (spoiler / tags) is kept.
  const startOver = useCallback(() => {
    clearRec();
    clearMeter();
    meterLevel.value = 0;
    setRemainingMs(durationMs);
    beginArming(beginRecording, "idle");
    (async () => {
      try {
        await recorder.stop();
      } catch (e) {
        console.error("Failed to stop on start-over:", e);
      }
    })();
  }, [clearRec, clearMeter, meterLevel, durationMs, beginArming, beginRecording, recorder]);

  // "Delete" — stop and drop the recording without saving (no addTake), reset to idle.
  const discard = useCallback(async () => {
    clearArm();
    clearRec();
    clearMeter();
    elapsedRef.current = 0;
    meterLevel.value = 0;
    setArmSecondsLeft(0);
    setRemainingMs(durationMs);
    setStatus("idle");
    setIsSpoiler(false);
    setTags([]);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (e) {
      console.error("Failed to stop on discard:", e);
    }
  }, [recorder, clearArm, clearRec, clearMeter, meterLevel, durationMs]);

  const toggleSpoiler = useCallback(() => setIsSpoiler((v) => !v), []);
  const addTag = useCallback((tag: string) => {
    const t = tag.trim();
    if (!t) return;
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
  }, []);
  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((x) => x !== tag));
  }, []);

  // Clean up timers if the screen unmounts mid-session (the recorder auto-releases).
  useEffect(
    () => () => {
      clearArm();
      clearRec();
      clearMeter();
    },
    [clearArm, clearRec, clearMeter]
  );

  return {
    status,
    isActive: status !== "idle",
    isRecording: status === "recording",
    isPaused: status === "paused",
    armSecondsLeft,
    remainingMs,
    durationMs,
    meterLevel,
    isSpoiler,
    tags,
    start,
    cancel,
    pause,
    resume,
    startOver,
    toggleSpoiler,
    addTag,
    removeTag,
    done,
    discard,
  };
}
