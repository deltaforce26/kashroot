/**
 * Where a search is scoped to — or the fact that it is not.
 *
 * The app has no notion of a default "current city" and no default centre. A search
 * comes from exactly one of four places: the device's real position, an address the
 * user typed, a city the user picked by name, or nowhere at all — in which case the
 * API is asked for every place in the database, paginated, and the header says so
 * ("כל הארץ"). Whichever point is in use (device or address) is sent to the API as
 * `center`, so distance and the Layer 2 fit score are computed server-side from one
 * source — the client never calculates a distance, which is what keeps list, map and
 * detail agreeing. A city is different in kind: it is a scope, not a place to measure
 * from. It is sent as `city` (the whole city, no radius), it is never turned into a
 * centre, and it never yields a distance — so with a city, like with nothing, the
 * server returns `distance_km: null`. The header shows the city's name. A point and a
 * city are mutually exclusive (see `searchScope.ts`): choosing one replaces the other.
 *
 * "Everywhere" is the last resort, not the opening position — but the browser's
 * native permission prompt is never fired cold. A first load with no stored origin
 * reads the standing answer from the Permissions API first (which raises no prompt):
 * "granted" re-acquires the position silently, as before; "prompt", or a browser with
 * no Permissions API, opens the pre-permission dialog (`permissionDialog: "ask"`,
 * drawn by `LocationPermissionDialog`) and the native prompt appears only once the user
 * taps Allow there; "denied" opens the same dialog in its denied state, which says
 * honestly that the browser will not ask again and how to turn it back on. A browser
 * with no geolocation at all is left alone: nothing asked, so nothing is said.
 *
 * Loading: while that standing answer is read (one microtask) and while a request is
 * pending with nothing pinned, the screens keep their loading state (`resolving`), so
 * the unscoped list never flashes before the device has had its chance to answer. While
 * the dialog waits for a decision nothing is pending: the screens behind it search
 * everywhere, and a fix, if the user allows, re-scopes them. Dismissing the dialog on a
 * first visit stores "all of Israel" as the choice, so a reload does not ask again; the
 * near-me button stays the way back.
 *
 * Two request paths. `askForDeviceLocation` is the gated one (the search bar's near-me
 * button, the map's locate control): granted asks at once, prompt opens the dialog,
 * denied opens it in its denied state. `requestDeviceLocation` asks directly, for the
 * location sheet, whose own button already sits next to the context and the privacy
 * line. A request started from the dialog (or a granted gated ask) steers the dialog
 * with its outcome: a fix closes it, a denial switches it to the denied state, and a
 * transient failure (timeout, unavailable, no geolocation API) closes it and leaves a
 * short `notice` for the bar to show briefly.
 *
 * The origin is shared process-wide rather than held per component, so setting it
 * on home moves the map too: one origin, one answer.
 *
 * Denied, dismissed, unavailable and timed out are one outcome as far as the origin
 * goes: refusing to share your location is a legitimate choice, not an error state,
 * and the header never nags.
 *
 * They are not one outcome as far as the *wording* goes, because what the user can do
 * about each differs. A site the browser has blocked never prompts again, so "denied"
 * gets the dialog's denied state with the steps to re-allow it; a timeout is worth
 * retrying; no geolocation API (often an insecure context) is not fixable from here. So
 * the last failure's cause is kept as `failure` (`GeoFailure`) beside the state, which
 * keeps its meaning unchanged. When the Permissions API already reports "denied", the
 * request is not made at all: the browser would only fail it instantly, and this way the
 * answer is the same without a wait.
 *
 * What that outcome costs depends on what was already chosen. A request made with
 * nothing behind it leaves the app searching everywhere. A request made when an
 * origin is already in use leaves that origin standing — a device fix taken a minute
 * ago is still where the user is, and a pinned address is still where they asked to
 * search from, so one attempt that did not come back is no reason to move the whole
 * screen out from under them.
 *
 * Persistence: the chosen origin survives a reload, because a refresh that silently
 * changes where the user searches from reports distances from a place they did not
 * pick. What is stored differs by source, and that difference is the privacy line:
 *
 * - An address is stored whole (label and point). The user typed it, it is already
 *   on screen in the header, and it is not where they are — it is where they asked
 *   to search from.
 * - A city is stored whole too (slug and label), for the same reason: the user picked
 *   it by name, it is on screen in the header, and it carries no coordinates at all.
 * - The device position is *never* written to storage. Only the fact that the device
 *   was the chosen origin is, and on load it is re-acquired **only** if the browser
 *   already reports the geolocation permission as granted. No stored coordinates and
 *   no prompt: anything short of an already-granted permission drops the marker and
 *   we search everywhere, silently. A refusal is only worth saying to someone who
 *   asked, and on that path nothing asked.
 * - An explicit "all of Israel" is stored as that choice, so a reload honours it
 *   rather than prompting for the device the user just declined to use.
 *
 * Coordinates go to our own API and nowhere else: never logged, never placed in a URL
 * or query string. An address the user types is the one exception in transit — it
 * goes to Google's geocoder to become a point (see `map/useGoogleMaps.ts`).
 */

