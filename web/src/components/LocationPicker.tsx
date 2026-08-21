import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CityOption } from "../config";
import { CITIES } from "../config";
import { useI18n } from "../i18n/I18nProvider";
import { useOrigin } from "../location/useOrigin";
import { useGooglePlaces } from "../map/useGoogleMaps";
import { PinIcon, SearchIcon } from "./icons";

interface LocationPickerProps {
  city: CityOption;
  selectedCitySlug: string;
  onChooseCity: (slug: string) => void;
  onClose: () => void;
}

interface AddressSuggestion {
  label: string;
  prediction: google.maps.places.PlacePrediction;
}

export function LocationPicker({
  city,
  selectedCitySlug,
  onChooseCity,
  onClose,
}: LocationPickerProps) {
  const { t, lang } = useI18n();
  const { status, libs } = useGooglePlaces(lang);
  const { state, requestDeviceLocation, cancelPendingRequest, useAddress } = useOrigin(city);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const titleId = useId();
  const resultsId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      cancelPendingRequest();
    };
  }, [cancelPendingRequest]);

  useEffect(() => {
    if (state === "granted") onClose();
  }, [onClose, state]);

  useEffect(() => {
    const trimmed = query.trim();
    const requestId = ++requestIdRef.current;
    setSuggestions([]);
    setActiveIndex(-1);
    if (!libs || status !== "ready" || trimmed.length < 3) {
      setSearchFailed(false);
      return;
    }
    const Token = libs.places.AutocompleteSessionToken;
    if (Token && !tokenRef.current) tokenRef.current = new Token();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      libs.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: trimmed,
        includedRegionCodes: ["il"],
        language: lang,
        locationBias: {
          center: { lat: city.center.lat, lng: city.center.lon },
          radius: 50_000,
        },
        ...(tokenRef.current ? { sessionToken: tokenRef.current } : {}),
      })
        .then(({ suggestions: next }) => {
          if (cancelled || requestId !== requestIdRef.current) return;
          setSuggestions(
            next.flatMap((suggestion) => {
              const prediction = suggestion.placePrediction;
              return prediction ? [{ label: prediction.text.text, prediction }] : [];
            }),
          );
          setSearchFailed(false);
        })
        .catch(() => {
          if (cancelled || requestId !== requestIdRef.current) return;
          setSuggestions([]);
          setSearchFailed(true);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [city.center.lat, city.center.lon, lang, libs, query, status]);

  async function chooseAddress(suggestion: AddressSuggestion): Promise<void> {
    setSelecting(true);
    setSearchFailed(false);
    try {
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location"] });
      if (!place.location) throw new Error("Place has no mapped location");
      if (!mountedRef.current) return;
      useAddress(
        { lat: place.location.lat(), lon: place.location.lng() },
        place.formattedAddress || suggestion.label,
      );
      const Token = libs?.places.AutocompleteSessionToken;
      tokenRef.current = Token ? new Token() : null;
      onClose();
    } catch {
      if (mountedRef.current) setSearchFailed(true);
    } finally {
      if (mountedRef.current) setSelecting(false);
    }
  }

  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onComboboxKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      void chooseAddress(suggestions[activeIndex] as AddressSuggestion);
    }
  }

  const locationMessage =
    state === "denied"
      ? t.locationPicker.locationDenied
      : state === "unavailable"
        ? t.locationPicker.locationUnavailable
        : null;

  return (
    <div className="location-picker__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className="location-picker glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onDialogKeyDown}
      >
        <div className="location-picker__head">
          <h2 id={titleId}>{t.locationPicker.title}</h2>
          <button type="button" className="location-picker__close" onClick={onClose}>
            {t.locationPicker.close}
          </button>
        </div>

        <label className="location-picker__label" htmlFor="location-address">
          {t.locationPicker.addressLabel}
        </label>
        <div className="searchbar location-picker__search">
          <span className="searchbar__icon" aria-hidden="true"><SearchIcon size={17} /></span>
          <input
            id="location-address"
            className="searchbar__input"
            autoFocus
            autoComplete="street-address"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.locationPicker.addressPlaceholder}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls={resultsId}
            aria-activedescendant={activeIndex >= 0 ? `${resultsId}-${activeIndex}` : undefined}
            onKeyDown={onComboboxKeyDown}
          />
        </div>
        {status !== "absent" && (
          <p className="location-picker__privacy">{t.locationPicker.googleDisclosure}</p>
        )}

        {status === "loading" && <p className="location-picker__status" role="status">{t.locationPicker.loadingAddresses}</p>}
        {status === "absent" && <p className="location-picker__status" role="status">{t.locationPicker.addressUnavailableNoKey}</p>}
        {(status === "error" || searchFailed) && <p className="location-picker__status location-picker__status--error" role="alert">{t.locationPicker.addressUnavailable}</p>}

        {suggestions.length > 0 && (
          <>
          <ul id={resultsId} className="location-picker__results" role="listbox" aria-label={t.locationPicker.suggestions}>
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.prediction.placeId} role="none">
                <button
                  id={`${resultsId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={activeIndex === index}
                  disabled={selecting}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void chooseAddress(suggestion)}
                >
                  <PinIcon size={15} />
                  <span>{suggestion.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="location-picker__google" aria-label="Google Maps" translate="no">
            Google Maps
          </div>
          </>
        )}

        <button
          type="button"
          className="cta location-picker__device"
          disabled={state === "requesting"}
          onClick={requestDeviceLocation}
        >
          <PinIcon size={17} />
          {state === "requesting" ? t.origin.locating : t.origin.useMyLocation}
        </button>
        {locationMessage && <p className="location-picker__status location-picker__status--error" role="alert">{locationMessage}</p>}
        <p className="location-picker__privacy">{t.locationPicker.devicePrivacy}</p>

        <div className="location-picker__cities" role="group" aria-label={t.locationPicker.cityFallback}>
          {CITIES.map((option) => (
            <button
              key={option.slug}
              type="button"
              className="tag"
              aria-pressed={option.slug === selectedCitySlug}
              onClick={() => {
                onChooseCity(option.slug);
                onClose();
              }}
            >
              {lang === "en" ? option.en : option.he}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
