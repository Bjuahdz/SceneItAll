import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { clearTakeOffTopic, deleteTake, updateTakeSpoiler, updateTakeTitle, type Take } from "@/services/db";
import { kickEnrichment } from "@/services/enrichment";
import { formatCaptureTime } from "@/hooks/useCaptureSession";
import TakeProgressBar from "./TakeProgressBar";
import TakeSwipeRow from "./TakeSwipeRow";

// Ticket tokens for chrome; the lime/ink pair below is the surviving ACID palette
// (deliberate literals — they are acid imports, not ticket tokens).
import { TICKET_INK, TICKET_ACCENT, INK_AMBER, INK_RED } from "./ticketTheme";
const ACCENT = TICKET_ACCENT;
const AMBER = INK_AMBER;
const DANGER = INK_RED;
const ACID_LIME = "#D6F32F";
const ACID_INK = "#0E0E10";

// One smooth, snappy transition family for the whole list — no springs, no bounce.
const SHIFT = LinearTransition.duration(180).easing(Easing.out(Easing.cubic));

// A take counts as "just captured" for this long — its chip reads NEW · <duration>.
const NEW_WINDOW_MS = 10 * 60 * 1000;

interface MovieEntriesTabProps {
  takes: Take[];
  onChanged: () => void; // re-load takes after any mutation
  // The screen's scroll-fold value — scrolling down dismisses any inline rename.
  shrink?: SharedValue<number>;
}

const dayLabel = (ms: number): string => {
  const d = new Date(ms);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const dayKeyOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

// Honest stage stepping for the enrichment pipeline — not a fake trickle.
// pending → 36, transcribed → 72, enriched-but-insight-owed → 94, done/failed → null.
const stagePercent = (take: Take): number | null => {
  if (take.enrich_status === "pending") return 36;
  if (take.enrich_status === "transcribed") return 72;
  if (take.enrich_status === "enriched" && take.insighted_at == null) return 94;
  return null;
};

// Within a stage the number CREEPS toward (never reaches) the next boundary —
// asymptotic drift, so the bar always feels like work is happening while staying
// honest: crossing a boundary still requires the pipeline to actually land it.
const STAGE_CREEP = {
  pending: { floor: 36, cap: 66, tau: 22_000 },
  transcribed: { floor: 72, cap: 90, tau: 18_000 },
  insight: { floor: 94, cap: 99, tau: 14_000 },
} as const;

function useCreepingPercent(stage: keyof typeof STAGE_CREEP): number {
  const [pct, setPct] = useState<number>(STAGE_CREEP[stage].floor);
  useEffect(() => {
    const { floor, cap, tau } = STAGE_CREEP[stage];
    const t0 = Date.now();
    setPct(floor);
    const id = setInterval(() => {
      const t = Date.now() - t0;
      setPct(Math.round(floor + (cap - floor) * (1 - Math.exp(-t / tau))));
    }, 900);
    return () => clearInterval(id);
  }, [stage]);
  return pct;
}

// Numeral + bar for an in-flight take — one creeping value drives BOTH, so the
// number and the lime fill can never disagree.
function InFlightProgress({ take }: { take: Take }) {
  const stage: keyof typeof STAGE_CREEP =
    take.enrich_status === "pending"
      ? "pending"
      : take.enrich_status === "transcribed"
        ? "transcribed"
        : "insight";
  const pct = useCreepingPercent(stage);
  return (
    <>
      <Text style={styles.percentText}>{pct}%</Text>
      <TakeProgressBar percent={pct} />
    </>
  );
}

// ── State chip — the pill riding the card's head row. ────────────────────────
function StateChip({ take }: { take: Take }) {
  const status = take.enrich_status;
  // Default: 'pending' — outline chip, quiet white.
  let label = "TRANSCRIBING";
  let tone = "rgba(255,255,255,0.7)";
  let bg = "transparent";
  let border = "rgba(255,255,255,0.35)";

  if (status === "transcribed" || (status === "enriched" && take.insighted_at == null)) {
    label = "PONDERING";
    tone = AMBER;
  } else if (status === "enriched" && take.off_topic === 1) {
    // Flagged as not being about the movie — the card asks keep-or-delete.
    label = "OFF TOPIC?";
    tone = ACID_INK;
    bg = AMBER;
    border = "transparent";
  } else if (status === "enriched" && take.is_spoiler === 1) {
    // Spoiler outranks NEW/COMPLETE but LOSES to the off-topic question above.
    label = "SPOILER";
    tone = ACID_INK; // dark ink on amber — same fill/ink recipe as the lime chip
    bg = AMBER;
    border = "transparent";
  } else if (status === "enriched") {
    const isNew = Date.now() - take.created_at < NEW_WINDOW_MS;
    label = isNew ? "NEW" : "COMPLETE"; // duration lives on the play chip, nowhere else
    tone = ACID_INK; // dark ink ON lime — lime is never a text color
    bg = ACID_LIME;
    border = "transparent";
  } else if (status === "failed" || status === "audio_missing") {
    label = "LOST IN TRANSIT";
    tone = ACID_INK;
    bg = DANGER;
    border = "transparent";
  }

  return (
    <View style={[styles.chip, { backgroundColor: bg, borderColor: border }]}>
      <View style={[styles.chipDot, { backgroundColor: tone }]} />
      <Text style={[styles.chipText, { color: tone }]}>{label}</Text>
    </View>
  );
}

// ── Playback line — animated bars shown inside the card that is making sound. ──
const WAVE_BAR_COUNT = 22;

function WaveBar({ index }: { index: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    v.value = withDelay(
      index * 55,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 240 + (index % 3) * 70, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.25, { duration: 240 + ((index + 1) % 3) * 70, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        true
      )
    );
    return () => cancelAnimation(v);
  }, [index, v]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: v.value }] }));
  return <Animated.View style={[styles.waveBar, style]} />;
}

