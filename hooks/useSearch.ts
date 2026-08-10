import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";

import { useSearchIsland } from "@/contexts/SearchIslandContext";
import {
  searchEntities,
  enrichSubmitted,
  didYouMean,
  isAbort,
  type SearchResult,
} from "@/services/search";

// Long enough that a fast typist fires one request instead of one per keystroke,
// short enough that a deliberate typist doesn't feel it.
const DEBOUNCE_MS = 350;

/**
 * The Search tab's state machine.
 *
 *   idle        no query
 *   debouncing  the query changed and we are waiting out DEBOUNCE_MS
 *   fetching    a request is in flight
 *   results     the last request returned rows
 *   empty       the last request returned nothing
 *   error       the last request failed (cancellations are not failures)
 *
 * `submitted` is deliberately ORTHOGONAL to the phase, not another value of it —
 * the boards need submitted+results (R1/R2/R3) and submitted+empty (ZERO RESULTS)
 * to be expressible at the same time.
 */
export type SearchPhase =
  | "idle"
  | "debouncing"
  | "fetching"
  | "results"
  | "empty"
  | "error";

export interface SearchState {
  /** The live, trimmed query. */
  query: string;
  phase: SearchPhase;
  /** Rows from the last SUCCESSFUL request — held across a re-fetch so the list
   *  doesn't blank out on every keystroke. */
  results: SearchResult[];
  /** Which query `results` belong to. The response carries its own stamp so the
   *  UI can never caption one query's rows with another query's text. */
  resultsQuery: string;
  /** TMDB's total for the last successful query — the header's "N FOUND". */
  total: number;
  /**
   * True when the results should render as the ACCORDION — query echo, best match
   * auto-expanded — rather than the text-only typing ladder.
   *
   * Two things raise it, and they mean the same thing to the user: they pressed the
   * keyboard's Search key, OR the keyboard went away. Both are "I have stopped
   * typing, let me look at these properly".
   */
  submitted: boolean;
  error: string | null;
  /** Truncate-and-retry suggestions. Only ever populated in the zero-result case. */
  suggestions: SearchResult[];
  /** True while the keyboard is up, i.e. the user is composing a query. Surfaces so
   *  the lists can close their open marquee — a 380px face beside a blinking caret
   *  competes with the thing the user is trying to think of. */
  keyboardUp: boolean;
  /** Wipes the query AND brings the keyboard back — the zero-results CTA is one
   *  action, not two, because a dead end that clears but leaves you staring at a
   *  closed keyboard has only done half the job. */
  clear: () => void;
}

