/**
 * Search bar — the one field on home, search and the map, Google-Maps style.
 *
 * It is a glass pill with a field and, at the inline end behind a thin divider, a
 * "near me" button. That button is the quick path to the device position; the pin and
 * address in the header, and the sheet behind them, stay as the second path to the
 * same origin. Both go through `useOrigin`, so the bar adds no origin of its own.
 *
 * Typing never moves the origin. What is typed is a text query — on search and the
 * map it filters the list in place, on home it is handed to /search on submit — and
 * the dropdown under the field only *offers*: cities (the whole city becomes the
 * scope, no centre and no distance), Google place suggestions (a point to measure
 * from, resolved only when picked) and, where there is somewhere to send the text,
 * one row that searches restaurants by that name. Only a pick changes where we search,
 * and a pick also empties the field: the origin now says where, so the words that
 * found it are not a name filter anyone asked for.
 *
 * The form is always a form, never a label. A label around a button is invalid markup,
 * and a tap on the label would hand focus to the field instead of pressing the button.
 * A submit control exists only when there is an `onSubmit` to run, and it is not drawn:
 * the comp has you press Enter, but a form whose one submit path is a keypress is
 * unusable by anyone driving it another way.
 *
 * The dropdown is a plain list of buttons, like the location sheet's results, not a
 * combobox: nothing moves with the arrow keys and nothing is "selected" until pressed,
 * so claiming listbox semantics would promise behaviour that is not there. Escape, a
 * tap on the scrim and any pick put it away, and typing brings it back. It is drawn
 * from two characters up, like the sheet's completions — one letter completes to
 * everything, which is to say nothing.
 *
 * Place suggestions come from Google and only when a browser key exists; with none the
 * section is simply absent, and cities (our own directory) and the name row still work.
 * Completions answer out of order and after the user has moved on, so the debounce and
 * the request counter are the sheet's, copied: each pause takes a number and anything
 * that supersedes it takes the next, so a late answer finds it is no longer awaited. A
 * failed lookup is silent — nothing was asked out loud, so nothing is reported.
 *
 * "Near me" says out loud only the one thing the user cannot see: a refusal. The hint
 * is shown only for a request made from this bar during this mount — a refusal recorded
 * on an earlier screen is not news here — and it goes when the device answers, the
 * button is pressed again or a city or place is picked. Refusing is a legitimate choice,
 * and what a failed request leaves behind depends on what was already in use (nothing,
 * an address, a city, an earlier fix), so the hint claims none of it: it says only that
 * the position did not come, and what to do instead. It never blocks.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MAX_QUERY_LENGTH } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { matchCities, useCityIndex, type CityOption } from "../location/useCityIndex";
import { useOrigin } from "../location/useOrigin";
import { hasMapsKey, suggestAddresses, type AddressSuggestion } from "../map/useGoogleMaps";
import { PinIcon, SearchIcon } from "./icons";

/** Long enough that a word typed at speed is one request, short enough to feel live. */
const SUGGEST_DEBOUNCE_MS = 250;

/** A single letter completes to everything, which is to say nothing. */
const SUGGEST_MIN_CHARS = 2;

/** How many cities the dropdown offers; the directory's order (largest first) decides which. */
const CITY_LIMIT = 5;

export interface SearchBarProps {
  value: string;
  onChange: (next: string) => void;
  /** Where the text goes on Enter or on the "search by name" row; absent when the field filters in place. */
  onSubmit?: (query: string) => void;
  placeholder: string;
  className?: string;
}

