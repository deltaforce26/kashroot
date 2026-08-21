/**
 * Location sheet — the one place that answers "where am I searching from?".
 *
 * Opened from the pin or the address in the home header, which are two halves of the
 * same control. It offers the two origins a person names for themselves, in the order
 * they cost effort: the device position (one tap) and a typed address. Cities are not
 * repeated here — they are a filter, and they live on the filters and search screens
 * where the rest of the filtering does.
 *
 * Every branch says something true. Address lookup needs the Google geocoder, so
 * without a browser key the field is not drawn at all rather than drawn dead — and
 * "we could not look that up" is kept distinct from "there is no such place",
 * because they call for different next moves. A refused location permission is not
 * an error: it is stated once, next to the button that asked, and never again.
 *
 * The sheet does not filter or rank anything. It moves the origin; the API re-answers.
 */

import { useEffect, useRef, useState } from "react";
import { CloseIcon, CrosshairIcon, PinIcon, SearchIcon } from "./icons";
import { useI18n } from "../i18n/I18nProvider";
import { useCity } from "../location/useCity";
import { useOrigin } from "../location/useOrigin";
import { geocodeAddress, hasMapsKey, type GeocodeCandidate } from "../map/useGoogleMaps";
import { MAX_QUERY_LENGTH } from "../api/types";

type Lookup =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "done"; candidates: GeocodeCandidate[] }
  | { state: "failed" };

export function LocationSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const { city } = useCity();
  const { source, state, requestDeviceLocation, setAddressOrigin } = useOrigin(city);

  const [address, setAddress] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  // Only a permission answer that arrives while the sheet is open should close it;
  // a refusal recorded on an earlier screen must not slam the sheet shut on open.
  const askedRef = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (askedRef.current && state === "granted") onClose();
  }, [state, onClose]);

  async function lookUpAddress(query: string) {
    setLookup({ state: "searching" });
    try {
      setLookup({ state: "done", candidates: await geocodeAddress(query, lang) });
    } catch {
      // No key, blocked script, offline, quota. The user does not need to know
      // which; they need to know the field cannot answer and the cities can.
      setLookup({ state: "failed" });
    }
  }

  function pick(candidate: GeocodeCandidate) {
    setAddressOrigin(candidate.label, candidate.point);
    onClose();
  }

  const locating = state === "requesting";

  return (
    <>
      <button
        type="button"
        className="sheet__scrim"
        aria-label={t.origin.close}
        onClick={onClose}
      />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={t.origin.title}>
        <div className="sheet__head">
          <h2 className="sheet__title">{t.origin.title}</h2>
          <button
            type="button"
            className="circle circle--sm glass"
            aria-label={t.origin.close}
            onClick={onClose}
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
        {state === "unavailable" && (
          <p className="hint sheet__note" role="status">
            {t.origin.denied}
          </p>
        )}

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
              onChange={(event) => {
                setAddress(event.target.value);
                setLookup({ state: "idle" });
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