import { useCallback, useEffect, useState } from "react";
import type { GeoPoint } from "../api/types";

export type OriginSource = "device" | "address" | "city" | "none";

/**
 * A city chosen by name. `slug` is what the API filters on (`Restaurant.city_slug`);
 * `label` is what the header prints, in the language the user picked it in.
 */
export interface CityScope {
  slug: string;
  label: string;
}

/**
 * How the last device request ended.
 *
 * `stale` is the one worth naming: the request failed, but a fix from an earlier one
 * is still the origin — so the position on screen is real and only the refresh is
 * missing. `unavailable` means there is no device position at all.
 */
export type GeoState = "idle" | "requesting" | "granted" | "stale" | "unavailable";

/**
 * Why the last device request did not produce a fix, for the one line that tells the
 * user what to do next. Only meaningful while `GeoState` says a request failed; null
 * otherwise. `denied` is `GeolocationPositionError.code` 1, `unavailable` is 2,
 * `timeout` is 3, and `unsupported` is no geolocation API at all.
 */
export type GeoFailure = "denied" | "unavailable" | "timeout" | "unsupported";

/**
 * Which face of the pre-permission dialog is up, or null for none. "ask" explains why
 * and offers Allow (which raises the native prompt); "denied" says the browser will not
 * ask again and lists how to turn location back on.
 */
export type PermissionDialog = "ask" | "denied";

/** A failure worth a brief, self-dismissing line rather than the dialog. */
export type GeoNotice = Exclude<GeoFailure, "denied">;

const TIMEOUT_MS = 8000;

/**
 * What is in force. A city has no point on purpose — it is a scope, never a centre —
 * and its `CityScope` object is kept as published, so a consumer that keys an effect
 * on it sees one stable reference until the user picks again.
 */
type Override =
  | { source: "device"; point: GeoPoint; /** The device names itself. */ label: "" }
  | { source: "address"; point: GeoPoint; /** What to call it in the header. */ label: string }
  | { source: "city"; city: CityScope };

/**
 * What gets written to storage. The device variant carries no point on purpose —
 * see the privacy note above.
 */
type StoredOrigin =
  | { source: "device" }
  | { source: "none" }
  | { source: "address"; label: string; lat: number; lon: number }
  | { source: "city"; slug: string; label: string };

const KEY = "kashroot.origin.v1";

/** Cross-component sync without a store: one event, one subscription per hook. */
const CHANGED = "kashroot:origin-changed";

let override: Override | null = null;
let geoState: GeoState = "idle";

/** Why the last device request failed; cleared by a fix, a cancel and every new request. */
let lastFailure: GeoFailure | null = null;

/**
 * Which device request is the current one. `getCurrentPosition` cannot be aborted, so a
 * request the user has since cancelled (the near-me button pressed again while locating)
 * or overtaken (a city or address picked, a newer request) still answers — and must find
 * that it is no longer awaited. Every request takes the next number, and every choice
 * that supersedes one bumps it; an answer whose number is not the current one is dropped,
 * a fix and a refusal alike.
 */
let requestGen = 0;

/** What `geoState` was when the request in flight began, so a cancel can put it back. */
let stateBeforeRequest: GeoState = "idle";

