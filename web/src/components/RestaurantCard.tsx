/**
 * The result card, in the design's two shapes: the wide row (3a, 3f, 3g) and the
 * photo grid tile (handoff 1c). Both carry the verdict pill on the food-tinted
 * ground; the row also carries a line of evidence.
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

import { type RefObject, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DietType } from "../api/types";
import { certifierLabel, type ResultView } from "../api/viewmodel";
import { formatDate, formatDistance, pickName, useI18n } from "../i18n/I18nProvider";
import { primaryReason, reasonText } from "../i18n/reasons";
import { useTileRestaurantPlaces } from "../hooks/useApi";
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
        daysUntilExpiry: item.kashrut.freshness?.days_until_expiry ?? null,
      })
    : null;

  const meta = [dietLabel, address || city, distance, closes].filter(Boolean).join(" · ");
  // The grid tile is half the width of a row card. Its first line carries the two
  // facts that always fit — the published diet type and the distance — and the
  // street (or city) goes on a line of its own, where it can truncate without ever
  // pushing the distance out. It is what tells two branches of one chain apart:
  // without it, two "טייסטי מיט" tiles at 2.6 km and 3.5 km read as a duplicate.
  const metaShort = [dietLabel, distance].filter(Boolean).join(" · ");
  const where = address || city;
  return { name, meta, metaShort, where, evidence };
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


/**
 * Width asked of the photo endpoint for a tile: about twice the tile's rendered
 * width (≈169px at 390pt, two columns) so it stays sharp on a 2x screen. Inside
 * the endpoint's 100–1600 bounds (`app/services/places_consts.py`).
 */
const TILE_PHOTO_WIDTH_PX = 680;

/**
 * How far ahead of the viewport a tile starts its Places request — about one tile
 * row — so the photo is usually in by the time the tile scrolls into view.
 */
const TILE_PREFETCH_MARGIN = "200px 0px";

/**
 * The server hands each photo back as `/v1/restaurants/{id}/photos/{i}?w=800`,
 * sized for the detail hero. A tile re-asks at its own width; a URL with no `w`
 * (the offline fixtures' drawn placeholders) is left exactly as it came.
 */
function atTileWidth(url: string): string {
  return url.replace(/([?&])w=\d+/, `$1w=${TILE_PHOTO_WIDTH_PX}`);
}

/**
 * True once the element has come within `TILE_PREFETCH_MARGIN` of the viewport,
 * and true for good after that — a tile scrolled past and back does not refetch.
 *
 * Without IntersectionObserver (jsdom, a very old engine) it stays false, so the
 * tile never fetches and renders body-only — the same layout a restaurant with no
 * Google photo gets. That keeps the full-app tests from firing a Places request
 * per tile; the tile tests stub an observer to exercise the photo path.
 */
function useNearViewport(ref: RefObject<Element>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (near || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: TILE_PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

/**
 * The browse grid tile (design 1c): the restaurant's first Google photo over its
 * name, one line of facts, the street, and the verdict pill on the food-tinted
 * ground.
 *
 * Home and search both use this tile, so a restaurant looks the same wherever it
 * appears in a grid. The whole tile is the link — one stretched anchor over the
 * card rather than a click handler on the <article>, so it keeps real link
 * semantics (keyboard focus, middle-click, open-in-new-tab). There is no go
 * button: a card that is itself the target does not need an arrow repeating it.
 *
 * The photo is decoration, fetched lazily per tile once it nears the viewport
 * (`useTileRestaurantPlaces`). The photo area is not drawn until the Places answer
 * says a photo exists — a restaurant without one collapses to the body instead of
 * opening an empty box and then shutting it again. Once drawn, the tinted ground
 * shows through until the image arrives; an image that fails to load takes the
 * area away again. Google's terms require the photographer's credit on every
 * photo shown off a Google map, so the chip goes wherever the photo goes.
 *
 * Nothing here touches the verdict. The pill renders whatever the API sent, before,
 * during and after the photo request, and a Places failure only ever means "no
 * photo". The design's meta line also carries a star rating; we have no rating
 * source and invent none, and a star beside a kashrut verdict is the adjacency the
 * design itself forbids — so the meta line is the diet type and the distance only.
 *
 * It shows no Fit Score either. At half a row card's width there is no room for
 * Layer 2 to sit anywhere but beside the verdict pill; the score keeps its labelled
 * row on the row card and on the restaurant screen.
 */
export function RestaurantGridCard({ item, saved, onToggleSave }: CardProps) {
  const { t } = useI18n();
  const { name, metaShort, where } = useCardText(item);
  const tileRef = useRef<HTMLElement>(null);
  const near = useNearViewport(tileRef);
  const places = useTileRestaurantPlaces(item.id, near);
  const [photoState, setPhotoState] = useState<"loading" | "loaded" | "failed">("loading");

  const photo = places.data?.photos[0] ?? null;
  const showPhoto = photo !== null && photoState !== "failed";
  const credit = photo?.attributions[0]?.display_name;

  return (
    <article
      ref={tileRef}
      className={`card card--grid ${tintClass(item.dietType)}${showPhoto ? "" : " card--bare"}`}
    >
      <Link to={`/r/${item.id}`} className="card__link" aria-label={name} />
      {showPhoto && photo && (
        <div className="tile__photo">
          <img
            className={`tile__img${photoState === "loaded" ? " tile__img--in" : ""}`}
            src={atTileWidth(photo.url)}
            alt=""
            decoding="async"
            onLoad={() => setPhotoState("loaded")}
            onError={() => setPhotoState("failed")}
          />
          <span className="tile__credit">{credit ? `${credit} · Google` : "Google"}</span>
        </div>
      )}
      <div className="tile__body">
        <span className="card__title tile__name">{name}</span>
        <div className="card__meta on-tint tile__meta">{metaShort}</div>
        {/* The street (or city) on a line of its own, where it can truncate without
            pushing the distance out. It is what tells two branches of one chain
            apart — see `gridCardBranches.test.tsx`. */}
        {where && <div className="card__meta on-tint tile__meta card__where">{where}</div>}
        <div className="card__foot tile__foot">
          <VerdictPill verdict={item.kashrut.verdict} />
        </div>
      </div>
      {/* After the link in source order and raised with `.card__above`, so a tap
          toggles the save and never follows the tile's link. Over the photo's
          top-left corner, or the body's when there is no photo. */}
      <button
        type="button"
        className="card__above tile__save"
        aria-label={saved ? t.restaurant.saved : t.restaurant.save}
        aria-pressed={saved}
        onClick={() => onToggleSave(item)}
      >
        <BookmarkIcon size={15} filled={saved} />
      </button>
    </article>
  );
}
