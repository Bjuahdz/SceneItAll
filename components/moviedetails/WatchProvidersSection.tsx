import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { fetchWatchProviders, type MovieWatchProviders, type WatchProvider } from '@/services/api';

const COOKIE = 40;

const logoUrl = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w92${p}` : null);

// Collapse TMDB's brand variants onto one canonical name — "Amazon Prime Video with Ads",
// "MGM+ Amazon Channel", "MGM Plus Roku Premium Channel" and "MGM Plus" are all one brand.
const canonicalName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\+/g, ' plus')
    .replace(/\b(amazon|apple tv|roku premium|roku)\s+channel(s)?\b/g, '')
    .replace(/\bwith ads\b/g, '')
    .replace(/\bstandard\b/g, '')
    .replace(/\bpremium\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * WatchProvidersSection — "Where to watch" as a plain, evenly-spaced grid of provider
 * logos (US only, deduped across stream/rent/buy and across brand variants). No stack,
 * no animation, no toggles — every provider is simply visible, consistently, always.
 */
export default function WatchProvidersSection({ movieId }: { movieId: string }) {
  const [providers, setProviders] = useState<MovieWatchProviders | null>(null);

  useEffect(() => {
    let alive = true;
    fetchWatchProviders(movieId).then((result) => {
      if (alive) setProviders(result);
    });
    return () => {
      alive = false;
    };
  }, [movieId]);

  // One flat, duplicate-free list — deduped by id AND canonical brand (TMDB repeats
  // brands across methods, ad tiers and channel storefronts). Streaming leads, then
  // rent, then buy.
  const all = useMemo<WatchProvider[]>(() => {
    if (!providers) return [];
    const seenIds = new Set<number>();
    const seenBrands = new Set<string>();
    const out: WatchProvider[] = [];
    for (const p of [...providers.flatrate, ...providers.rent, ...providers.buy]) {
      const brand = canonicalName(p.provider_name);
      if (seenIds.has(p.provider_id) || seenBrands.has(brand)) continue;
      seenIds.add(p.provider_id);
      seenBrands.add(brand);
      out.push(p);
    }
    return out;
  }, [providers]);

  if (all.length === 0) return null;

  return (
    <View style={styles.band}>
      <Text style={styles.bandLabel}>
        Where to watch <Text style={styles.region}>· {providers?.region ?? 'US'}</Text>
      </Text>

      {/* Bare logo tiles — no circle chrome, just the provider art (their logos are
          app-icon squares, so a soft corner radius is all the shaping they need).
          Only the no-logo initial fallback keeps a quiet backing chip. */}
      <View style={styles.grid}>
        {all.map((p) => {
          const url = logoUrl(p.logo_path);
          return url ? (
            <Image
              key={p.provider_id}
              source={{ uri: url }}
              style={styles.providerLogo}
              contentFit="cover"
              transition={120}
              cachePolicy="memory-disk"
              accessibilityLabel={p.provider_name}
            />
          ) : (
            <View key={p.provider_id} style={styles.providerFallback} accessibilityLabel={p.provider_name}>
              <Text style={styles.providerInitial}>{p.provider_name.charAt(0)}</Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.attribution}>Streaming availability by JustWatch</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches the Details card's band chrome. No top border — since the snapshot
  // moved up to the ticket stub, this band LEADS the bento card.
  band: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  bandLabel: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 14,
  },
  region: {
    color: 'rgba(255,255,255,0.28)',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  providerLogo: {
    width: COOKIE,
    height: COOKIE,
    borderRadius: 10,
  },
  providerFallback: {
    width: COOKIE,
    height: COOKIE,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  providerInitial: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontWeight: '700',
  },
  attribution: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    marginTop: 14,
    textAlign: 'right',
  },
});
