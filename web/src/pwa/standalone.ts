/**
 * Whether the app is running installed (a home-screen PWA) rather than in a browser tab.
 *
 * Installed, there is no address bar and no lock icon, so advice that points at them
 * ("allow location from the lock icon") is wrong there and the user needs the device's
 * settings instead. Two signals, because neither covers everyone: the `display-mode`
 * media query is the standard one, and iOS Safari reports an installed app only through
 * its own `navigator.standalone`. A browser without `matchMedia` (and jsdom) reads as
 * "not installed", which is the safe side: the browser wording is still true there.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayMode =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}
