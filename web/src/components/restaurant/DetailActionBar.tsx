/**
 * The sticky bottom bar: Navigate (Waze) as the primary action, Google Maps as a
 * ghost second choice, and a circular call button when there is a phone number.
 * Padded for the home-indicator safe area so it never sits under it.
 */

import type { GeoPointOut } from "../../api/types";
import { useI18n } from "../../i18n/I18nProvider";
import { googleMapsUrl, wazeUrl } from "../../location/directions";
import { PhoneIcon } from "../icons";

interface DetailActionBarProps {
  geo: GeoPointOut | null;
  phone: string | null;
}

export function DetailActionBar({ geo, phone }: DetailActionBarProps) {
  const { t } = useI18n();
  return (
    <div className="action-bar" role="group" aria-label={t.restaurant.navigate}>
      <a className="cta" href={geo ? wazeUrl(geo) : "#"} target="_blank" rel="noreferrer">
        {t.restaurant.navigateWaze}
      </a>
      <a
        className="cta cta--ghost"
        href={geo ? googleMapsUrl(geo) : "#"}
        target="_blank"
        rel="noreferrer"
      >
        {t.restaurant.navigateGoogle}
      </a>
      {phone && (
        <a className="action-bar__call glass" href={`tel:${phone}`} aria-label={t.restaurant.call}>
          <PhoneIcon />
        </a>
      )}
    </div>
  );
}
