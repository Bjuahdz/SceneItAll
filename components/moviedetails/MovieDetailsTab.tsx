import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { MovieDetails } from '../../interfaces/interfaces';
import type { Person } from '../people/PersonCard';
import WatchProvidersSection from './WatchProvidersSection';

import { TICKET_ACCENT, INK_GREEN, INK_RED } from './ticketTheme';

const ACCENT = TICKET_ACCENT;
const profileUrl = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w185${p}` : null);

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

/**
 * Filmmakers as a plain, quiet list — name left, role right. More than three folds
 * into a collapsible with a "Show all" row (no photos, no bios: just who did what).
 */
const FilmmakersList = ({ people }: { people: Person[] }) => {
  const [open, setOpen] = useState(false);
  const visible = open ? people : people.slice(0, FILMMAKERS_PREVIEW);
  const hasMore = people.length > FILMMAKERS_PREVIEW;

  return (
    <View>
      {visible.map((p) => (
        <View key={p.id} style={styles.fmRow}>
          <Text style={styles.fmName} numberOfLines={1}>
            {p.name}
          </Text>
          <Text style={styles.fmRole} numberOfLines={1}>
            {p.role}
          </Text>
        </View>
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

const Stat = ({
  label,
  value,
  valueColor,
  muted,
}: { label: string; value: string; valueColor?: string; muted?: boolean }) => (
  <View style={styles.stat}>
    <Text style={styles.microLabel}>{label}</Text>
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      style={[styles.statValue, muted && styles.statValueMuted, !!valueColor && { color: valueColor }]}
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
 *   2. Filmmakers — director + writers as vertical portrait cards with quick facts
 *                   (born · age · died); several people page one card at a time.
 *   3. Watch      — where it streams / rents / buys (JustWatch data via TMDB).
 *   4. Studios    — every production company on full-width logo panels, paged
 *                   one at a time like the filmmakers.
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
  const filmmakers: Person[] = Array.from(fmMap.values()).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.roles.join(' · '),
    imageUrl: profileUrl(p.profile_path),
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

  return (
    <View>
      {/* The bento box: where to watch + box office. (The snapshot — date, stats,
          genres — moved UP to the ticket's stub so it needs zero scrolling.) */}
      <View style={styles.card}>
        {/* Where to watch — renders only when TMDB/JustWatch has availability. */}
        <WatchProvidersSection movieId={String(movie.id)} />

        {/* Box office — part of the glanceable bento core. */}
        {hasBoxOffice && (
          <View style={[styles.band, styles.bandTop]}>
            <View style={styles.statRow}>
              <Stat label="Budget" value={movie.formattedBudget} muted />
              <View style={styles.statDivider} />
              <Stat label="Revenue" value={movie.formattedRevenue} muted />
              <View style={styles.statDivider} />
              <Stat label="Profit" value={movie.formattedProfit} valueColor={profitColor} muted />
            </View>
          </View>
        )}
      </View>

      {/* Filmmakers — a clean name · role list (collapsible past three), open air. */}
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
                <View key={studio.id} style={styles.studioSlot}>
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
                </View>
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

  // Filmmakers — plain rows: name left, role right.
  fmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 6,
  },
  fmName: {
    flex: 1,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14.5,
    fontWeight: '600',
  },
  fmRole: {
    flexShrink: 1,
    color: 'rgba(156,202,223,0.75)',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
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
