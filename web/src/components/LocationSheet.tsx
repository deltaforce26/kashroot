/**
 * Location sheet — the one place that answers "where am I searching from?".
 *
 * Opened from the pin or the address in the home header, which are two halves of the
 * same control. It offers the two origins a person names for themselves, in the order
 * they cost effort: the device position (one tap) and a typed address — and the way
 * out of both, "all of Israel", which drops the pin and shows every place we hold.
 * There is no city to pick: the app has no such concept.
 *
 * Every branch says something true. Address lookup needs the Google geocoder, so
 * without a browser key the field is not drawn at all rather than drawn dead — and
 * "we could not look that up" is kept distinct from "there is no such place",
 * because they call for different next moves. A refused location permission is not
 * an error: it is stated once, next to the button that asked, and never again.
 *
 * The field answers twice. While the user types it offers completions, and those are
 * quiet: half a word that matches nothing is not "no such place", and a completion
 * service that cannot be reached is not yet anybody's problem. Submitting is the
 * question asked out loud, and only that path says "not found" or "lookup failed".
 *
 * The sheet does not filter or rank anything. It moves the origin; the API re-answers.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CloseIcon, CrosshairIcon, PinIcon, SearchIcon } from "./icons";
import { useI18n } from "../i18n/I18nProvider";
import { useOrigin } from "../location/useOrigin";
import {
  geocodeAddress,
  hasMapsKey,
  suggestAddresses,
  type AddressSuggestion,
  type GeocodeCandidate,
} from "../map/useGoogleMaps";
import { MAX_QUERY_LENGTH } from "../api/types";

type Lookup =
  | { state: "idle" }
  | { state: "suggestions"; items: AddressSuggestion[] }
  | { state: "searching" }
  | { state: "done"; candidates: GeocodeCandidate[] }
  | { state: "failed" };

/** Long enough that a word typed at speed is one request, short enough to feel live. */
const SUGGEST_DEBOUNCE_MS = 250;

/** A single letter completes to everything, which is to say nothing. */
const SUGGEST_MIN_CHARS = 2;

/**
 * How long the sheet takes to leave. It must match `sheetLift` and `scrimClear` in
 * styles.css: the class starts the animation and this timer unmounts the component,
 * so a shorter timer would cut the slide off part-way and a longer one would leave
 * an invisible sheet sitting over the screen swallowing taps.
 */
const EXIT_MS = 180;

/**
 * Asked at the moment of closing rather than read once, because the setting can be
 * changed while the app is open. Under `reduce` the stylesheet draws no exit, so
 * there is nothing to wait out and the sheet goes at once.
 */
function exitDuration(): number {
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduced ? 0 : EXIT_MS;
}

