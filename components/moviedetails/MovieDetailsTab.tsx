import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { MovieDetails } from '../../interfaces/interfaces';
import PersonCard, { type Person } from '../people/PersonCard';
import WatchProvidersSection from './WatchProvidersSection';
import { useWatchProviders } from '@/hooks/useWatchProviders';
import { useEntityOverlay } from '@/contexts/EntityOverlayContext';
import { useSheetLineage } from '@/contexts/MovieSheetContext';
import { prefetchEntity } from '@/services/entities';

import { TICKET_ACCENT, INK_GREEN, INK_RED } from './ticketTheme';

const ACCENT = TICKET_ACCENT;
const profileUrl = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w185${p}` : null);

// TMDB's stacked mark, used once at the foot of the bento to credit everything in it.
// Height drives width off the asset's own viewBox so the aspect can never drift.
const TMDB_MARK_ASPECT = 190.24 / 81.52;
const TMDB_MARK_H = 15;
const TMDB_MARK_W = Math.round(TMDB_MARK_H * TMDB_MARK_ASPECT);

/** 3481 → "3,481". Hermes' Intl is not dependable across platforms, so group by hand. */
const withThousands = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Studio strip: uniform slot width → clean logo-to-logo snapping.
const STUDIO_SLOT_W = 140;
const STUDIO_GAP = 22;

/** A column cell: tiny label, value beneath. Used by the stat rows (top + box office). */
// How many filmmaker rows show before the list folds behind a "Show all" toggle.
const FILMMAKERS_PREVIEW = 3;

/**
 * SectionHeader — anchors the open-air sections below the bento box: a centered caps
 * label flanked by hairline rules (the same device the ENTRIES timeline uses for its
 * dates), so loose sections read as deliberate chapters instead of floating text.
 */
const SectionHeader = ({ label }: { label: string }) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionRule} />
    <Text style={styles.sectionLabel}>{label}</Text>
    <View style={styles.sectionRule} />
  </View>
);

/**
 * StudiosStrip — the snapping one-row studio swipe. The edge fades + chevrons are
 * scroll-aware: the right hint shows only while more content exists that way, and at
 * the end only the left hint remains (swipe back). Nothing renders when it all fits.
 */
const StudiosStrip = ({ children }: { children: React.ReactNode }) => {
  const [x, setX] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [frameW, setFrameW] = useState(0);
  const showLeft = x > 6;
  const showRight = contentW - frameW - x > 6;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={STUDIO_SLOT_W + STUDIO_GAP}
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={(e) => setX(e.nativeEvent.contentOffset.x)}
        scrollEventThrottle={32}
        onContentSizeChange={(w) => setContentW(w)}
        onLayout={(e) => setFrameW(e.nativeEvent.layout.width)}
        contentContainerStyle={styles.studioRowScroll}
      >
        {children}
      </ScrollView>
      {/* Bare chevrons — no gradient backing (the dark fade read as a smudgy shadow). */}
      {showLeft && (
        <View style={styles.studioChevronLeft} pointerEvents="none">
          <Ionicons name="chevron-back" size={13} color="rgba(255,255,255,0.35)" />
        </View>
      )}
      {showRight && (
        <View style={styles.studioChevronRight} pointerEvents="none">
          <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.35)" />
        </View>
      )}
    </View>
  );
};

/** A filmmaker row's data: the shared Person shape plus the RAW TMDB profile
 *  path — the page's hero seed wants the path, not the sized URL. */
type Filmmaker = Person & { id: number; profilePath: string | null };

/**
 * Filmmakers — B2 · PORTRAIT CHIP (Bryan's ruling, 2026-08-13, Paper board
 * "build from this"): each row is the shared PersonCard's row variant — a
 * 42×56 chip ahead of the name, role on the right — and EVERY ROW IS A DOOR,
 * the same contract as the cast grid: tap → the person's full-screen page,
 * grown out of the chip when there is a photograph to grow (an initials chip
 * just opens — the wordmark rule). More than three still folds behind the
 * "Show all" row.
 */
const FilmmakersList = ({ people }: { people: Filmmaker[] }) => {
  const [open, setOpen] = useState(false);
  const { open: openPage } = useEntityOverlay();
  // Who this sheet is sitting on — the loop guard's one input (see the cast
  // tab, whose contract this mirrors verbatim).
  const lineage = useSheetLineage();
  const visible = open ? people : people.slice(0, FILMMAKERS_PREVIEW);
  const hasMore = people.length > FILMMAKERS_PREVIEW;

  return (
    <View>
      {visible.map((p) => (
        <PersonCard
          key={p.id}
          person={p}
          variant="row"
          onPress={(rect, remeasure) => {
            // ▸ THE LOOP GUARD: tapping the director whose page pushed this
            // very film folds the sheet back down to their page instead of
            // stacking a duplicate of where you came from.
            if (lineage?.beneath?.kind === 'person' && lineage.beneath.id === p.id) {
              lineage.dismissSheet();
              return;
            }
            // Requests start NOW, so the fetch runs alongside the grow.
            prefetchEntity('person', p.id);
            openPage({
              kind: 'person',
              id: p.id,
              seed: p.profilePath ? { imagePath: p.profilePath, name: p.name } : null,
              origin: p.profilePath ? rect : null,
              remeasureOrigin: p.profilePath && rect ? remeasure : undefined,
            });
          }}
        />
      ))}
      {hasMore && (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setOpen((v) => !v);
          }}
          hitSlop={8}
          style={styles.fmMoreBtn}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Show fewer filmmakers' : `Show all ${people.length} filmmakers`}
        >
          <Text style={styles.fmMoreText}>{open ? 'Show less' : `Show all ${people.length}`}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={13} color={ACCENT} />
        </Pressable>
      )}
    </View>
  );
};

/**
 * One cell of a bento stat row: micro label above, value beneath, centred.
 *
 * numberOfLines={1} on the label is deliberate. A label that wraps makes its cell taller
 * than its neighbours, which breaks the lane the whole row reads along — better to
 * truncate on a narrow device than to reflow the row.
 */
const Stat = ({
  label,
  value,
  valueColor,
  muted,
}: { label: string; value: string; valueColor?: string; muted?: boolean }) => (
  <View style={styles.stat}>
    <Text numberOfLines={1} style={styles.microLabel}>
      {label}
    </Text>
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      style={[
        styles.statValue,
        muted && styles.statValueMuted,
        // Last so an explicit colour always wins over the muted default.
        !!valueColor && { color: valueColor },
      ]}
    >
      {value}
    </Text>
  </View>
);

/**
 * MovieDetailsTab — the "Details" tab: the facts about a film and the people who
 * made it. Everything flows to fill the width, so a film with one filmmaker and
 * one studio looks as deliberate as one with six — no fixed strips, no dead space.
 *   1. Snapshot   — date + status, the glanceable stats, genres as a quiet line.
 *   2. Filmmakers — director + writers as B2 chip rows (a face ahead of every
 *                   name), each row a door to the person's page.
 *   3. Watch      — where it streams / rents / buys (JustWatch data via TMDB).
 *   4. Studios    — every production company's mark, each a door to the
 *                   studio's page (no grow — the wordmark rule).
 *   5. Box office — budget / revenue / profit, muted, at the foot.
 */
const MovieDetailsTab = ({ movie }: { movie: MovieDetails }) => {
  // (The snapshot facts — date, runtime, rating, language, genres — moved up to
  // the ticket's stub in [id].tsx; this tab owns the deeper dive.)

  // Filmmakers: director(s) + writers merged by person, so a director who also
  // wrote shows once with a combined role ("Director · Screenplay").
  const fmMap = new Map<number, { id: number; name: string; profile_path: string | null; roles: string[] }>();
  (movie.directors ?? []).forEach((d) => {
    if (!fmMap.has(d.id)) fmMap.set(d.id, { id: d.id, name: d.name, profile_path: d.profile_path, roles: [] });
    fmMap.get(d.id)!.roles.push('Director');
  });
  (movie.writers ?? []).forEach((w) => {
    if (!fmMap.has(w.id)) fmMap.set(w.id, { id: w.id, name: w.name, profile_path: w.profile_path, roles: [] });
    fmMap.get(w.id)!.roles.push(w.job);
  });
  const filmmakers: Filmmaker[] = Array.from(fmMap.values()).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.roles.join(' · '),
    imageUrl: profileUrl(p.profile_path),
    // The raw path rides along for the page's hero seed — seeds want TMDB
    // paths, not the w185 URL the chip renders.
    profilePath: p.profile_path,
  }));

  // Studios: deduped by NAME (TMDB lists the same company under multiple ids/regions),
  // logo-first so the recognisable ones lead.
  const seenStudioNames = new Set<string>();
  const studios = [...(movie.production_companies ?? [])]
    .sort((a, b) => Number(!!b.logo_path) - Number(!!a.logo_path))
    .filter((s) => {
      const key = s.name.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenStudioNames.has(key)) return false;
      seenStudioNames.add(key);
      return true;
    });

  const hasBoxOffice = movie.budget > 0 || movie.revenue > 0;
  const profitColor = movie.formattedProfit?.startsWith('-') ? INK_RED : INK_GREEN;

  // Gated on the vote COUNT, not the average: TMDB reports an unrated film as 0 votes and
  // a 0.0 average, and printing "0.0" reads as a terrible score rather than as no score.
  // The average is checked too because it is the one value here read via a method —
  // `undefined > 0` is merely false, but `undefined.toFixed()` throws.
  const hasScore = movie.vote_count > 0 && Number.isFinite(movie.vote_average);

  // Where to watch, as data — so the card below can decide whether it has anything to
  // draw a border around before it draws one.
  const { providers, region } = useWatchProviders(String(movie.id));

  // The studio taps' door + loop guard (the filmmakers list carries its own —
  // it is a separate component with the same two hooks).
  const { open: openPage } = useEntityOverlay();
  const lineage = useSheetLineage();

  // The bento's bands, in reading order. Built as a list so the hairline BETWEEN bands is
  // decided in exactly one place: the first band never carries a rule (it would sit right
  // under the card's own border), and dropping any band cannot leave a stray rule behind.
  // Each node brings its own padding; the divider is applied by the wrapper below.
  const bands: { id: string; node: React.ReactNode }[] = [];

  if (providers.length > 0) {
    bands.push({
      id: 'watch',
      node: <WatchProvidersSection providers={providers} region={region} />,
    });
  }

  // The rating lives HERE rather than up in the stub's action block: it is a fact about
  // the film, and the card is where the facts are. It gets its own band — five cells in
  // one row read as a wall of numbers, and a score has nothing to do with a budget.
  if (hasScore) {
    bands.push({
      id: 'score',
      node: (
        <View style={styles.band}>
          <View style={styles.statRow}>
            <Stat label="Score" value={movie.vote_average.toFixed(1)} />
            <View style={styles.statDivider} />
            <Stat label="Votes" value={withThousands(movie.vote_count)} muted />
          </View>
        </View>
      ),
    });
  }

  // Box office — three figures that only mean anything next to each other.
  if (hasBoxOffice) {
    bands.push({
      id: 'money',
      node: (
        <View style={styles.band}>
          <View style={styles.statRow}>
            <Stat label="Budget" value={movie.formattedBudget} muted />
            <View style={styles.statDivider} />
            <Stat label="Revenue" value={movie.formattedRevenue} muted />
            <View style={styles.statDivider} />
            <Stat label="Profit" value={movie.formattedProfit} valueColor={profitColor} muted />
          </View>
        </View>
      ),
    });
  }

  return (
    <View>
      {/* The bento box. (The snapshot — date, stats, genres — moved UP to the ticket's
          stub so it needs zero scrolling.) It renders only when it has something in it:
          a film with no availability, no votes and no box office used to draw an empty
          bordered box. */}
      {bands.length > 0 && (
        <View style={styles.card}>
          {bands.map(({ id, node }, i) => (
            <View key={id} style={i > 0 ? styles.bandTop : undefined}>
              {node}
            </View>
          ))}

          {/* Credits the whole card, not just the rating — providers, votes and money all
              come from the same place. Always has a band above it, so its rule is always
              correct and it can never be the only thing inside the card. */}
          <View style={[styles.credit, styles.bandTop]}>
            <Text style={styles.creditLabel}>Sourced from</Text>
            <Image
              source={require('../../assets/images/TMDB LOGO_V2.svg')}
              style={styles.creditMark}
              contentFit="contain"
            />
          </View>
        </View>
      )}

      {/* Filmmakers — B2 chip rows (collapsible past three), open air; every
          row opens the person's page, grown out of its chip. */}
      {filmmakers.length > 0 && (
        <View style={styles.openSection}>
          <SectionHeader label="Filmmakers" />
          <FilmmakersList people={filmmakers} />
        </View>
      )}

      {/* Studios — one row at the foot: monochrome logos (white-tint silhouette + a
          faint untinted layer so solid badge/box marks keep their interior detail
          instead of blobbing pure white), letterspaced wordmarks when a company has
          no logo art. A few studios sit centered; more becomes a single-row swipe. */}
      {studios.length > 0 && (
        <View style={styles.openSection}>
          <SectionHeader label={studios.length === 1 ? 'Studio' : 'Studios'} />
          {(() => {
            // Uniform fixed-width slots so the swipe snaps cleanly logo-to-logo and
            // nothing is ever cut mid-mark.
            const slots = studios.map((studio) => {
              const logo = studio.logo_path ? `https://image.tmdb.org/t/p/w300${studio.logo_path}` : null;
              return (
                // ▸ EVERY MARK IS A DOOR TOO (same ruling): tap → the studio's
                // page. NO grow — the wordmark rule: logos don't stretch into
                // heroes, so the page uses the no-origin entrance search's
                // text rows ship with. A styled Pressable is fine here for the
                // same reason: no touch-derived rect is being read off it.
                <Pressable
                  key={studio.id}
                  style={styles.studioSlot}
                  onPress={() => {
                    // Loop guard, symmetric with people: tapping the studio
                    // whose page pushed this film folds back down to it.
                    // (The entity kind is 'company' — TMDB's own noun; search
                    // only SAYS "studio" in its captions.)
                    if (lineage?.beneath?.kind === 'company' && lineage.beneath.id === studio.id) {
                      lineage.dismissSheet();
                      return;
                    }
                    prefetchEntity('company', studio.id);
                    openPage({
                      kind: 'company',
                      id: studio.id,
                      // No seed, matching search's company rows exactly — a
                      // logo is not hero artwork ("never a TMDB logo",
                      // services/search.ts), and the company page paints its
                      // own header from the fetch.
                      seed: null,
                      origin: null,
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={studio.name}
                >
                  {logo ? (
                    // B&W duotone, Expo-Go safe (no pixel filters available): the
                    // tinted layer is the black-and-white look; the low-opacity
                    // native layer only matters inside solid marks, where it
                    // restores the detail the tint erases.
                    <View style={styles.studioLogoStack}>
                      <Image
                        source={{ uri: logo }}
                        style={styles.studioLogo}
                        contentFit="contain"
                        transition={150}
                        cachePolicy="memory-disk"
                        tintColor="rgb(255, 255, 255)"
                      />
                      <Image
                        source={{ uri: logo }}
                        style={[styles.studioLogo, styles.studioLogoDetail]}
                        contentFit="contain"
                        transition={150}
                        cachePolicy="memory-disk"
                      />
                    </View>
                  ) : (
                    <Text style={styles.studioWordmark}>
                      {studio.name}
                    </Text>
                  )}
                </Pressable>
              );
            });

            // 1–2 studios fit as-is → centered, no scroll chrome.
            if (studios.length <= 2) {
              return <View style={styles.studioRowCentered}>{slots}</View>;
            }

            // More → the snapping swipe with scroll-aware edge hints.
            return <StudiosStrip>{slots}</StudiosStrip>;
          })()}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  band: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  bandTop: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  // Open-air sections below the bento — same 24pt gap as Extras sections.
  openSection: {
    paddingHorizontal: 18,
    paddingTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  sectionRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  microLabel: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 7,
  },

  // Stat row (box office)
  statRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  statValue: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    fontWeight: '600',
  },
  statValueMuted: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 14,
    fontWeight: '400',
  },
  statDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },

  // Attribution strip at the foot of the bento. Quiet on purpose — it is a credit, not
  // a row of data, so it sits below the last hairline and asks for nothing.
  credit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 10,
  },
  creditLabel: {
    color: 'rgba(255,255,255,0.34)',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  creditMark: {
    width: TMDB_MARK_W,
    height: TMDB_MARK_H,
  },

  // Filmmakers — rows are the shared PersonCard's B2 chip rows now; only the
  // fold toggle's chrome still lives here.
  fmMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 8,
  },
  fmMoreText: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '600',
  },
  // Studios — one-row foot strip, no panels.
  studioSlot: {
    width: STUDIO_SLOT_W,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studioRowCentered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: STUDIO_GAP,
  },
  studioRowScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: STUDIO_GAP,
    paddingHorizontal: 20, // room so edge logos clear the fades
  },
  studioLogoStack: {
    width: STUDIO_SLOT_W,
    height: 38,
  },
  studioLogo: {
    width: STUDIO_SLOT_W,
    height: 38,
  },
  // The native-color layer over the white silhouette. Tune this opacity to trade
  // "purely monochrome" against "how much interior detail survives in solid logos".
  studioLogoDetail: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0.35,
  },
  // Letterspaced wordmark for companies with no logo art — same print voice as the
  // ticket's section labels. Wraps freely inside the slot so no name is ever cut off.
  studioWordmark: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: STUDIO_SLOT_W,
  },
  // Bare chevrons — the quiet "swipe for more" cue.
  studioChevronLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  studioChevronRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});

export default MovieDetailsTab;