/** The pre-permission dialog's face, process-wide like the origin; null when closed. */
let dialog: PermissionDialog | null = null;

/**
 * The generation of the request whose outcome steers the dialog: one started from the
 * dialog's Allow / Try again, or a gated ask that found the permission granted. -1 for
 * none. A direct request (the location sheet's) never opens the dialog.
 */
let gatedGen = -1;

/** The transient failure of the last gated request, for the bar's brief line; null for none. */
let notice: GeoNotice | null = null;

/**
 * Whether a device fix came back this page session. Only consulted without a
 * Permissions API, where it is the one sign that asking again will not prompt.
 */
let hadFix = false;

function announce(): void {
  window.dispatchEvent(new Event(CHANGED));
}

function publish(nextOverride: Override | null, nextState: GeoState): void {
  override = nextOverride;
  geoState = nextState;
  announce();
}

function openDialog(kind: PermissionDialog): void {
  dialog = kind;
  announce();
}

function persist(stored: StoredOrigin | null): void {
  try {
    if (stored) localStorage.setItem(KEY, JSON.stringify(stored));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked or full: the origin still holds for this session.
  }
}

/** Defensive read — a foreign or half-written blob is discarded, never patched up. */
function readStored(): StoredOrigin | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record["source"] === "device") return { source: "device" };
  if (record["source"] === "none") return { source: "none" };
  if (record["source"] === "city") {
    const { slug, label } = record;
    if (typeof slug !== "string" || slug.length === 0) return null;
    if (typeof label !== "string" || label.length === 0) return null;
    return { source: "city", slug, label };
  }
  if (record["source"] !== "address") return null;
  const { label, lat, lon } = record;
  if (typeof label !== "string" || label.length === 0) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lon !== "number" || !Number.isFinite(lon)) return null;
  return { source: "address", label, lat, lon };
}

function devicePoint(position: GeolocationPosition): Override {
  return {
    source: "device",
    point: { lat: position.coords.latitude, lon: position.coords.longitude },
    label: "",
  };
}

/** The failure a `GeolocationPositionError.code` stands for; anything unknown reads as unavailable. */
function failureOf(error: { code?: number } | null | undefined): GeoFailure {
  if (error?.code === 1) return "denied";
  if (error?.code === 3) return "timeout";
  return "unavailable";
}

/**
 * A device request that did not produce a fix, whatever the cause: record the cause
 * and publish the outcome. Denied, dismissed, position unavailable, or timed out —
 * one outcome for the origin, and never a reason to discard one the user already has.
 * Keeping the last device fix is the difference between a retry that quietly does
 * nothing and a retry that throws the map somewhere else; keeping a pinned address or
 * a chosen city is the same courtesy for someone who only tried the shortcut.
 *
 * Storage is left alone with it, so the kept origin also survives a reload.
 *
 * When the request is the gated one (`gen === gatedGen`), the outcome also steers the
 * dialog: a denial puts up its denied state; anything else closes it and leaves a brief
 * notice, because a dialog is overkill for a timeout.
 */
function failDevice(failure: GeoFailure, gen?: number): void {
  lastFailure = failure;
  if (gen !== undefined && gen === gatedGen) {
    if (failure === "denied") {
      dialog = "denied";
    } else {
      dialog = null;
      notice = failure;
    }
  }
  if (override) {
    publish(override, override.source === "device" ? "stale" : "unavailable");
    return;
  }
  persist(null);
  publish(null, "unavailable");
}

/**
 * Ask the device for its position — the native prompt, if the browser still has one to
 * show. Shared by the sheet's button, the dialog's Allow and Try again, a granted gated
 * ask and a first load whose permission is already granted, so every path handles a
 * refusal the same way. `gated` marks a request whose outcome steers the dialog.
 *
 * Without a Permissions API the position is asked for on the spot. With one, a standing
 * "denied" is answered at once instead of waiting for the browser to refuse; any other
 * answer, and a query that itself fails, means "go ahead and ask". The query is a wait
 * like any other, so it checks it is still the current request before acting.
 */