export function SearchBar({ value, onChange, onSubmit, placeholder, className }: SearchBarProps) {
  const { t, lang } = useI18n();
  const { source, state, requestDeviceLocation, setAddressOrigin, setCityOrigin } = useOrigin();
  const menuId = useId();

  const trimmed = value.trim();
  const searchable = trimmed.length >= SUGGEST_MIN_CHARS;

  // Closed by a pick, the scrim or Escape, and reopened by the next keystroke.
  const [dismissed, setDismissed] = useState(false);
  const close = useCallback(() => setDismissed(true), []);

  const cityIndex = useCityIndex(searchable);
  const cities: CityOption[] = searchable ? matchCities(cityIndex ?? [], trimmed, CITY_LIMIT) : [];

  const [places, setPlaces] = useState<AddressSuggestion[]>([]);
  // Completions answer out of order and after the user has moved on. Each typing
  // pause takes a number, and anything that supersedes it — more typing, a pick —
  // takes the next, so a late answer finds it is no longer the one awaited.
  const requestRef = useRef(0);
  // A pick is a different race from typing: `resolve()` of a place can come back after
  // the user has picked something else, and must not overwrite that. Each pick takes a
  // ticket, and a pick that finds its ticket superseded after the await does nothing.
  const pickRef = useRef(0);

  useEffect(() => {
    if (!hasMapsKey()) return;
    if (trimmed.length < SUGGEST_MIN_CHARS) {
      // The text the completions answered is gone; so are they.
      requestRef.current += 1;
      setPlaces([]);
      return;
    }
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      if (requestRef.current !== request) return;
      suggestAddresses(trimmed, lang).then(
        (items) => {
          if (requestRef.current !== request) return;
          setPlaces(items);
        },
        () => {
          // Silence: nothing was asked out loud. Only completions for text that is no
          // longer in the field are taken down.
          if (requestRef.current !== request) return;
          setPlaces([]);
        },
      );
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, lang]);

  const open =
    searchable && !dismissed && (Boolean(onSubmit) || cities.length > 0 || places.length > 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Only a permission answer to a request made from this bar, during this mount, is
  // reported. `asks` is in the dependencies because a refusal that comes back inside
  // the tap leaves `state` where it was, and the effect still has to see it.
  const askedRef = useRef(false);
  const [asks, setAsks] = useState(0);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (state === "granted") {
      askedRef.current = false;
      setHint(false);
      return;
    }
    if (askedRef.current && (state === "unavailable" || state === "stale")) {
      askedRef.current = false;
      setHint(true);
    }
  }, [state, asks]);

  const locating = state === "requesting";

  function pickCity(city: CityOption) {
    requestRef.current += 1;
    pickRef.current += 1;
    setHint(false);
    setCityOrigin(city.slug, lang === "he" ? city.labelHe : (city.labelEn ?? city.labelHe));
    onChange("");
    close();
  }

  async function pickPlace(item: AddressSuggestion) {
    requestRef.current += 1;
    const ticket = ++pickRef.current;
    try {
      const resolved = await item.resolve();
      if (pickRef.current !== ticket) return;
      setHint(false);
      setAddressOrigin(resolved.label, resolved.point);
      onChange("");
      close();
    } catch {
      // Silence, as for the completions themselves: the row stays and can be tried again.
    }
  }

  function submit(query: string) {
    close();
    onSubmit?.(query);
  }

  return (
    <>
      <div className={"searchbar__wrap" + (className ? " " + className : "")}>
        <form
          className="searchbar glass"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submit(trimmed);
          }}
        >
          <span className="searchbar__icon" aria-hidden="true">
            <SearchIcon size={17} />
          </span>
          <input
            type="search"
            className="searchbar__input"
            autoComplete="off"
            maxLength={MAX_QUERY_LENGTH}
            value={value}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(event) => {
              setDismissed(false);
              onChange(event.target.value);
            }}
          />
          <span className="searchbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="searchbar__near"
            aria-pressed={source === "device"}
            aria-busy={locating}
            disabled={locating}
            onClick={() => {
              askedRef.current = true;
              setHint(false);
              setAsks((n) => n + 1);
              close();
              requestDeviceLocation();
            }}
          >
            <PinIcon size={15} />
            <span className="searchbar__near-label">
              {locating ? t.origin.locating : t.origin.nearMe}
            </span>
          </button>
          {onSubmit && (
            <button type="submit" className="sr-only">
              {t.nav.search}
            </button>
          )}
        </form>

        {open && (
          <>
            <button
              type="button"
              className="fpop__scrim"
              aria-label={t.origin.close}
              onClick={close}
            />
            <div
              id={menuId}
              className="fpop searchbar__menu"
              role="group"
              aria-label={t.search.suggestionsLabel}
            >
              {onSubmit && (
                <button type="button" className="sheet__result" onClick={() => submit(trimmed)}>
                  <span className="sheet__result-icon" aria-hidden="true">
                    <SearchIcon size={15} />
                  </span>
                  {t.search.searchNames(trimmed)}
                </button>
              )}
              {cities.length > 0 && (
                <section>
                  <h3 className="searchbar__menu-title">{t.search.cities}</h3>
                  <ul className="sheet__results">
                    {cities.map((city) => (
                      <li key={city.slug}>
                        <button
                          type="button"
                          className="sheet__result"
                          onClick={() => pickCity(city)}
                        >
                          <span className="sheet__result-icon" aria-hidden="true">
                            <PinIcon size={15} />
                          </span>
                          {lang === "he" ? city.labelHe : (city.labelEn ?? city.labelHe)} ·{" "}
                          {t.search.cityCount(city.count)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {places.length > 0 && (
                <section>
                  <h3 className="searchbar__menu-title">{t.search.places}</h3>
                  <ul className="sheet__results">
                    {places.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="sheet__result"
                          onClick={() => void pickPlace(item)}
                        >
                          <span className="sheet__result-icon" aria-hidden="true">
                            <PinIcon size={15} />
                          </span>
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </div>
      {/* After the wrapper, not inside it: the menu anchors to the pill's own box, and a
          hint in between would push the menu down below it. */}
      {hint && (
        <p className="hint searchbar__hint" role="status">
          {t.origin.nearMeRefused}
        </p>
      )}
    </>
  );
}
