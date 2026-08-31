/**
 * One saved list, on its own page (`/saved/:listId`).
 *
 * The list's name is the heading, its places are full row cards stacked one per
 * line — not the home screen's two-up grid. A list is something a person reads
 * through and shares, so each entry gets the room to carry the verdict pill and the
 * one line of evidence behind it; halving the width would cost exactly that line.
 *
 * Sharing lives here rather than on the saved index, because what you share is a
 * list. The text carries names and links only — see `saved/shareText.ts`.
 *
 * Every verdict on this page is the API's answer as of now. The saved snapshot is
 * used for two things only: rendering a place while the API is unreachable, and
 * noticing that today's answer is worse than the saved one.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AddPlacesSheet } from "../components/AddPlacesSheet";
import { DegradationBanner } from "../components/DegradationBanner";
import { RestaurantRowCard, tintClass } from "../components/RestaurantCard";
import { ChevronIcon, PlusIcon, ShareIcon } from "../components/icons";
import { TabBar } from "../components/TabBar";
import { pickName, useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaved } from "../saved/SavedProvider";
import { hasDegraded, listById, type SavedPlace } from "../saved/saved";
import { savedListAsText } from "../saved/shareText";
import { useSavedDetails } from "../saved/useSavedDetails";

/**
 * A place the API has not answered for — offline, or still in flight. It is drawn
 * from the snapshot and says so: no pill, because the only verdict we could put
 * there is an old one, and an old verdict shown as current is the one thing the
 * product must never do.
 */
function SnapshotRow({
  place,
  offline,
  onRemove,
}: {
  place: SavedPlace;
  offline: boolean;
  onRemove: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <article
      className={`card ${tintClass(place.dietType)}`}
      style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 8 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={`/r/${place.restaurantId}`} className="card__title">
          {pickName(lang, place.nameHe, place.nameEn)}
        </Link>
        <div className="card__meta on-tint">{place.cityHe ?? ""}</div>
      </div>
      <span className="verdict" style={{ color: "var(--sub)", flex: "none" }}>
        {offline ? t.saved.offline : t.states.loadingShort}
      </span>
      <button type="button" className="sub" style={{ fontSize: 11.5 }} onClick={onRemove}>
        {t.saved.removeFromList}
      </button>
    </article>
  );
}

export function SavedList() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { listId } = useParams();
  const { state, removeFromList, deleteList } = useSaved();
  const { profile } = useProfile();

  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const list = listId ? listById(state, listId) : null;
  const { details, offline } = useSavedDetails(
    list ? list.places.map((place) => place.restaurantId) : [],
    toPayload(profile),
  );

  const goBack = () => navigate("/saved");

  if (!list) {
    return (
      <div className="shell">
        <header className="shell__header">
          <button type="button" className="circle glass" aria-label={t.saved.back} onClick={goBack}>
            <ChevronIcon />
          </button>
        </header>
        <div className="shell__scroll" style={{ paddingTop: 14 }}>
          <div className="state" role="status">
            <span className="state__mark tint-neutral" aria-hidden="true" />
            <h2 className="state__title">{t.saved.notFound.title}</h2>
            <p className="state__body">{t.saved.notFound.body}</p>
            <div className="state__actions">
              <button type="button" className="cta" onClick={goBack}>
                {t.saved.back}
              </button>
            </div>
          </div>
        </div>
        <TabBar />
      </div>
    );
  }

  const cities = [...new Set(list.places.map((place) => place.cityHe).filter(Boolean))];
  const meta = [t.saved.placesCount(list.places.length), ...cities].join(" · ");

  /**
   * Web Share where the browser has it, clipboard otherwise. A cancelled sheet is
   * not an error and must not fall through to a silent copy, so the paths never chain.
   */
  async function handleShare() {
    if (!list) return;
    const text = savedListAsText(list, lang, t, window.location.origin);
    if (!text) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: list.name, text });
      } catch {
        // Cancelled, or the sheet refused the payload. Nothing to report.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission — nothing was copied and nothing is claimed.
    }
  }

  return (
    <div className="shell">
      <header className="shell__header">
        <button type="button" className="circle glass" aria-label={t.saved.back} onClick={goBack}>
          <ChevronIcon />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              font: "700 22px Assistant, sans-serif",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {list.name}
          </h1>
          <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{meta}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          {list.places.length > 0 && (
            <button
              type="button"
              className="circle glass"
              aria-label={t.saved.share}
              onClick={handleShare}
            >
              <ShareIcon />
            </button>
          )}
          {/* Adding after the fact is the gap the create-sheet alone left: a list you
              named last week has to be fillable from the list itself. */}
          <button
            type="button"
            className="circle glass"
            aria-label={t.saved.add.title(list.name)}
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
          </button>
        </div>
      </header>

      <div className="shell__scroll" style={{ paddingTop: 14 }}>
        {copied && (
          <p role="status" className="hint" style={{ margin: 0 }}>
            {t.saved.listCopied}
          </p>
        )}

        {list.places.length === 0 ? (
          <div className="state" role="status">
            <span className="state__mark tint-neutral" aria-hidden="true" />
            <h2 className="state__title">{t.saved.listEmpty.title}</h2>
            <p className="state__body">{t.saved.listEmpty.body}</p>
            <div className="state__actions">
              <button type="button" className="cta" onClick={() => setAdding(true)}>
                {t.saved.add.action}
              </button>
            </div>
          </div>
        ) : (
          <>
            {list.places.flatMap((place) => {
              const detail = details[place.restaurantId];
              if (!detail || !hasDegraded(place, detail.kashrut.verdict)) return [];
              return [
                <DegradationBanner
                  key={`degraded-${place.restaurantId}`}
                  listName={list.name}
                  place={place}
                  detail={detail}
                />,
              ];
            })}

            {list.places.map((place) => {
              const detail = details[place.restaurantId];
              // The heart on a card in a list means "keep this here": pressing it
              // takes the place out of *this* list and leaves any other list that
              // holds it alone.
              return detail ? (
                <RestaurantRowCard
                  key={place.restaurantId}
                  item={detail}
                  saved
                  onToggleSave={() => removeFromList(list.id, place.restaurantId)}
                />
              ) : (
                <SnapshotRow
                  key={place.restaurantId}
                  place={place}
                  offline={offline}
                  onRemove={() => removeFromList(list.id, place.restaurantId)}
                />
              );
            })}
          </>
        )}

        <p className="hint" style={{ paddingTop: 2 }}>
          {t.saved.footer}
        </p>

        {/* Two steps rather than a browser confirm: a modal dialog blocks the page,
            and deleting a list someone built should be a decision, not a reflex. */}
        {confirmingDelete ? (
          <div className="banner tint-neutral" role="status">
            <div style={{ width: "100%" }}>
              <div className="banner__body">{t.saved.deleteListConfirm}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="cta cta--ghost"
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t.saved.cancel}
                </button>
                <button
                  type="button"
                  className="cta"
                  onClick={() => {
                    deleteList(list.id);
                    navigate("/saved", { replace: true });
                  }}
                >
                  {t.saved.delete}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="cta cta--ghost"
            onClick={() => setConfirmingDelete(true)}
          >
            {t.saved.deleteList}
          </button>
        )}
      </div>

      {adding && <AddPlacesSheet list={list} onClose={() => setAdding(false)} />}

      <TabBar />
    </div>
  );
}
