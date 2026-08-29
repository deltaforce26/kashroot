/**
 * Saved — the index of lists (design 3f).
 *
 * This screen is a shelf, not a viewer: each list is one tinted card that opens its
 * own page. The lists used to expand in place, which meant the screen grew without
 * bound and a list's own page — the thing you name, the thing you share — did not
 * exist. Places live on `/saved/:listId`.
 *
 * What stays here is the degradation banner across every list, because it is the one
 * thing a person must see without going looking for it: a place saved while it
 * matched can stop matching. Nothing on this screen evaluates a kashrut rule — the
 * snapshot's verdict and today's verdict are two API answers, and `hasDegraded`
 * compares them.
 *
 * Lists are device-local; nothing is sent anywhere.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DegradationBanner } from "../components/DegradationBanner";
import { NewListSheet } from "../components/NewListSheet";
import { tintClass } from "../components/RestaurantCard";
import { PlusIcon } from "../components/icons";
import { TabBar } from "../components/TabBar";
import { useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaved } from "../saved/SavedProvider";
import { countVerdicts, hasDegraded, type SavedList } from "../saved/saved";
import { useSavedDetails, type DetailMap } from "../saved/useSavedDetails";

/** The one line of facts under a list's name: how many places, and where they are. */
function listMeta(list: SavedList, placesCount: (n: number) => string): string {
  const cities = [...new Set(list.places.map((place) => place.cityHe).filter(Boolean))];
  return [placesCount(list.places.length), ...(cities.length > 0 ? [cities.join(", ")] : [])].join(
    " · ",
  );
}

function ListCard({ list, details }: { list: SavedList; details: DetailMap }) {
  const { t } = useI18n();
  const counts = countVerdicts(
    list.places.map((place) => details[place.restaurantId]?.kashrut.verdict),
  );

  return (
    <article
      className={`card ${tintClass(list.places[0]?.dietType ?? null)}`}
      style={{ padding: "14px 16px" }}
    >
      {/* The whole card is the link — a stretched anchor rather than a click handler
          on the <article>, so it keeps real link semantics: keyboard focus,
          middle-click, open-in-new-tab. */}
      <Link
        to={`/saved/${list.id}`}
        className="card__link"
        aria-label={t.saved.openList(list.name)}
      />
      <div className="card__title">{list.name}</div>
      <div className="card__meta on-tint">{listMeta(list, t.saved.placesCount)}</div>
      {list.places.length > 0 && (
        <div className="card__foot">
          <span className="verdict verdict--match">{t.saved.matchCount(counts.match)}</span>
          {counts.unknown > 0 && (
            <span className="verdict verdict--unknown">{t.saved.unknownCount(counts.unknown)}</span>
          )}
          {counts.no_match > 0 && (
            <span className="verdict verdict--no_match">
              {t.saved.noMatchCount(counts.no_match)}
            </span>
          )}
          <span className="verdict" style={{ color: "var(--sub)" }}>
            {t.saved.offline}
          </span>
        </div>
      )}
    </article>
  );
}

export function Saved() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { state } = useSaved();
  const { profile } = useProfile();
  const [creating, setCreating] = useState(false);

  const placeIds = state.lists.flatMap((list) => list.places.map((place) => place.restaurantId));
  const { details } = useSavedDetails(placeIds, toPayload(profile));

  return (
    <div className="shell">
      <header className="shell__header">
        <div style={{ flex: 1 }}>
          <h1 style={{ font: "700 24px Assistant, sans-serif", margin: 0 }}>{t.saved.title}</h1>
        </div>
        {/* The plus is the only action this screen owns. Sharing belongs to a list,
            so it lives on the list's own page. */}
        <button
          type="button"
          className="circle glass"
          aria-label={t.saved.newList}
          onClick={() => setCreating(true)}
        >
          <PlusIcon />
        </button>
      </header>

      <div className="shell__scroll" style={{ paddingTop: 14 }}>
        {state.lists.length === 0 ? (
          <div className="state" role="status">
            <span className="state__mark tint-neutral" aria-hidden="true" />
            <h2 className="state__title">{t.saved.empty.title}</h2>
            <p className="state__body">{t.saved.empty.body}</p>
            <div className="state__actions">
              <button type="button" className="cta" onClick={() => setCreating(true)}>
                {t.saved.newList}
              </button>
            </div>
          </div>
        ) : (
          <>
            {state.lists.flatMap((list) =>
              list.places.flatMap((place) => {
                const detail = details[place.restaurantId];
                if (!detail || !hasDegraded(place, detail.kashrut.verdict)) return [];
                return [
                  <DegradationBanner
                    key={`${list.id}-${place.restaurantId}`}
                    listName={list.name}
                    place={place}
                    detail={detail}
                  />,
                ];
              }),
            )}

            {state.lists.map((list) => (
              <ListCard key={list.id} list={list} details={details} />
            ))}

            <p className="hint" style={{ paddingTop: 2 }}>
              {t.saved.footer}
            </p>
          </>
        )}
      </div>

      {creating && (
        <NewListSheet
          onClose={() => setCreating(false)}
          onCreated={(list) => {
            setCreating(false);
            navigate(`/saved/${list.id}`);
          }}
        />
      )}

      <TabBar />
    </div>
  );
}
