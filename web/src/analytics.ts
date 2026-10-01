/**
 * Product events for Vercel Web Analytics, on top of its automatic page views.
 *
 * Page views alone cannot tell a finished onboarding from an abandoned one, nor show
 * saves. These few events close that gap. They carry no personal data and nothing
 * kashrut-sensitive beyond which preset was picked.
 *
 * `track` is a no-op outside a Vercel deployment and never throws; the guard here
 * only keeps analytics from ever breaking a user action.
 */
import { track } from "@vercel/analytics";

type EventProps = Record<string, string | number | boolean>;

export type CtaSource = "landing" | "restaurant_public";
export type OnboardingPath = "skip" | "preset" | "certifiers";

function send(name: string, props: EventProps): void {
  try {
    track(name, props);
  } catch {
    // Analytics must never break the action it observes.
  }
}

/** A "set up my profile" call to action was clicked. */
export function trackCtaClick(source: CtaSource): void {
  send("cta_click", { source });
}

/**
 * Onboarding finished with a usable profile. `first` is false when an existing
 * profile was edited (Profile → change certifiers / reset).
 */
export function trackOnboardingComplete(props: {
  path: OnboardingPath;
  preset: string;
  certifiers: number;
  first: boolean;
}): void {
  send("onboarding_complete", props);
}

/** A restaurant was added to a saved list. */
export function trackRestaurantSaved(): void {
  send("restaurant_saved", {});
}