function requestDevice(gated = false): void {
  const gen = ++requestGen;
  lastFailure = null;
  if (gated) {
    gatedGen = gen;
    notice = null;
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    lastFailure = "unsupported";
    if (gated) {
      dialog = null;
      notice = "unsupported";
    }
    publish(override, override ? geoState : "unavailable");
    return;
  }
  if (geoState !== "requesting") stateBeforeRequest = geoState;
  publish(override, "requesting");
  const geolocation = navigator.geolocation;
  const ask = () => {
    geolocation.getCurrentPosition(
      (position) => {
        if (gen !== requestGen) return;
        // Only the choice is remembered, never the coordinates.
        lastFailure = null;
        hadFix = true;
        if (gen === gatedGen) dialog = null;
        persist({ source: "device" });
        publish(devicePoint(position), "granted");
      },
      (error) => {
        if (gen !== requestGen) return;
        failDevice(failureOf(error), gen);
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
    );
  };
  const permissions = navigator.permissions;
  if (!permissions || typeof permissions.query !== "function") {
    ask();
    return;
  }
  let query: Promise<PermissionStatus>;
  try {
    query = permissions.query({ name: "geolocation" });
  } catch {
    ask();
    return;
  }
  query.then(
    (status) => {
      if (gen !== requestGen) return;
      if (status.state === "denied") failDevice("denied", gen);
      else ask();
    },
    () => {
      if (gen !== requestGen) return;
      ask();
    },
  );
}

/** True when the browser offers `permissions.query` to read the standing answer with. */
function canQueryPermission(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.permissions &&
    typeof navigator.permissions.query === "function"
  );
}

/**
 * The near-me path: never fire the native prompt without the dialog's context first.
 *
 * Granted asks at once (as a gated request, so a surprise denial still lands in the
 * dialog). Prompt opens the dialog; denied opens its denied state. With no Permissions
 * API there is no way to tell, so the dialog is shown — unless a fix already came back
 * this session, which means asking again will not prompt. No geolocation at all goes
 * straight to the request, which reports "unsupported" as a brief notice.
 *
 * The query is a wait, so it takes a request generation like any request: a pick or a
 * cancel made meanwhile wins, and the late answer opens nothing.
 */
function askDevice(): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    requestDevice(true);
    return;
  }
  if (!canQueryPermission()) {
    if (hadFix) requestDevice(true);
    else openDialog("ask");
    return;
  }
  const gen = ++requestGen;
  const decide = (state: PermissionState | null) => {
    if (gen !== requestGen) return;
    if (state === "granted") requestDevice(true);
    else openDialog(state === "denied" ? "denied" : "ask");
  };
  let query: Promise<PermissionStatus>;
  try {
    query = navigator.permissions.query({ name: "geolocation" });
  } catch {
    decide(null);
    return;
  }
  query.then(
    (status) => decide(status.state),
    () => decide(null),
  );
}

/**
 * A first visit: nothing stored. Read the standing answer, never prompt cold.
 *
 * While the query runs the state is "requesting", so the screens keep loading instead
 * of flashing the unscoped list. Granted asks silently, as a plain (ungated) request: a
 * failure there is nobody's question, so no dialog and no notice. Prompt, a failed
 * query and no Permissions API open the dialog and leave the screens searching
 * everywhere behind it; denied records the refusal and opens the denied state. No
 * geolocation API: nothing to ask and nothing said.
 */
function firstVisit(): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  if (!canQueryPermission()) {
    openDialog("ask");
    return;
  }
  const gen = ++requestGen;
  stateBeforeRequest = "idle";
  publish(null, "requesting");
  const decide = (state: PermissionState | null) => {
    if (gen !== requestGen) return;
    if (state === "granted") {
      requestDevice();
      return;
    }
    if (state === "denied") {
      failDevice("denied");
      openDialog("denied");
      return;
    }
    dialog = "ask";
    publish(null, "idle");
  };
  let query: Promise<PermissionStatus>;
  try {
    query = navigator.permissions.query({ name: "geolocation" });
  } catch {
    decide(null);
    return;
  }
  query.then(
    (status) => decide(status.state),
    () => decide(null),
  );
}

