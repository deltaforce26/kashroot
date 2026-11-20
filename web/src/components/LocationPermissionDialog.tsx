/**
 * The pre-permission dialog: the app says why it wants location *before* the browser's
 * own prompt appears, and says honestly what to do once that prompt is gone for good.
 *
 * It is a face of `useOrigin`'s process-wide `permissionDialog`, not local state, so the
 * first load, the near-me button and the map's locate control all open the same one.
 * The search bar draws it (one bar per screen), so it rises over home, search and the
 * map, the screens where location is used.
 *
 * Two faces:
 *   - "ask": a location icon, a short title and reason, the privacy line, and Allow —
 *     which is the moment the native prompt appears (`allowDeviceLocation`). The dialog
 *     stays up while the browser asks; a fix closes it, and a denial turns it to:
 *   - "denied": browsers never show the native prompt again once a site is blocked, so
 *     the dialog does not pretend to. It lists the steps for where the user actually is
 *     — an installed app (`isStandalone`) needs the device's settings, a browser tab its
 *     site settings, and iOS differs from the rest in both — and "Try again" re-runs the
 *     request, which comes straight back to this face if the setting is still off.
 *
 * Both faces offer typing a city or an address instead, which closes the dialog and
 * hands focus to the search field (`onTypeInstead`). Closing any way (the scrim, Escape,
 * the back gesture) is `dismissPermissionDialog`: a decision not to share, for now.
 *
 * `BottomSheet` provides the dialog semantics: role=dialog, aria-modal, focus moved in
 * and trapped and returned, Escape, scroll lock. The heading names it (aria-labelledby).
 */

import { useId } from "react";
import { LocateFixed, MapPin } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider";
import { useOrigin } from "../location/useOrigin";
import { isIOS, isStandalone } from "../pwa/standalone";
import { BottomSheet } from "./BottomSheet";

/** The re-allow steps for this context: installed or in a tab, iOS or not. */
function deniedSteps(steps: {
  browser: string[];
  iosBrowser: string[];
  androidApp: string[];
  iosApp: string[];
}): string[] {
  const ios = isIOS();
  if (isStandalone()) return ios ? steps.iosApp : steps.androidApp;
  return ios ? steps.iosBrowser : steps.browser;
}

export function LocationPermissionDialog({ onTypeInstead }: { onTypeInstead: () => void }) {
  const { t } = useI18n();
  const { permissionDialog, state, allowDeviceLocation, dismissPermissionDialog } = useOrigin();
  const titleId = useId();

  if (!permissionDialog) return null;

  const copy = t.origin.permission;
  const denied = permissionDialog === "denied";
  const busy = state === "requesting";

  function typeInstead() {
    dismissPermissionDialog();
    onTypeInstead();
  }

  return (
    <BottomSheet
      labelledBy={titleId}
      closeLabel={t.origin.close}
      onClose={dismissPermissionDialog}
      className="locperm"
    >
      <span className={"locperm__icon" + (denied ? " locperm__icon--off" : "")} aria-hidden="true">
        {denied ? <MapPin size={26} strokeWidth={2} /> : <LocateFixed size={26} strokeWidth={2} />}
      </span>
      <h2 id={titleId} className="sheet__title locperm__title">
        {denied ? copy.deniedTitle : copy.title}
      </h2>
      {denied ? (
        <>
          <p className="locperm__lead">{copy.deniedLead}</p>
          <ol className="locperm__steps">
            {deniedSteps(copy.steps).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <p className="locperm__lead">{copy.reason}</p>
          <p className="hint locperm__privacy">{t.origin.privacy}</p>
        </>
      )}
      <div className="locperm__actions">
        <button
          type="button"
          className="cta bsheet__button"
          disabled={busy}
          aria-busy={busy}
          onClick={allowDeviceLocation}
        >
          {busy ? t.origin.locating : denied ? copy.retry : copy.allow}
        </button>
        <button type="button" className="cta cta--ghost bsheet__button" onClick={typeInstead}>
          {copy.typeInstead}
        </button>
      </div>
    </BottomSheet>
  );
}
