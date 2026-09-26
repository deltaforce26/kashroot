/**
 * The full-bleed hero at the top of a restaurant page (design: mobile detail page).
 *
 * A single Google photo when one is known, a gradient tinted by the published diet
 * type otherwise — the same tint the search cards use, so a restaurant with no
 * Google photo never looks broken, only quieter. The glass back/share/save buttons
 * float over the top; the name, meta line and an open/closed badge sit in a scrim
 * at the bottom. The verdict pill, when this page has one, sits in that same
 * overlay — this component renders it, but never derives it: `verdict` is passed
 * in exactly as the API returned it, or left out entirely on the profile-free page.
 *
 * Google photos and hours are never kashrut evidence. This component has no idea
 * what a certificate is.
 */

import type { DietType, Verdict } from "../../api/types";
import type { PlacePhotoView, PlacesHoursView } from "../../api/viewmodel";
import { useI18n } from "../../i18n/I18nProvider";
import { BookmarkIcon, ChevronIcon, ShareIcon } from "../icons";
import { tintClass } from "../RestaurantCard";
import { VerdictPill } from "../VerdictPill";

export interface RestaurantHeroSave {
  saved: boolean;
  onToggle: () => void;
}

interface RestaurantHeroProps {
  name: string;
  meta: string;
  dietType: DietType | null;
  /** The first Google photo, or `null` for the tinted placeholder. */
  photo: PlacePhotoView | null;
  /** `null` when there is no hours data at all — no badge is shown then. */
  hours: PlacesHoursView | null;
  /** Absent on the profile-free page: there is no profile there, so no verdict. */
  verdict?: Verdict;
  onBack: () => void;
  onShare?: () => void;
  save?: RestaurantHeroSave;
}

export function RestaurantHero({
  name,
  meta,
  dietType,
  photo,
  hours,
  verdict,
  onBack,
  onShare,
  save,
}: RestaurantHeroProps) {
  const { t } = useI18n();
  const openNow = hours?.openNow ?? null;

  return (
    <div className={`detail-hero${photo ? "" : ` ${tintClass(dietType)}`}`}>
      {photo && <img className="detail-hero__img" src={photo.url} alt={name} />}
      <div className="detail-hero__scrim" aria-hidden="true" />

      <div className="detail-hero__top">
        <button type="button" className="circle glass" aria-label={t.states.back} onClick={onBack}>
          <ChevronIcon />
        </button>
        <div className="detail-hero__actions">
          {onShare && (
            <button
              type="button"
              className="circle glass"
              aria-label={t.restaurant.share}
              onClick={onShare}
            >
              <ShareIcon />
            </button>
          )}
          {save && (
            <button
              type="button"
              className="circle glass"
              aria-label={save.saved ? t.restaurant.saved : t.restaurant.save}
              aria-pressed={save.saved}
              onClick={save.onToggle}
            >
              <BookmarkIcon size={17} filled={save.saved} />
            </button>
          )}
        </div>
      </div>

      <div className="detail-hero__bottom">
        {verdict && <VerdictPill verdict={verdict} size="lg" long />}
        <h1 className="detail-hero__name">{name}</h1>
        <div className="detail-hero__meta-row">
          {meta && <span className="detail-hero__meta">{meta}</span>}
          {openNow !== null && (
            <span className={`open-badge open-badge--${openNow ? "open" : "closed"}`}>
              {openNow ? t.restaurant.hours.openNow : t.restaurant.hours.closedNow}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