function PlaybackWave() {
  return (
    <View style={styles.wave}>
      {Array.from({ length: WAVE_BAR_COUNT }, (_, i) => (
        <WaveBar key={i} index={i} />
      ))}
    </View>
  );
}

// ── Static whisper waveform — the footer's resting texture. ──────────────────
// Deterministic pseudo-random heights (3–9px) so every card wears the same
// quiet signature; the live PlaybackWave replaces it while sound is on.
const STATIC_BAR_COUNT = 30;
const STATIC_BAR_HEIGHTS = Array.from(
  { length: STATIC_BAR_COUNT },
  (_, i) => 3 + ((i * 37 + 11) % 7)
);

function StaticWave() {
  return (
    <View style={styles.staticWave}>
      {STATIC_BAR_HEIGHTS.map((h, i) => (
        <View key={i} style={[styles.staticWaveBar, { height: h }]} />
      ))}
    </View>
  );
}

// ── Spoiler stamp — slams onto the frost pane covering a spoiler's body. ─────
// Mounts oversized, over-rotated and transparent, settling to its resting pose
// (-4deg) in ~220ms. Every mount replays the slam — subtle enough to be a
// feature, and when the mark comes from the swipe tab the Heavy haptic there
// makes it read as the stamp hitting the ticket.
function SpoilerStamp() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [t]);
  const slam = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [
      { scale: interpolate(t.value, [0, 1], [1.5, 1]) },
      { rotate: `${interpolate(t.value, [0, 1], [-10, -4])}deg` },
    ],
  }));
  return (
    <Animated.View style={[styles.stamp, slam]}>
      <Text style={styles.stampTitle}>SPOILER INSIDE</Text>
      <Text style={styles.stampSub}>TAP TO REVEAL</Text>
    </Animated.View>
  );
}

/**
 * The ENTRIES tab — stacked full-width take cards, newest first. QUOTE-FIRST:
 * a take leads with what was SAID, not with controls.
 *
 * Card anatomy, top to bottom: a chip row (StateChip + the card's ONLY metadata,
 * "TAKE NN · m:ss"); the summary as an oversized italic hero quote riding a
 * ghost quotation mark; a faint caps title line that doubles as the inline
 * rename affordance; a footer with the outlined play chip, a whisper-thin static
 * waveform (live PlaybackWave while playing) and the READ TRANSCRIPT toggle.
 * No dates on cards — the day captions between cards are the only calendar.
 *
 * In-flight takes keep the honest stage percentage over the lime hatched bar,
 * with the transcript/summary building dimly beneath as stages land. Spoiler
 * takes frost everything below the chip row under an amber SPOILER INSIDE
 * stamp; the whole card is the tap target to reveal (and re-veil).
 *
 * Per-take actions hide behind a LEFT SWIPE (TakeSwipeRow edge tabs — SPOILER ·
 * DELETE · SELECT, one row open at a time). While anything is selected, a batch
 * bar rides the bottom of the list and tapping any card toggles its selection.
 */
