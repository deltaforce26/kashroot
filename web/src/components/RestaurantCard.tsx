/**
 * The result card, in the design's two shapes: the wide row (3a, 3f, 3g) and the
 * square tile (3e). Both carry the same three things — the verdict pill, one line
 * of evidence, and the food-tinted ground.
 *
 * The evidence line is the API's deciding reason rendered through the reason table,
 * not a sentence assembled here. On a MATCH that is "Badatz Mehadrin (Rubin) — on
 * your list", exactly as the design writes it; on an UNKNOWN it is whatever the
 * engine actually found missing.
 *
 * Known fidelity gap: `POST /v1/search` does not return `diet_type`, so list cards
 * fall back to the neutral tint. The design tints by food category and the detail
 * screen still does — see `viewmodel.ts`.
 */

import { Link } from "react-router-dom";
import type { DietType } from "../api/types";
import { certifierLabel, type ResultView } from "../api/viewmodel";
import { formatDate, formatDistance, pickName, useI18n } from "../i18n/I18nProvider";
import { primaryReason, reasonText } from "../i18n/reasons";
import { ArrowIcon, BookmarkIcon } from "./icons";
import { FitScoreBar } from "./FitScoreBar";
import { VerdictPill } from "./VerdictPill";

/** Food tint per published diet type — decoration keyed to a fact, not to a verdict. */
export function tintClass(diet: DietType | null): string {
  switch (diet) {
    case "meat":
      return "tint-meat";
    case "dairy":
    case "dairy_pareve":
      return "tint-dairy";
    case "pareve":
      return "tint-sweet";
    default:
      return "tint-neutral";
  }
}

function useCardText(item: ResultView) {
  const { t, lang } = useI18n();
  const name = pickName(lang, item.nameHe, item.nameEn);
  const address = item.addressHe ?? "";
  const city = item.cityHe ?? "";
  const distance = formatDistance(item.distanceKm, t);
  const dietLabel = item.dietType ? t.diet[item.dietType] : null;
  const closes = item.closesAt ? t.units.closesAt(item.closesAt) : null;

  const deciding = primaryReason(item.kashrut.reasons);
  const evidence = deciding
    ? reasonText(deciding, t, lang, {
        certifierName: certifierLabel(item, lang),
        validUntil: formatDate(item.kashrut.freshness?.valid_until ?? null),
        evidenceAgeDays: item.kashrut.freshness?.evidence_age_days ?? null,
        daysUntilExpiry: item.kashrut.freshness?.days_until_expiry ?? null,
      })
    : null;

  const meta = [dietLabel, address || city, distance, closes].filter(Boolean).join(" · ");
  // The grid tile is half the width of a row card; it carries only the two facts
  // that fit there — the published diet type and the distance.
  const metaShort = [dietLabel, distance].filter(Boolean).join(" · ");
  return { name, meta, metaShort, evidence };
}

interface CardProps {
  item: ResultView;
  saved: boolean;
  onToggleSave: (item: ResultView) => void;
}

export function RestaurantRowCard({ item, saved, onToggleSave }: CardProps) {
  const { t } = useI18n();
  const { name, meta, evidence } = useCardText(item);

  return (
    <article className={`card card--row ${tintClass(item.dietType)}`}>
      <span className="card__photo stripe" aria-hidden="true">
        {t.photoPlaceholder}
      </span>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <Link to={`/r/${item.id}`} className="card__title">
          {name}
        </Link>
        <button
          type="button"
          aria-label={saved ? t.restaurant.saved : t.restaurant.save}
          aria-pressed={saved}
          onClick={() => onToggleSave(item)}
        >
          <BookmarkIcon size={17} filled={saved} />
        </button>
      </div>
      <div className="card__meta on-tint">{meta}</div>
      <div className="card__foot">
        <VerdictPill verdict={item.kashrut.verdict} />
        {evidence && (
          <span
            className="card__evidence on-tint"
            style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {evidence}
          </span>
        )}
        <Link to={`/r/${item.id}`} className="circle circle--sm circle--cta card__go" aria-label={name}>
          <ArrowIcon />
        </Link>
      </div>
      {/* Layer 2, on its own full-width row and under its own label — never beside
          the verdict. `.fit-row` is the structural guarantee: it is a block that
          holds the fit score and nothing else, so no layout change can slide it up
          alongside the pill and let the two read as one metric. */}
      <div className="fit-row">
        <FitScoreBar fit={item.fit} />
      </div>
    </article>
  );
}

