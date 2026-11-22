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

/**
 * Whether this is an iPhone or iPad, for the one place the wording differs by platform:
 * the steps that turn a blocked location permission back on. iPadOS reports itself as
 * a Mac, so a Mac with a touch screen counts too. Anything unknown reads as "not iOS".
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return ua.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1;
}
