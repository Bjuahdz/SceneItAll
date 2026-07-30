import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { WatchProvider } from '@/services/api';

const COOKIE = 40;

const logoUrl = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w92${p}` : null);

/**
 * WatchProvidersSection — "Where to watch" as a plain, evenly-spaced grid of provider
 * logos. No stack, no animation, no toggles — every provider is simply visible,
 * consistently, always.
 *
 * PRESENTATION ONLY. The fetching and deduping live in useWatchProviders, because the
 * Details card has to know whether this band will have anything in it before it draws
 * its own border. That makes the CARD the single owner of the "is there anything here?"
 * decision — this component renders whatever list it is handed and does not second-guess
 * it, so there is only ever one place that answer is made.
 */
export default function WatchProvidersSection({
  providers,
  region,
}: {
  providers: WatchProvider[];
  region: string;
}) {
  return (
    <View style={styles.band}>
      <Text style={styles.bandLabel}>
        Where to watch <Text style={styles.region}>· {region}</Text>
      </Text>

      {/* Bare logo tiles — no circle chrome, just the provider art (their logos are
          app-icon squares, so a soft corner radius is all the shaping they need).
          Only the no-logo initial fallback keeps a quiet backing chip. */}
      <View style={styles.grid}>
        {providers.map((p) => {
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
  // Padding only. The hairline between bands is owned by the card's band wrapper, so
  // this component never needs to know whether anything sits above it.
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