export function RestaurantTileCard({ item, saved, onToggleSave }: CardProps) {
  const { t } = useI18n();
  const { name, meta } = useCardText(item);

  return (
    <article className={`card card--tile ${tintClass(item.dietType)}`}>
      {/* The whole tile is the link. It is one stretched anchor covering the card
          rather than a click handler on the <article>, so it keeps real link
          semantics — keyboard focus, middle-click, open-in-new-tab. The save
          button sits above it on `.card__above`. */}
      <Link to={`/r/${item.id}`} className="card__link" aria-label={name} />
      <span className="card__photo stripe" aria-hidden="true">
        {t.photoPlaceholder}
      </span>
      {/* `position: relative` with no z-index keeps this head painting above the
          absolutely positioned photo (tree order) without opening a stacking
          context — so the save button's `.card__above` still resolves against the
          card and stays above the stretched link. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 6,
          position: "relative",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <span className="card__title" style={{ fontSize: 15 }}>
            {name}
          </span>
          <div className="card__meta on-tint" style={{ fontSize: 11 }}>
            {meta}
          </div>
        </div>
        <button
          type="button"
          className="card__above"
          aria-label={saved ? t.restaurant.saved : t.restaurant.save}
          aria-pressed={saved}
          onClick={() => onToggleSave(item)}
        >
          <BookmarkIcon size={17} filled={saved} />
        </button>
      </div>
      {/* The tile has the same two-row structure as the row card, for the same
          reason: the verdict pill and the fit score were once DOM siblings here,
          separated only by `flex-direction: column`. One flipped CSS line would have
          put a kashrut verdict and a preference score side by side as one apparent
          metric. They are now in separate rows by construction. */}
      <div className="card__tile-foot">
        <div className="card__foot card__foot--tile">
          <VerdictPill verdict={item.kashrut.verdict} />
        </div>
        <div className="fit-row">
          <FitScoreBar fit={item.fit} />
        </div>
      </div>
    </article>
  );
}

/**
 * The home grid tile: name, one line of facts and the verdict pill over the
 * tinted, striped ground.
 *
 * The whole tile is the link, the same way the search tile is — one stretched
 * anchor over the card rather than a click handler on the <article>, so it keeps
 * real link semantics (keyboard focus, middle-click, open-in-new-tab). That
 * replaces the go button the comp drew in the foot: a card that is itself the
 * target does not need an arrow repeating the same destination, and dropping it
 * gives the verdict pill the foot row to itself.
 *
 * It shows no Fit Score. That is the point of the shape — at half a row card's
 * width there is no room for Layer 2 to sit anywhere but beside the verdict pill,
 * and a preference score touching a kashrut verdict is the one adjacency the
 * design brief forbids. The score still has a home on the search tile and on the
 * restaurant screen, where it gets a labelled row of its own.
 */
export function RestaurantGridCard({ item, saved, onToggleSave }: CardProps) {
  const { t } = useI18n();
  const { name, metaShort } = useCardText(item);

  return (
    <article className={`card card--grid ${tintClass(item.dietType)}`}>
      <Link to={`/r/${item.id}`} className="card__link" aria-label={name} />
      <span className="card__photo stripe" aria-hidden="true">
        {t.photoPlaceholder}
      </span>
      {/* The head is `position: relative` with no z-index (see `.card--grid
          .card__head`), so it paints above the photo by tree order without opening
          a stacking context — which is what lets the save button's `.card__above`
          resolve against the card and stay above the stretched link. */}
      <div className="card__head">
        <div style={{ minWidth: 0 }}>
          <span className="card__title" style={{ fontSize: 15 }}>
            {name}
          </span>
          <div className="card__meta on-tint" style={{ fontSize: 11 }}>
            {metaShort}
          </div>
        </div>
        <button
          type="button"
          className="card__above"
          aria-label={saved ? t.restaurant.saved : t.restaurant.save}
          aria-pressed={saved}
          onClick={() => onToggleSave(item)}
        >
          <BookmarkIcon size={17} filled={saved} />
        </button>
      </div>
      <div className="card__foot">
        <VerdictPill verdict={item.kashrut.verdict} />
      </div>
    </article>
  );
}
