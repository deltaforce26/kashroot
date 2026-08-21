/**
 * The floating glass tab bar from every full screen in the design.
 *
 * The second slot is the map, not search: home now carries the search field itself,
 * so a search tab would only lead to the screen the user is already on. The map is
 * the one view of the same results home cannot give.
 */

import { NavLink } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { BookmarkIcon, HomeIcon, MapIcon, UserIcon } from "./icons";

export function TabBar() {
  const { t } = useI18n();
  const tabs = [
    { to: "/", label: t.nav.home, icon: <HomeIcon />, end: true },
    { to: "/map", label: t.nav.map, icon: <MapIcon />, end: false },
    { to: "/saved", label: t.nav.saved, icon: <BookmarkIcon />, end: false },
    { to: "/profile", label: t.nav.profile, icon: <UserIcon />, end: false },
  ];

  return (
    <nav className="tabbar glass" aria-label={t.appName}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}>
          {tab.icon}
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
