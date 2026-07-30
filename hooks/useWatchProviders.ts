import { useEffect, useMemo, useState } from 'react';
import { fetchWatchProviders, type MovieWatchProviders, type WatchProvider } from '@/services/api';

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

export interface WatchAvailability {
  /** Deduped and ordered: streaming first, then rent, then buy. Empty until the fetch lands. */
  providers: WatchProvider[];
  /** The region TMDB answered for, e.g. "US". */
  region: string;
}

/**
 * "Where to watch" for one film, as DATA rather than as a rendered band.
 *
 * Split out of WatchProvidersSection so the Details card can ask whether anything is
 * going to render BEFORE it draws its own border. The section used to own the fetch and
 * return null when a film had no availability, which meant a film with no providers, no
 * votes and no box office drew an empty bordered box — the card had no way to know it
 * was about to be empty.
 *
 * One request per mount, unchanged from before: this hook is called from the same place
 * in the tree the section used to sit, so nothing fetches more often than it did.
 *
 * NO `resolved` FLAG. There was one, and nothing ever read it: an empty `providers` is
 * already the only thing a caller can act on, because "still loading" and "came back
 * with nothing" render identically — the band is absent either way. The flag only bought
 * an extra render per fetch.
 */
export function useWatchProviders(movieId: string): WatchAvailability {
  const [result, setResult] = useState<MovieWatchProviders | null>(null);

  useEffect(() => {
    let alive = true;
    // A different film makes the previous answer stale — clear it so one movie's
    // providers can never sit under another movie's title, even for a frame.
    setResult(null);
    // fetchWatchProviders catches its own failures and resolves null, so there is nothing
    // to catch here. A failed request is indistinguishable from "no availability", which
    // is the right outcome either way: we show nothing rather than guess.
    fetchWatchProviders(movieId).then((r) => {
      if (!alive) return;
      setResult(r);
    });
    return () => {
      alive = false;
    };
  }, [movieId]);

  // One flat, duplicate-free list — deduped by id AND canonical brand (TMDB repeats
  // brands across methods, ad tiers and channel storefronts).
  const providers = useMemo<WatchProvider[]>(() => {
    if (!result) return [];
    const seenIds = new Set<number>();
    const seenBrands = new Set<string>();
    const out: WatchProvider[] = [];
    for (const p of [...result.flatrate, ...result.rent, ...result.buy]) {
      const brand = canonicalName(p.provider_name);
      if (seenIds.has(p.provider_id) || seenBrands.has(brand)) continue;
      seenIds.add(p.provider_id);
      seenBrands.add(brand);
      out.push(p);
    }
    return out;
  }, [result]);

  return { providers, region: result?.region ?? 'US' };
}
