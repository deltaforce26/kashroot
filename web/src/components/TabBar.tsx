/**
 * The floating glass tab bar from every full screen in the design.
 *
 * The second slot is the map, not search: home now carries the search field itself,
 * so a search tab would only lead to the screen the user is already on. The map is
 * the one view of the same results home cannot give.
 */

import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { BookmarkIcon, HomeIcon, MapIcon, UserIcon } from "./icons";

/** Breathing room kept between the last row of a list and the top of the bar. */
const TABBAR_GAP = 14;

/**
 * Reserve the bar's *measured* height in `--tabbar-space`, overriding the CSS
 * estimate for as long as this bar is mounted.
 *
 * The bar floats over `.shell__scroll`, so the list has to hold back enough padding
 * to clear it. A hardcoded figure only holds while the bar renders at exactly the
 * height it was measured at in a desktop browser: on iOS the same markup comes out
 * taller (font fallback, text inflation, a larger `normal` line box for the Hebrew
 * labels), and the reset button at the end of the profile list ended up underneath
 * the bar. Measuring the gap between the scroller's bottom edge and the bar's top
 * edge is exact whatever the bar's height turns out to be, and needs no assumption
 * about safe-area insets: both rects already carry them.
 */
function useReservedSpace(bar: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const element = bar.current;
    const shell = element?.closest<HTMLElement>(".shell");
    if (!element || !shell) return;
    // Falls back to the shell itself so a screen without a scroller still reserves.
    const scroller = shell.querySelector<HTMLElement>(".shell__scroll") ?? shell;

    const measure = () => {
      const space = Math.ceil(
        scroller.getBoundingClientRect().bottom - element.getBoundingClientRect().top + TABBAR_GAP,
      );
      // A zero-height measurement (hidden tab, not laid out yet) must not shrink the
      // reserve to nothing — the CSS estimate is the better answer in that case.
      if (space > 0) shell.style.setProperty("--tabbar-space", `${space}px`);
    };

    measure();

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            measure();
          })
        : null;
    observer?.observe(element);
    observer?.observe(scroller);
    // The iOS URL bar collapsing resizes the visual viewport without resizing either
    // element, and rotation changes both — both arrive here as a window resize.
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      shell.style.removeProperty("--tabbar-space");
    };
  }, [bar]);
}

export function TabBar() {
  const { t } = useI18n();
  const bar = useRef<HTMLElement>(null);
  useReservedSpace(bar);
  const tabs = [
    { to: "/", label: t.nav.home, icon: <HomeIcon />, end: true },
    { to: "/map", label: t.nav.map, icon: <MapIcon />, end: false },
    { to: "/saved", label: t.nav.saved, icon: <BookmarkIcon />, end: false },
    { to: "/profile", label: t.nav.profile, icon: <UserIcon />, end: false },
  ];

  return (
    <nav className="tabbar glass" aria-label={t.appName} ref={bar}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}>
          {tab.icon}
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
