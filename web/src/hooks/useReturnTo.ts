/**
 * Where onboarding should land once a profile exists.
 *
 * A shared link (`/r/<id>`) hits `RequireProfile` before it can render: a fresh
 * device has no whitelist, and a verdict without a whitelist is meaningless. The
 * gate sends the visitor to onboarding and stashes where they were headed, so
 * finishing onboarding continues to the restaurant they were sent rather than
 * dropping them on home with the link lost.
 *
 * Only same-origin absolute paths are honoured. The state is written by our own
 * gate, but a path arriving from history has been outside our control, and a
 * `//host` value would be a redirect off the origin.
 */

import { useLocation, useNavigate } from "react-router-dom";

export function returnToOf(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const from = (state as { from?: unknown }).from;
  if (typeof from !== "string") return null;
  if (!from.startsWith("/") || from.startsWith("//")) return null;
  if (from.startsWith("/onboarding")) return null;
  return from;
}

/** The stashed destination, or `/` when there is none. */
export function useReturnTo(): string {
  return returnToOf(useLocation().state) ?? "/";
}

/**
 * State stamped on a destination that onboarding reached by *replacing* history.
 *
 * The entries behind it are the onboarding steps themselves, so `navigate(-1)`
 * there walks back into the preset picker of an already-completed profile. A
 * screen that carries this marker sends its back button to the fallback instead.
 */
export const ROOTLESS = { rootless: true } as const;

/** Back, or the fallback when there is only onboarding behind us. */
export function useGoBack(fallback = "/"): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const rootless =
    !!state && typeof state === "object" && (state as { rootless?: unknown }).rootless === true;
  return () => {
    if (rootless) navigate(fallback, { replace: true });
    else navigate(-1);
  };
}