export default function MovieEntriesTab({ takes, onChanged, shrink }: MovieEntriesTabProps) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Which row has its swipe actions exposed — at most one at a time.
  const [openRowId, setOpenRowId] = useState<number | null>(null);
  // Spoiler stamps lifted this session — tapping the card veils it back.
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  // Which take shows its FULL transcript (read-only enrichment surfacing).
  const [expandedTranscriptId, setExpandedTranscriptId] = useState<number | null>(null);

  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    if (playingId !== null && playerStatus?.didJustFinish) setPlayingId(null);
  }, [playerStatus, playingId]);

  // Scrolling down dismisses an in-progress rename (same fold signal as the top bar).
  const dismissEditing = () => {
    setEditingId(null);
    setDraft("");
    setExpandedTranscriptId(null);
    setOpenRowId(null);
  };

  // Swipe-tap guard: a card's touch can belong to a child touchable BEFORE the
  // pan activates, so the press still completes on release even after a swipe —
  // the rename/transcript "headache". TakeSwipeRow arms this ref the moment a
  // horizontal drag starts (and disarms it shortly after the gesture ends);
  // every in-card press handler checks it first.
  const swipeTapGuard = useRef(false);

  const toggleTranscript = useCallback((id: number) => {
    if (swipeTapGuard.current) return;
    Haptics.selectionAsync();
    setExpandedTranscriptId((prev) => (prev === id ? null : id));
  }, []);
  useAnimatedReaction(
    () => (shrink ? shrink.value : 0),
    (s, prev) => {
      if (s > 0.5 && (prev ?? 0) <= 0.5) runOnJS(dismissEditing)();
    }
  );

  // Stable take numbers: order of capture, so the newest take wears the highest one.
  const numberById = useMemo(() => {
    const m = new Map<number, number>();
    [...takes]
      .sort((a, b) => a.created_at - b.created_at)
      .forEach((t, i) => m.set(t.id, i + 1));
    return m;
  }, [takes]);

  const sorted = useMemo(
    () =>
      [...takes].sort((a, b) =>
        newestFirst ? b.created_at - a.created_at : a.created_at - b.created_at
      ),
    [takes, newestFirst]
  );

  const toggleSort = useCallback(() => {
    Haptics.selectionAsync();
    setEditingId(null);
    setNewestFirst((v) => !v);
  }, []);

  // ── Swipe-revealed actions (TakeSwipeRow) ──────────────────────────────────
  const toggleSelected = useCallback((id: number) => {
    if (swipeTapGuard.current) return;
    Haptics.selectionAsync();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSwipeSelect = useCallback(
    (take: Take) => {
      setOpenRowId(null);
      toggleSelected(take.id);
    },
    [toggleSelected]
  );

  const handleSwipeSpoiler = useCallback(
    async (take: Take) => {
      const marking = take.is_spoiler !== 1;
      // Marking via the swipe tab is the STAMP moment — the heavy thud lands
      // together with the SpoilerStamp's slam-settle on the card.
      if (marking) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      else Haptics.selectionAsync();
      setOpenRowId(null);
      await updateTakeSpoiler(take.id, marking);
      onChanged();
    },
    [onChanged]
  );

  const handleSwipeDelete = useCallback(
    async (take: Take) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setOpenRowId(null);
      if (playingId === take.id) {
        player.pause();
        setPlayingId(null);
      }
      // A deleted take can't linger in the selection.
      setSelectedIds((prev) => {
        if (!prev.has(take.id)) return prev;
        const next = new Set(prev);
        next.delete(take.id);
        return next;
      });
      await deleteTake(take.id);
      onChanged();
    },
    [playingId, player, onChanged]
  );

  // Spoiler stamp — lifted per card, this session only; tapping again re-veils.
  const toggleReveal = useCallback((id: number) => {
    if (swipeTapGuard.current) return;
    Haptics.selectionAsync();
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const togglePlay = useCallback(
    async (take: Take) => {
      if (swipeTapGuard.current) return;
      if (!take.audio_uri) return;
      Haptics.selectionAsync();
      if (playingId === take.id) {
        player.pause();
        setPlayingId(null);
      } else {
        // Route playback through the main speaker (not the earpiece left from recording).
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        player.replace(take.audio_uri);
        player.play();
        setPlayingId(take.id);
      }
    },
    [playingId, player]
  );

  const beginRename = useCallback((take: Take) => {
    if (swipeTapGuard.current) return;
    Haptics.selectionAsync();
    setEditingId(take.id);
    setDraft(take.title ?? "");
  }, []);

  const commitRename = useCallback(
    async (take: Take) => {
      const title = draft.trim();
      setEditingId(null);
      setDraft("");
      await updateTakeTitle(take.id, title.length ? title : null);
      onChanged();
    },
    [draft, onChanged]
  );

  // Off-topic verdicts (the extraction stage flagged the take): the user rules.
  // KEEP IT clears the flag AND kicks the queue — the embedding/insight stages
  // that were skipped to save cost now run for the vouched-for take.
  const handleOffTopicKeep = useCallback(
    async (take: Take) => {
      Haptics.selectionAsync();
      await clearTakeOffTopic(take.id);
      onChanged();
      kickEnrichment();
    },
    [onChanged]
  );

  const handleOffTopicDelete = useCallback(
    async (take: Take) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      if (playingId === take.id) {
        player.pause();
        setPlayingId(null);
      }
      await deleteTake(take.id);
      onChanged();
    },
    [playingId, player, onChanged]
  );

  // ── Batch bar (lives after the last card while selection.size > 0) ─────────
  const clearSelection = useCallback(() => {
    Haptics.selectionAsync();
    setSelectedIds(new Set());
  }, []);

  const batchSpoiler = useCallback(async () => {
    if (selectedIds.size === 0) return;
    Haptics.selectionAsync();
    await Promise.all(Array.from(selectedIds).map((id) => updateTakeSpoiler(id, true)));
    setSelectedIds(new Set());
    onChanged();
  }, [selectedIds, onChanged]);

  const batchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (playingId !== null && selectedIds.has(playingId)) {
      player.pause();
      setPlayingId(null);
    }
    await Promise.all(Array.from(selectedIds).map((id) => deleteTake(id)));
    setSelectedIds(new Set());
    onChanged();
  }, [selectedIds, playingId, player, onChanged]);

  // FOOTER ROW — the card's one audio seat: outlined play chip ("▶ m:ss"), the
  // whisper wave filling the middle (live PlaybackWave while this take plays),
  // and on the right either a status note (AUDIO KEPT/LOST) or the transcript
  // toggle. NO dates here — the day captions between cards own the calendar.
  const renderFooterRow = (
    item: Take,
    opts: { withPlay?: boolean; transcriptTag?: boolean; rightNote?: string; veiled?: boolean } = {}
  ) => {
    const isPlaying = playingId === item.id;
    const expandedThis = expandedTranscriptId === item.id;
    const selecting = selectedIds.size > 0;
    const showPlay = (opts.withPlay ?? true) && !!item.audio_uri;
    return (
      <View style={styles.footerRow}>
        {showPlay && (
          <TouchableOpacity
            onPress={() => togglePlay(item)}
            hitSlop={8}
            disabled={opts.veiled}
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
          >
            <View style={styles.playChip}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={11} color={ACCENT} />
              <Text style={styles.playChipText}>{formatCaptureTime(item.duration_ms)}</Text>
            </View>
          </TouchableOpacity>
        )}
        <View style={styles.waveSlot}>{isPlaying ? <PlaybackWave /> : <StaticWave />}</View>
        {opts.rightNote ? (
          <Text style={styles.footerTag}>{opts.rightNote}</Text>
        ) : opts.transcriptTag && !!item.transcript ? (
          <TouchableOpacity
            onPress={() => toggleTranscript(item.id)}
            hitSlop={6}
            disabled={opts.veiled || selecting}
            accessibilityRole="button"
            accessibilityLabel={expandedThis ? "Collapse transcript" : "Expand transcript"}
          >
            <Text style={styles.footerTag}>
              {expandedThis ? "HIDE ⌃" : "READ TRANSCRIPT ⌄"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const renderCard = (item: Take) => {
    const isEditing = editingId === item.id;
    const isSelected = selectedIds.has(item.id);
    // A live selection is the only "mode" left: tapping any card toggles it.
    const selecting = selectedIds.size > 0;
    const expandedThis = expandedTranscriptId === item.id;
    const n = numberById.get(item.id) ?? 0;
    const pct = stagePercent(item);
    const isFailed = item.enrich_status === "failed" || item.enrich_status === "audio_missing";
    const audioGone = item.enrich_status === "audio_missing";
    const inFlight = !isFailed && pct !== null;
    // The stamp only frosts a FINISHED spoiler, and the off-topic question
    // outranks it (chip precedence: OFF TOPIC? > SPOILER) — the ruling box
    // must stay reachable, so an off-topic spoiler waits unfrosted.
    const stamped = item.is_spoiler === 1 && !inFlight && !isFailed && item.off_topic !== 1;
    const veiled = stamped && !revealedIds.has(item.id);
    // The hero quote: the summary, or (owed summary) the transcript's first line.
    const heroText = item.summary ?? item.transcript?.split(/\r?\n/, 1)[0] ?? null;

    return (
      // HARD RULE: touchables are TouchableOpacity with plain styles only; every
      // visual (border, fill, padding) lives on the inner card View.
      // The WHOLE CARD is the spoiler stamp's tap target — reveal and re-veil.
      <TouchableOpacity
        onPress={
          selecting
            ? () => toggleSelected(item.id)
            : stamped
              ? () => toggleReveal(item.id)
              : undefined
        }
        disabled={!selecting && !stamped}
        activeOpacity={0.85}
        accessibilityRole={selecting || stamped ? "button" : undefined}
        accessibilityState={selecting ? { selected: isSelected } : undefined}
        accessibilityLabel={
          !selecting && stamped
            ? veiled
              ? "Spoiler, tap to reveal"
              : "Tap to veil spoiler"
            : item.title ?? `Take ${n}`
        }
      >
        <View style={[styles.card, isSelected && styles.cardSelected]}>
          <View style={isSelected ? styles.contentDim : null}>
            {/* CHIP ROW — state chip left; the card's ONLY metadata right:
                take number + duration, once. Stays visible above the frost. */}
            <View style={styles.headRow}>
              <StateChip take={item} />
              <View style={styles.headRight}>
                {isSelected && (
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark" size={10} color={ACID_INK} />
                  </View>
                )}
                {/* Take number ONLY — the duration already lives on the play chip. */}
                <Text style={styles.chipMeta}>
                  TAKE {String(n).padStart(2, "0")}
                </Text>
              </View>
            </View>

            {inFlight ? (
              // IN-FLIGHT: honest stage percentage over the lime hatched bar —
              // and the take BUILDS beneath it as stages land: the transcript
              // fades in the moment it's heard, the summary the moment it's
              // understood, each already sitting where the finished card puts it.
              <View>
                <InFlightProgress take={item} />
                <Text style={styles.buildingTag}>TRANSCRIPT — BUILDING</Text>
                {!!item.summary && (
                  <Animated.View entering={FadeInDown.duration(300)}>
                    <Text style={styles.summaryText}>“{item.summary}”</Text>
                  </Animated.View>
                )}
                {!!item.transcript && (
                  <Animated.View entering={FadeInDown.duration(300)}>
                    <Text style={styles.transcriptText} numberOfLines={3}>
                      {item.transcript}
                    </Text>
                  </Animated.View>
                )}
                {renderFooterRow(item)}
              </View>
            ) : isFailed ? (
              // FAILED / AUDIO LOST: a stalled red bar under a plain ERROR verdict.
              <View>
                <Text style={styles.errorText}>ERROR</Text>
                <TakeProgressBar percent={30} error />
                <Text style={styles.failCopy}>
                  {audioGone
                    ? "The audio for this take was lost before transcription could reach it. The entry itself is still here."
                    : "Your audio is safe. Nothing came back from transcription — the take is still here and can be sent again."}
                </Text>
                {renderFooterRow(item, {
                  withPlay: !audioGone,
                  rightNote: audioGone ? "AUDIO LOST" : "AUDIO KEPT",
                })}
              </View>
            ) : (
              // COMPLETE: the QUOTE-FIRST body — everything below the chip row
              // sits in one region so the spoiler frost can cover it whole.
              <View>
                {/* Extraction flagged this take as not being about the movie —
                    say so plainly and let the user rule on it, exactly once. */}
                {item.off_topic === 1 && (
                  <View style={styles.offTopicBox}>
                    <View style={styles.offTopicHead}>
                      <Ionicons name="alert-circle" size={13} color={AMBER} />
                      <Text style={styles.offTopicTitle}>MIGHT NOT BE ABOUT THIS MOVIE</Text>
                    </View>
                    <Text style={styles.offTopicCopy}>
                      We couldn't hear anything about {item.movie_title} in this take. Keep it
                      anyway, or clear it out?
                    </Text>
                    <View style={styles.offTopicRow}>
                      <TouchableOpacity
                        onPress={() => handleOffTopicKeep(item)}
                        activeOpacity={0.72}
                        style={styles.offTopicTouch}
                        accessibilityRole="button"
                        accessibilityLabel="Keep this take"
                      >
                        <View style={styles.offTopicBtn}>
                          <Text style={styles.offTopicBtnText}>KEEP IT</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleOffTopicDelete(item)}
                        activeOpacity={0.72}
                        style={styles.offTopicTouch}
                        accessibilityRole="button"
                        accessibilityLabel="Delete this take"
                      >
                        <View style={styles.offTopicBtn}>
                          <Ionicons name="trash-outline" size={12} color={DANGER} />
                          <Text style={[styles.offTopicBtnText, { color: DANGER }]}>DELETE</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* HERO QUOTE — what was said leads. The oversized ghost mark
                    does the quoting; the text itself carries none. */}
                {!!heroText && (
                  <View style={styles.quoteWrap}>
                    <Text style={styles.ghostQuote}>“</Text>
                    <Text
                      style={[styles.heroQuote, !item.summary && styles.heroQuoteFallback]}
                      numberOfLines={item.summary ? undefined : 2}
                    >
                      {heroText}
                    </Text>
                  </View>
                )}

                {/* TITLE LINE — faint caps; the inline rename affordance. */}
                {isEditing ? (
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Add a title"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    style={styles.titleInput}
                    autoFocus
                    maxLength={60}
                    returnKeyType="done"
                    onSubmitEditing={() => commitRename(item)}
                    onBlur={() => commitRename(item)}
                  />
                ) : (
                  // Tap the TITLE LINE to rename — disabled while selecting so
                  // the tap falls through to the card's selection toggle.
                  <TouchableOpacity
                    onPress={() => beginRename(item)}
                    hitSlop={6}
                    disabled={selecting || veiled}
                    accessibilityRole="button"
                    accessibilityLabel={item.title ? "Rename take" : "Add a title"}
                  >
                    <Text style={styles.titleLine} numberOfLines={1}>
                      {item.title ? `${item.title} · ✎` : "✎ Add a title"}
                    </Text>
                  </TouchableOpacity>
                )}

                {renderFooterRow(item, { transcriptTag: true, veiled })}

                {/* The full transcript, below the footer when expanded —
                    real reading type, unmistakably brighter. */}
                {expandedThis && !!item.transcript && (
                  <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
                    <Text style={[styles.transcriptText, styles.transcriptTextExpanded]}>
                      {item.transcript}
                    </Text>
                  </Animated.View>
                )}

                {/* THE FROST — covers everything below the chip row while the
                    spoiler is veiled. The text stays mounted underneath; the
                    stamp slam-settles on top. Touches on the pane bubble to
                    the card touchable, whose tap is the reveal. */}
                {veiled && (
                  <View style={styles.frostPane}>
                    <SpoilerStamp />
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (takes.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="mic-outline" size={30} color="rgba(255,255,255,0.35)" />
        <Text style={styles.emptyText}>No entries yet for this title</Text>
        <Text style={styles.emptyHint}>Tap the pill below to record your take</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Count + sort — the count speaks the cards' TAKE · NN mono voice; the
          sort control is a small glass chip. */}
      <View style={styles.listHeadRow}>
        <Text style={styles.countText}>TAKES · {String(takes.length).padStart(2, "0")}</Text>
        <TouchableOpacity
          onPress={toggleSort}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={newestFirst ? "Showing newest first" : "Showing oldest first"}
        >
          <View style={styles.sortChip}>
            <Ionicons name="swap-vertical" size={11} color={ACCENT} />
            <Text style={styles.sortChipText}>{newestFirst ? "Newest" : "Oldest"}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* The stack — full-width cards with a small day caption when the day flips.
          Each card rides a TakeSwipeRow; swipe LEFT for the edge tabs
          (SPOILER · DELETE · SELECT, top to bottom, flush to the screen edge). */}
      <View style={styles.stack}>
        {sorted.map((item, i) => {
          const prev = sorted[i - 1];
          const showDay = !prev || dayKeyOf(prev.created_at) !== dayKeyOf(item.created_at);
          return (
            <Animated.View
              key={`take-${item.id}`}
              exiting={FadeOut.duration(140)}
              layout={SHIFT}
              style={styles.cardWrap}
            >
              {showDay && <Text style={styles.dayCaption}>{dayLabel(item.created_at)}</Text>}
              <TakeSwipeRow
                isOpen={openRowId === item.id}
                isSpoiler={item.is_spoiler === 1}
                tapGuardRef={swipeTapGuard}
                onOpen={() => setOpenRowId(item.id)}
                onClose={() => setOpenRowId((cur) => (cur === item.id ? null : cur))}
                onSelect={() => handleSwipeSelect(item)}
                onSpoiler={() => handleSwipeSpoiler(item)}
                onDelete={() => handleSwipeDelete(item)}
              >
                {renderCard(item)}
              </TakeSwipeRow>
            </Animated.View>
          );
        })}
      </View>

      {/* Batch bar — rides the bottom of the list while a selection is alive:
          count · MARK SPOILER · DELETE · ✕. Both verbs clear the selection. */}
      {selectedIds.size > 0 && (
        <Animated.View
          entering={FadeInDown.duration(160)}
          exiting={FadeOut.duration(120)}
          layout={SHIFT}
          style={styles.batchWrap}
        >
          <View style={styles.batchBar}>
            <Text style={styles.batchCount} numberOfLines={1}>
              {selectedIds.size} selected
            </Text>
            <TouchableOpacity
              onPress={batchSpoiler}
              accessibilityRole="button"
              accessibilityLabel={`Mark ${selectedIds.size} selected takes as spoilers`}
            >
              <View style={[styles.batchBtn, styles.batchBtnSpoiler]}>
                <Ionicons name="eye-off" size={12} color={AMBER} />
                <Text style={styles.batchBtnText}>Mark spoiler</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={batchDelete}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${selectedIds.size} selected takes`}
            >
              <View style={[styles.batchBtn, styles.batchBtnDelete]}>
                <Ionicons name="trash-outline" size={12} color={DANGER} />
                <Text style={styles.batchBtnText}>Delete</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={clearSelection}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Clear selection"
            >
              <View style={styles.batchX}>
                <Ionicons name="close" size={14} color="rgba(255,255,255,0.75)" />
              </View>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingTop: 4 },
  // --- Count + sort ---
  listHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 6,
    paddingBottom: 10,
  },
  // Same micro-caps mono voice as the cards' TAKE NN label.
  countText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  sortChip: {
    height: 26,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  sortChipText: {
    color: ACCENT,
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  // --- The stack --- (bottom breathing room is owned by the ticket body)
  stack: { paddingTop: 10 },
  cardWrap: { marginBottom: 12 },
  dayCaption: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
    marginLeft: 2,
  },
  // --- Take card shell --- (matches the capture panel module on this screen)
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(12,12,16,0.45)",
    padding: 14,
  },
  // Selected for the batch: accent border, faint accent wash, slightly dimmed body.
  cardSelected: {
    backgroundColor: "rgba(156,202,223,0.05)",
    borderColor: "rgba(156,202,223,0.65)",
  },
  contentDim: { opacity: 0.72 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACCENT,
  },
  // The card's one metadata voice — take number + duration, mono-feel.
  chipMeta: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  // --- State chip ---
  chip: {
    height: 20,
    borderRadius: 999,
    paddingHorizontal: 8,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  chipDot: { width: 5, height: 5, borderRadius: 999 },
  chipText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  // --- In-flight body ---
  percentText: {
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "900",
    marginBottom: 8,
  },
  buildingTag: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 10,
  },
  // --- Failed body ---
  errorText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 8,
  },
  failCopy: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  // --- Complete body: the hero quote ---
  quoteWrap: {
    marginTop: 8,
  },
  // Oversized ghost quotation mark riding behind the quote's first line.
  ghostQuote: {
    position: "absolute",
    top: -12,
    left: -4,
    fontSize: 40,
    lineHeight: 44,
    color: "rgba(255,255,255,0.12)",
  },
  heroQuote: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 16,
    fontStyle: "italic",
    fontWeight: "300",
    lineHeight: 23,
  },
  // Summary still owed: the transcript's first line stands in, a shade quieter.
  heroQuoteFallback: {
    color: "rgba(255,255,255,0.7)",
  },
  // --- Title line (the rename affordance) ---
  titleLine: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 8,
  },
  titleInput: {
    color: TICKET_INK,
    fontSize: 13,
    fontWeight: "600",
    paddingVertical: 2,
    padding: 0,
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(156,202,223,0.45)",
  },
  // Off-topic ruling box — amber question, two quiet verbs.
  offTopicBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(224,179,90,0.45)",
    backgroundColor: "rgba(224,179,90,0.08)",
    padding: 10,
    gap: 6,
    marginBottom: 10,
  },
  offTopicHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  offTopicTitle: {
    color: INK_AMBER,
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  offTopicCopy: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11.5,
    lineHeight: 16,
  },
  offTopicRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  offTopicTouch: {
    flex: 1,
  },
  offTopicBtn: {
    height: 30,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  offTopicBtnText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 1,
  },
  summaryText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 16,
    marginTop: 10,
  },
  transcriptText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  // Expanded = actually being READ — real reading type, unmistakably brighter.
  transcriptTextExpanded: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    lineHeight: 19,
  },
  // --- Footer row: play chip · whisper wave · caps tag ---
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  playChip: {
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: "transparent",
  },
  playChipText: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  waveSlot: {
    flex: 1,
    height: 20,
    justifyContent: "center",
  },
  staticWave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 10,
  },
  staticWaveBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  footerTag: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  // --- Spoiler frost + stamp --- (the text stays mounted; this covers the body)
  frostPane: {
    ...StyleSheet.absoluteFillObject,
    // Slight top outset so the ghost quote's overhang can't peek above the frost.
    top: -4,
    backgroundColor: "rgba(18,18,24,0.94)",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stamp: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: AMBER,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  stampTitle: {
    color: AMBER,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },
  stampSub: {
    color: "rgba(224,179,90,0.7)",
    fontSize: 7.5,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: 2,
  },
  // --- Playback line ---
  wave: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 20,
  },
  waveBar: {
    width: 2.5,
    height: 18,
    borderRadius: 1.25,
    backgroundColor: "rgba(156,202,223,0.8)",
  },
  // --- Batch bar --- (glass, same radius/border/fill family as the cards)
  batchWrap: {
    marginTop: 2,
    marginBottom: 10,
  },
  batchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(12,12,16,0.45)",
  },
  batchCount: {
    flex: 1,
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  batchBtn: {
    height: 28,
    borderRadius: 8,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
  },
  batchBtnSpoiler: {
    borderColor: "rgba(224,179,90,0.45)",
    backgroundColor: "rgba(224,179,90,0.1)",
  },
  batchBtnDelete: {
    borderColor: "rgba(232,114,104,0.45)",
    backgroundColor: "rgba(232,114,104,0.1)",
  },
  batchBtnText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  batchX: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  empty: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 50 },
  emptyText: { color: "rgba(255,255,255,0.7)", fontSize: 15, fontWeight: "600" },
  emptyHint: { color: "rgba(255,255,255,0.4)", fontSize: 13 },
});
