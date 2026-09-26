/**
 * Address, phone and website as plain facts — the restaurant's own record, not
 * Google's. Renders nothing when there is nothing to show.
 */

import { useI18n } from "../../i18n/I18nProvider";
import { PhoneIcon, PinIcon } from "../icons";

interface DetailsListProps {
  addressHe: string | null;
  cityHe: string | null;
  phone: string | null;
  website: string | null;
}

export function DetailsList({ addressHe, cityHe, phone, website }: DetailsListProps) {
  const { t } = useI18n();
  const address = [addressHe, cityHe].filter(Boolean).join(", ");
  if (!address && !phone && !website) return null;

  return (
    <section className="details-list" aria-label={t.restaurant.details.title}>
      <div className="details-list__head">
        <span className="details-list__eyebrow">{t.restaurant.details.title}</span>
      </div>
      {address && (
        <div className="details-list__row">
          <PinIcon size={16} />
          <span>{address}</span>
        </div>
      )}
      {phone && (
        <a className="details-list__row" href={`tel:${phone}`}>
          <PhoneIcon size={16} />
          <span>{phone}</span>
        </a>
      )}
      {website && (
        <a className="details-list__row" href={website} target="_blank" rel="noreferrer">
          <span>{t.restaurant.details.website}</span>
        </a>
      )}
    </section>
  );
}