export function LocationSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const { source, state, requestDeviceLocation, setAddressOrigin } =
    useOrigin();

  const [address, setAddress] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  // Only a permission answer that arrives while the sheet is open should close it;
  // a refusal recorded on an earlier screen must not slam the sheet shut on open.
  const askedRef = useRef(false);

  // Every way out runs through `close`, so the sheet cannot be unmounted from under
  // its own exit: the scrim, the X, Escape and a granted permission all ask to leave
  // and the timer below is the only thing that actually calls `onClose`.
  const [leaving, setLeaving] = useState(false);
  const close = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onClose, exitDuration());
    return () => window.clearTimeout(timer);
  }, [leaving, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (askedRef.current && state === "granted") close();
  }, [state, close]);

  // Completions answer out of order and after the user has moved on. Each typing
  // pause takes a number, and anything that supersedes it — more typing, a submit, a
  // pick — takes the next one, so a late answer finds it is no longer the one awaited.
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = address.trim();
    if (!hasMapsKey() || trimmed.length < SUGGEST_MIN_CHARS) return;
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      if (requestRef.current !== request) return;
      suggestAddresses(trimmed, lang).then(
        (items) => {
          if (requestRef.current !== request) return;
          setLookup(items.length > 0 ? { state: "suggestions", items } : { state: "idle" });
        },
        () => {
          // Silence, not `failed`: nothing was asked yet. Only completions for text
          // that is no longer in the field are taken down.
          if (requestRef.current !== request) return;
          setLookup((current) => (current.state === "suggestions" ? { state: "idle" } : current));
        },
      );
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [address, lang]);

  async function lookUpAddress(query: string) {
    requestRef.current += 1;
    setLookup({ state: "searching" });
    try {
      setLookup({ state: "done", candidates: await geocodeAddress(query, lang) });
    } catch {
      // No key, blocked script, offline, quota. The user does not need to know
      // which; they need to know the field cannot answer and the other ways can.
      setLookup({ state: "failed" });
    }
  }

  function pick(candidate: GeocodeCandidate) {
    setAddressOrigin(candidate.label, candidate.point);
    close();
  }

  async function pickSuggestion(item: AddressSuggestion) {
    requestRef.current += 1;
    setLookup({ state: "searching" });
    try {
      pick(await item.resolve());
    } catch {
      setLookup({ state: "failed" });
    }
  }

  const locating = state === "requesting";

  return (
    <>
      <button
        type="button"
        className={`sheet__scrim sheet__scrim--fade${
          leaving ? " sheet__scrim--leaving" : ""
        }`}
        aria-label={t.origin.close}
        onClick={close}
      />
      <section
        className={`sheet sheet--top${leaving ? " sheet--leaving" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t.origin.title}
      >
        <div className="sheet__head">
          <h2 className="sheet__title">{t.origin.title}</h2>
          <button
            type="button"
            className="circle circle--sm glass"
            aria-label={t.origin.close}
            onClick={close}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <button
          type="button"
          className="cta cta--ghost sheet__locate"
          aria-pressed={source === "device"}
          disabled={locating}
          onClick={() => {
            askedRef.current = true;
            requestDeviceLocation();
          }}
        >
          <CrosshairIcon size={16} />
          {locating ? t.origin.locating : t.origin.useMyLocation}
        </button>
        {hasMapsKey() && (
          <form
            className="searchbar glass sheet__address"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = address.trim();
              if (trimmed.length > 0) void lookUpAddress(trimmed);
            }}
          >
            <span className="searchbar__icon" aria-hidden="true">
              <SearchIcon size={17} />
            </span>
            <input
              type="text"
              className="searchbar__input"
              value={address}
              autoFocus
              autoComplete="off"
              onChange={(event) => {
                const next = event.target.value;
                setAddress(next);
                // Completions stay up until the next answer replaces them, so the list
                // does not blink on every key. Anything else on show was an answer to
                // text that is no longer in the field.
                setLookup((current) =>
                  current.state === "suggestions" && next.trim().length >= SUGGEST_MIN_CHARS
                    ? current
                    : { state: "idle" },
                );
              }}
              placeholder={t.origin.addressPlaceholder}
              aria-label={t.origin.addressLabel}
              maxLength={MAX_QUERY_LENGTH}
            />
            <button
              type="submit"
              className="searchbar__icon"
              aria-label={t.origin.addressSubmit}
              disabled={address.trim().length === 0}
            >
              <PinIcon size={17} />
            </button>
          </form>
        )}

        <div aria-live="polite">
          {lookup.state === "searching" && <p className="hint sheet__note">{t.origin.searching}</p>}
          {lookup.state === "failed" && (
            <p className="hint sheet__note">{t.origin.lookupFailed}</p>
          )}
          {lookup.state === "done" && lookup.candidates.length === 0 && (
            <p className="hint sheet__note">{t.origin.noResults}</p>
          )}
          {lookup.state === "suggestions" && (
            <ul className="sheet__results" aria-label={t.origin.suggestions}>
              {lookup.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="sheet__result"
                    onClick={() => void pickSuggestion(item)}
                  >
                    <span className="sheet__result-icon" aria-hidden="true">
                      <PinIcon size={15} />
                    </span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lookup.state === "done" && lookup.candidates.length > 0 && (
            <ul className="sheet__results" aria-label={t.origin.results}>
              {lookup.candidates.map((candidate) => (
                <li key={`${candidate.point.lat},${candidate.point.lon}`}>
                  <button type="button" className="sheet__result" onClick={() => pick(candidate)}>
                    <span className="sheet__result-icon" aria-hidden="true">
                      <PinIcon size={15} />
                    </span>
                    {candidate.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