/**
 * Re-acquire the device position on load without ever asking for it.
 *
 * `permissions.query` is the whole point: it reports the standing answer without
 * raising a prompt. Anything other than an outright "granted" — prompt, denied, no
 * Permissions API, no geolocation — drops the marker and leaves us searching
 * everywhere.
 *
 * It is a background answer to a question the user did not ask this session, so it
 * must never overrule one they did. The origin in force is captured when it starts,
 * and every point after an `await` or inside a callback checks it is still the one:
 * if the user has picked a city or an address in the meantime (or pressed "near me" or
 * cleared the scope, which bump the request generation), the late answer —
 * a fix, a refusal or a permission that is not granted — is dropped, neither
 * published nor allowed to wipe the choice from storage.
 */
async function reacquireDevice(): Promise<void> {
  const started = override;
  const gen = requestGen;
  // Superseded by a pick, or by a request or a clear made since it began.
  const superseded = () => override !== started || gen !== requestGen;
  if (typeof navigator === "undefined" || !navigator.geolocation || !navigator.permissions) {
    persist(null);
    return;
  }
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (superseded()) return;
    if (status.state !== "granted") {
      persist(null);
      return;
    }
  } catch {
    if (superseded()) return;
    persist(null);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (superseded()) return;
      publish(devicePoint(position), "granted");
    },
    () => {
      if (superseded()) return;
      // Nobody asked for this, so nobody is told it failed: no "denied" note for a
      // request the user did not make. We just search everywhere.
      persist(null);
    },
    { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
  );
}

let restored = false;

/**
 * Reinstate the last chosen origin. Runs once per page load, before first render.
 *
 * Nothing stored means a first visit (`firstVisit`): the standing permission decides
 * between a silent fix, the pre-permission dialog and its denied state — the native
 * prompt only ever follows a tap on Allow. A stored choice, including an explicit "all
 * of Israel", is honoured without a prompt and without the dialog.
 */
export function restoreOrigin(): void {
  if (restored) return;
  restored = true;
  const stored = readStored();
  if (!stored) {
    firstVisit();
    return;
  }
  if (stored.source === "none") return;
  if (stored.source === "city") {
    publish(
      { source: "city", city: { slug: stored.slug, label: stored.label } },
      "idle",
    );
    return;
  }
  if (stored.source === "address") {
    publish(
      { source: "address", point: { lat: stored.lat, lon: stored.lon }, label: stored.label },
      "idle",
    );
    return;
  }
  void reacquireDevice();
}

/**
 * Test seam: drop the in-memory origin and the restore latch, leaving storage
 * alone. That is precisely what a page reload does to this module, and it is the
 * only way to prove the reload path reads storage rather than surviving on module
 * state that a real refresh would have thrown away. Not used by the app.
 */
export function resetOriginState(): void {
  requestGen += 1;
  override = null;
  geoState = "idle";
  lastFailure = null;
  stateBeforeRequest = "idle";
  dialog = null;
  gatedGen = -1;
  notice = null;
  hadFix = false;
  restored = false;
}

/** Drop any pinned origin, in memory and in storage. Test seam and reset path. */
export function clearOrigin(): void {
  requestGen += 1;
  dialog = null;
  notice = null;
  persist(null);
  publish(null, "idle");
}