export function useSearch(): SearchState {
  const { query, submitTick, setQuery, focusInput } = useSearchIsland();
  const trimmed = query.trim();

  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsQuery, setResultsQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The EXPLICIT act: they pressed Search. Reset by typing again.
  const [submittedByKey, setSubmittedByKey] = useState(false);
  // Seeded from the live keyboard so a re-mount while typing does not briefly flip
  // the list into the accordion and back.
  const [keyboardUp, setKeyboardUp] = useState(() => Keyboard.isVisible());
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);

  // Request identity AND an abort controller, because they close different windows:
  // the controller stops the network, while the id check stops a response that had
  // already resolved before the abort landed. Either alone still lets a stale set
  // through under fast typing.
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // The query we last actually ISSUED, so returning to it (backspacing "dunee" to
  // "dune") re-uses what we have instead of spending the request again.
  const lastIssuedRef = useRef("");
  // Which result set has already been enriched / had suggestions fetched. Reset
  // inside run()'s success handler, because a new result set invalidates both.
  const enrichedForRef = useRef("");
  const suggestedForRef = useRef("");

  /**
   * Present the accordion when the user has stopped typing — by pressing Search, or
   * simply by putting the keyboard away.
   *
   * Collapsing both acts into one flag is deliberate: the user does not experience
   * "submitted" and "dismissed the keyboard" as different modes, and having two
   * presentations for the same intent was the inconsistency that made a typing row
   * navigate while an identical-looking submitted row expanded.
   */
  const submitted = submittedByKey || !keyboardUp;

  // Invalidate whatever is in flight. Bumping the id first means a response that is
  // already resolving is discarded even though its abort arrives too late.
  const supersede = useCallback(() => {
    reqIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const run = useCallback((q: string) => {
    supersede();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = reqIdRef.current;

    setPhase("fetching");
    setError(null);

    searchEntities(q, controller.signal)
      .then(({ results: rows, total: found }) => {
        if (id !== reqIdRef.current) return; // superseded — drop it silently
        // A FRESH result set has never been enriched and has no suggestions, even
        // when its query string matches one we handled before. Keying those guards
        // on the string alone meant backspacing back to an earlier query re-fetched
        // raw rows and then refused to enrich them, so collection and studio counts
        // silently vanished. Tie them to the result set instead.
        enrichedForRef.current = "";
        suggestedForRef.current = "";
        setResults(rows);
        setResultsQuery(q);
        setTotal(found);
        setPhase(rows.length > 0 ? "results" : "empty");
      })
      .catch((e) => {
        if (id !== reqIdRef.current) return;
        if (isAbort(e)) return; // our own cancellation, not a failure
        // Let the next keystroke retry instead of being skipped as "already issued".
        lastIssuedRef.current = "";
        setError(e instanceof Error ? e.message : "Search failed");
        setPhase("error");
      });
  }, [supersede]);

  // ASYMMETRIC ON PURPOSE — each direction is timed for a different hazard.
  //
  // SHOWING uses `will` (iOS): the moment the keyboard starts rising we are
  // composing, so the open marquee must close NOW. Waiting for `did` — a full ~250ms
  // keyboard animation later — meant clearing the query flashed a 380px face on
  // screen and then yanked it away. Android has no `will` event, so it takes `did`;
  // there the collapse simply lands with the keyboard.
  //
  // HIDING uses `did` on both: promoting to the accordion expands that same marquee,
  // and firing on `will` would move content out from under a finger still mid-drag.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const show = Keyboard.addListener(showEvt, () => setKeyboardUp(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Typing again takes the user out of the submitted pose. Submitting does not
  // change the query, so this never fights the submit effect below.
  useEffect(() => {
    setSubmittedByKey(false);
  }, [trimmed]);

  useEffect(() => {
    if (trimmed.length === 0) {
      supersede();
      lastIssuedRef.current = "";
      setResults([]);
      setResultsQuery("");
      setTotal(0);
      setError(null);
      setPhase("idle");
      return;
    }

    // Every non-empty query searches. The old 4-character floor is gone — see the
    // note in services/search.ts: exact short titles (X, It, Up, A24) come back
    // fine and the ranking surfaces them, while the debounce below means a short
    // query only spends requests when the user actually pauses on it.
    if (trimmed === lastIssuedRef.current) return; // already have it / getting it

    setPhase("debouncing");
    const t = setTimeout(() => {
      // Submitting does not change `trimmed`, so this effect never re-runs and its
      // cleanup never fires — leaving a live timer for a query the submit path has
      // already issued. Without this guard it lands 350 ms later, spends three more
      // requests for rows already on screen, and (worse) supersedes the in-flight
      // submit enrichment, so collection and studio rows stay stuck at a bare label.
      if (trimmed === lastIssuedRef.current) return;
      lastIssuedRef.current = trimmed;
      run(trimmed);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed, run, supersede]);

  // Pressing Search bypasses the debounce — the user has already declared intent,
  // so making them wait out 350 ms would be pure latency.
  // Depends on submitTick ALONE on purpose: the effect body reads this render's
  // `trimmed`, and we only want it to fire on an actual submit, not on every keystroke.
  useEffect(() => {
    if (submitTick === 0) return; // initial value, not a real submit
    // An empty submit is not a search — backspacing to nothing and hitting the
    // Search key must not render the previous query's board.
    if (trimmed.length === 0) return;
    setSubmittedByKey(true);
    if (trimmed !== lastIssuedRef.current) {
      lastIssuedRef.current = trimmed;
      run(trimmed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitTick]);

  // Collection and studio film counts, bought only once the user has committed.
  // Runs after the results for the submitted query are in hand — which may be the
  // same tick as the submit, or later if the submit had to fire its own request.
  useEffect(() => {
    if (!submitted || phase !== "results") return;
    if (enrichedForRef.current === resultsQuery) return; // already paid for this query
    enrichedForRef.current = resultsQuery;

    const controller = new AbortController();
    const id = reqIdRef.current;
    enrichSubmitted(results, controller.signal)
      .then((rows) => {
        if (id !== reqIdRef.current) return; // a newer search superseded us
        setResults(rows);
      })
      .catch((e) => {
        if (!isAbort(e)) console.error("Submit enrichment failed:", e);
      });
    return () => controller.abort();
    // `results` is deliberately absent: setResults below would otherwise re-trigger
    // this effect, and the ref guard already makes it once-per-query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, phase, resultsQuery]);

  // (The most-searched ledger used to write here, at the submit moment — recording
  // the ranker's #1 guess. Bryan killed that 2026-08-10 after JURASSIC logged
  // Rebirth while he was choosing the Jurassic Park Collection: the write now
  // lives on the TAP, in search.tsx's onPickResult, where intent is announced
  // rather than inferred.)

  // DID YOU MEAN. Truncate-and-retry costs 1–3 requests, and they are spent only
  // here — at the one moment the user has nothing, which is when an extra request
  // is obviously worth it.
  useEffect(() => {
    if (phase !== "empty") {
      if (suggestions.length > 0) setSuggestions([]);
      return;
    }
    if (suggestedForRef.current === resultsQuery) return;
    suggestedForRef.current = resultsQuery;

    const controller = new AbortController();
    const id = reqIdRef.current;
    didYouMean(resultsQuery, controller.signal)
      .then((rows) => {
        if (id !== reqIdRef.current) return;
        setSuggestions(rows);
      })
      .catch((e) => {
        if (!isAbort(e)) console.error("Did-you-mean failed:", e);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, resultsQuery]);

  // Leaving the screen must not leave a request running against a dead component.
  useEffect(() => () => supersede(), [supersede]);

  const clear = useCallback(() => {
    setQuery("");
    focusInput();
  }, [setQuery, focusInput]);

  return {
    query: trimmed,
    phase,
    results,
    resultsQuery,
    total,
    submitted,
    error,
    suggestions,
    keyboardUp,
    clear,
  };
}
