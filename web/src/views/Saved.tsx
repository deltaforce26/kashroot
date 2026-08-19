/**
 * Saved lists — tinted covers, offline chips (design 3f).
 *
 * Lists live in `localStorage`; nothing is sent anywhere. The screen's real job is
 * the degradation banner: a place saved while it matched can stop matching, and the
 * design treats that as a first-class visible state rather than an error.
 *
 * How degradation is detected: the saved snapshot records the verdict the API gave
 * at save time; the screen re-asks the API now and compares the two verdicts. No
 * kashrut rule is evaluated here — two API answers are compared, that is all.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { kashrootApi } from "../api";
import type { ProfileRequest } from "../api/types";
import { decidingCertificate, type DetailView } from "../api/viewmodel";
import { tintClass } from "../components/RestaurantCard";
import { VerdictPill, verdictLabel } from "../components/VerdictPill";
import { BellIcon, PlusIcon } from "../components/icons";
import { TabBar } from "../components/TabBar";
import { formatDate, pickName, useI18n } from "../i18n/I18nProvider";
import { primaryReason, reasonText } from "../i18n/reasons";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaved } from "../saved/SavedProvider";
import type { SavedList, SavedPlace } from "../saved/saved";

type DetailMap = Record<string, DetailView | undefined>;

/** Re-asks the API for every saved place. Failures leave the entry simply unknown-to-us. */
function useCurrentDetails(placeIds: string[], profile: ProfileRequest) {
  const [details, setDetails] = useState<DetailMap>({});
  const [offline, setOffline] = useState(false);
  const key = placeIds.join(",");
  const profileKey = JSON.stringify(profile);

  useEffect(() => {
    if (placeIds.length === 0) return;
    const controller = new AbortController();
    let failures = 0;
    void Promise.all(
      placeIds.map((id) =>
        kashrootApi
          .getRestaurant(id, profile, undefined, controller.signal)
          .then((detail) => [id, detail] as const)
          .catch(() => {
            failures += 1;
            return [id, undefined] as const;
          }),
      ),
    ).then((entries) => {
      if (controller.signal.aborted) return;
      setDetails(Object.fromEntries(entries));
      setOffline(failures === placeIds.length);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, profileKey]);

  return { details, offline };
}

function DegradationBanner({
  list,
  place,
  detail,
}: {
  list: SavedList;
  place: SavedPlace;
  detail: DetailView;
}) {
  const { t, lang } = useI18n();
  const name = pickName(lang, place.nameHe, place.nameEn);
  const deciding = decidingCertificate(detail);
  const explaining = primaryReason(detail.kashrut.reasons);
  const why = explaining
    ? reasonText(explaining, t, lang, {
        certifierName: deciding
          ? lang === "en"
            ? (deciding.certifier.name_en ?? deciding.certifier.name_he)
            : deciding.certifier.name_he
          : place.certifierLabel,
        validUntil: formatDate(detail.kashrut.freshness?.valid_until ?? null),
        evidenceAgeDays: detail.kashrut.freshness?.evidence_age_days ?? null,
        daysUntilExpiry: detail.kashrut.freshness?.days_until_expiry ?? null,
      })
    : "";

  return (
    <div className="banner tint-sweet banner--amber" role="status">
      <span style={{ color: "var(--amber)", flex: "none", paddingTop: 1 }} aria-hidden="true">
        <BellIcon size={16} />
      </span>
      <div>
        <div className="banner__title">{t.saved.degradeTitle(list.name)}</div>
        <div className="banner__body">
          {t.saved.degradeBody(name, why, verdictLabel(detail.kashrut.verdict, t))}
        </div>
      </div>
    </div>
  );
}

export function Saved() {
  const { t, lang } = useI18n();
  const { state, addList, unsave } = useSaved();
  const { profile } = useProfile();
  const payload = toPayload(profile);

  const placeIds = state.lists.flatMap((list) => list.places.map((place) => place.restaurantId));
  const { details, offline } = useCurrentDetails(placeIds, payload);

  const countBy = (list: SavedList, verdict: string) =>
    list.places.filter((place) => details[place.restaurantId]?.kashrut.verdict === verdict).length;

  return (
    <div className="shell">
      <header className="shell__header">
        <div style={{ flex: 1 }}>
          <h1 style={{ font: "700 24px Assistant, sans-serif", margin: 0 }}>{t.saved.title}</h1>
        </div>
        <button
          type="button"
          className="circle glass"
          aria-label={t.saved.newList}
          onClick={() => addList(`${t.saved.newList} ${state.lists.length + 1}`)}
        >
          <PlusIcon />
        </button>
      </header>

      <div className="shell__scroll" style={{ paddingTop: 14 }}>
        {placeIds.length === 0 ? (
          <div className="state" role="status">
            <span className="state__mark tint-neutral" aria-hidden="true" />
            <h2 className="state__title">{t.saved.empty.title}</h2>
            <p className="state__body">{t.saved.empty.body}</p>
          </div>
        ) : (
          <>
            {state.lists.flatMap((list) =>
              list.places
                .map((place) => ({ place, detail: details[place.restaurantId] }))
                .filter(
                  ({ place, detail }) =>
                    detail !== undefined &&
                    place.verdictAtSave === "match" &&
                    detail.kashrut.verdict !== "match",
                )
                .map(({ place, detail }) =>
                  detail ? (
                    <DegradationBanner
                      key={`${list.id}-${place.restaurantId}`}
                      list={list}
                      place={place}
                      detail={detail}
                    />
                  ) : null,
                ),
            )}

            {state.lists
              .filter((list) => list.places.length > 0)
              .map((list) => (
                <details
                  key={list.id}
                  className={`card ${tintClass(list.places[0]?.dietType ?? null)}`}
                  style={{ padding: "14px 16px" }}
                  open
                >
                  <summary style={{ cursor: "pointer", listStyle: "none" }}>
                    <div className="card__title">{list.name}</div>
                    <div className="card__meta on-tint">
                      {t.saved.placesCount(list.places.length)}
                      {" · "}
                      {[...new Set(list.places.map((place) => place.cityHe).filter(Boolean))].join(
                        ", ",
                      )}
                    </div>
                    <div className="card__foot">
                      <span className="verdict verdict--match">
                        {t.saved.matchCount(countBy(list, "match"))}
                      </span>
                      {countBy(list, "unknown") > 0 && (
                        <span className="verdict verdict--unknown">
                          {t.saved.unknownCount(countBy(list, "unknown"))}
                        </span>
                      )}
                      {countBy(list, "no_match") > 0 && (
                        <span className="verdict verdict--no_match">
                          {t.saved.noMatchCount(countBy(list, "no_match"))}
                        </span>
                      )}
                      <span className="verdict" style={{ color: "var(--sub)" }}>
                        {t.saved.offline}
                      </span>
                    </div>
                  </summary>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                    {list.places.map((place) => {
                      const detail = details[place.restaurantId];
                      return (
                        <div
                          key={place.restaurantId}
                          style={{ display: "flex", alignItems: "center", gap: 8 }}
                        >
                          <Link
                            to={`/r/${place.restaurantId}`}
                            style={{ flex: 1, fontWeight: 600, fontSize: 14 }}
                          >
                            {pickName(lang, place.nameHe, place.nameEn)}
                          </Link>
                          {detail ? (
                            <VerdictPill verdict={detail.kashrut.verdict} />
                          ) : (
                            <span className="verdict" style={{ color: "var(--sub)" }}>
                              {offline ? t.saved.offline : t.states.loadingShort}
                            </span>
                          )}
                          <button
                            type="button"
                            className="sub"
                            style={{ fontSize: 11.5 }}
                            onClick={() => unsave(place.restaurantId)}
                          >
                            {t.saved.removeFromList}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}

            <p className="hint" style={{ paddingTop: 2 }}>
              {t.saved.footer}
            </p>
          </>
        )}
      </div>

      <TabBar />
    </div>
  );
}