export function useOrigin(): {
  /**
   * The point searches are measured from (device or address), or null — for a city
   * and for "everywhere" alike, neither of which has a point.
   */
  origin: GeoPoint | null;
  source: OriginSource;
  /** The typed address, when that is what we are measuring from; otherwise null. */
  addressLabel: string | null;
  /**
   * The city the search is scoped to, or null. The very object that was published, so
   * it is reference-stable until the next choice and safe to key an effect on.
   */
  city: CityScope | null;
  state: GeoState;
  /**
   * Why the last device request failed, or null: nothing has failed, or a fix, a cancel
   * or a newer request has since replaced it. It says nothing about whether a failure
   * is on record — `state` does that.
   */
  failure: GeoFailure | null;
  /**
   * True while the device is being asked and nothing else is pinned: the answer is
   * not yet "everywhere", so screens keep loading rather than searching unscoped.
   */
  resolving: boolean;
  /**
   * Ask for the device position directly — the native prompt, if any. Safe to call when
   * unsupported. For a button that already sits beside the context (the location sheet).
   */
  requestDeviceLocation: () => void;
  /**
   * The gated ask (near-me, the map's locate): granted asks at once, prompt opens the
   * pre-permission dialog, denied opens its denied state.
   */
  askForDeviceLocation: () => void;
  /** The pre-permission dialog's face, or null when it is closed. */
  permissionDialog: PermissionDialog | null;
  /** The dialog's Allow and Try again: the real request, whose outcome steers the dialog. */
  allowDeviceLocation: () => void;
  /**
   * Close the dialog without a decision. On a first visit (nothing stored, nothing in
   * force) that stores "all of Israel", so a reload does not ask again.
   */
  dismissPermissionDialog: () => void;
  /** A transient failure of the last gated request, for a brief line; null for none. */
  notice: GeoNotice | null;
  /** Take the notice down (it is shown briefly). */
  clearNotice: () => void;
  /** Measure from a point the user chose by name. */
  setAddressOrigin: (label: string, point: GeoPoint) => void;
  /** Scope the search to a whole city, by `Restaurant.city_slug`. Replaces any point. */
  setCityOrigin: (slug: string, label: string) => void;
  /**
   * Call off a device request still in flight and leave everything else as it was: the
   * origin in force and storage are untouched, and the state returns to what it was
   * before the request, except that "unavailable" (a refusal on record) reads as idle —
   * cancelling is not one. "stale" is kept: the earlier fix is still the origin. A
   * no-op when nothing is being asked.
   */
  cancelRequest: () => void;
  /**
   * Drop whatever is in force and search everywhere, and call off a device request still
   * in flight. Stored as the explicit choice "all of Israel", so a reload honours it and
   * does not ask the device again; clearing storage instead would make the next load a
   * first visit.
   */
  clearToEverywhere: () => void;
} {
  // Restored in the initialiser, not an effect: the first render must already be
  // measuring from the stored origin, or the list paints once unscoped and then
  // jumps. Idempotent, so StrictMode's double invoke costs nothing, and at this
  // point no other hook has subscribed yet, so nothing is updated mid-render.
  const [, setTick] = useState(() => {
    restoreOrigin();
    return 0;
  });

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
  }, []);

  const requestDeviceLocation = useCallback(() => requestDevice(), []);
  const askForDeviceLocation = useCallback(() => askDevice(), []);
  const allowDeviceLocation = useCallback(() => requestDevice(true), []);

  const dismissPermissionDialog = useCallback(() => {
    dialog = null;
    gatedGen = -1;
    if (override === null && readStored() === null) persist({ source: "none" });
    announce();
  }, []);

  const clearNotice = useCallback(() => {
    if (notice === null) return;
    notice = null;
    announce();
  }, []);

  const setAddressOrigin = useCallback((label: string, point: GeoPoint) => {
    requestGen += 1;
    persist({ source: "address", label, lat: point.lat, lon: point.lon });
    publish({ source: "address", point, label }, "idle");
  }, []);

  const setCityOrigin = useCallback((slug: string, label: string) => {
    requestGen += 1;
    persist({ source: "city", slug, label });
    publish({ source: "city", city: { slug, label } }, "idle");
  }, []);

  const cancelRequest = useCallback(() => {
    if (geoState !== "requesting") return;
    requestGen += 1;
    lastFailure = null;
    publish(override, stateBeforeRequest === "unavailable" ? "idle" : stateBeforeRequest);
  }, []);

  const clearToEverywhere = useCallback(() => {
    requestGen += 1;
    persist({ source: "none" });
    publish(null, "idle");
  }, []);

  return {
    origin: override && override.source !== "city" ? override.point : null,
    source: override?.source ?? "none",
    addressLabel: override?.source === "address" ? override.label : null,
    city: override?.source === "city" ? override.city : null,
    state: geoState,
    failure: lastFailure,
    resolving: override === null && geoState === "requesting",
    requestDeviceLocation,
    askForDeviceLocation,
    permissionDialog: dialog,
    allowDeviceLocation,
    dismissPermissionDialog,
    notice,
    clearNotice,
    setAddressOrigin,
    setCityOrigin,
    cancelRequest,
    clearToEverywhere,
  };
}
