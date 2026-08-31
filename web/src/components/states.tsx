/**
 * Loading, error, offline and empty states — brief §"Gaps to close" 2 and 3.
 *
 * The source design has none of these. They are written in its voice and, for the
 * empty state especially, written to read as an honest answer rather than a
 * failure: given the corpus, "nothing here meets your profile" is frequently the
 * *correct* result, and the screen must not apologise for being right.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { AlertIcon, CloudOffIcon, PinIcon, SearchIcon } from "./icons";

/**
 * How long a request may run before the wait gets an explanation rather than a bare
 * skeleton. The API is hosted on a plan that suspends the instance when idle, so the
 * first request after a quiet spell pays a cold start of roughly a minute. A first-time
 * visitor has no way to tell that apart from a broken app, and silence reads as broken.
 * Short enough to pre-empt the doubt, long enough that a warm request never trips it.
 */
const SLOW_REQUEST_MS = 6000;

export function LoadingList({ rows = 4 }: { rows?: number }) {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_REQUEST_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true">
      <span className="sr-only" role="status">
        {t.states.loading}
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton" key={index} aria-hidden="true" />
      ))}
      {slow && (
        <p className="hint" role="status">
          {t.states.wakingUp}
        </p>
      )}
    </div>
  );
}

interface StateProps {
  title: string;
  body: string;
  mark: ReactNode;
  markClass?: string;
  actions?: ReactNode;
}

function StateBlock({ title, body, mark, markClass = "tint-neutral", actions }: StateProps) {
  return (
    <div className="state" role="status">
      <span className={`state__mark ${markClass}`} aria-hidden="true">
        {mark}
      </span>
      <h2 className="state__title">{title}</h2>
      <p className="state__body">{body}</p>
      {actions && <div className="state__actions">{actions}</div>}
    </div>
  );
}

/**
 * There is deliberately no way to pass a server message into this component.
 *
 * A validation dump from Pydantic — English, technical, and about our request rather
 * than the user's world — must never reach a Hebrew consumer screen. The technical
 * detail is logged once, centrally, in `useApi`; the user gets the sentence we wrote.
 */
export function ErrorState({
  isNetwork = false,
  onRetry,
}: {
  isNetwork?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <StateBlock
      title={t.states.errorTitle}
      body={isNetwork ? t.states.errorNetwork : t.states.errorGeneric}
      markClass="tint-sweet"
      mark={<AlertIcon size={26} />}
      actions={
        onRetry ? (
          <button type="button" className="cta" onClick={onRetry}>
            {t.states.retry}
          </button>
        ) : null
      }
    />
  );
}

/**
 * The empty result state. Two exits, both honest: loosen the profile, or see the
 * places that exist here without pretending they were verified.
 */
export function EmptyResults({
  onWidenProfile,
  onShowAll,
}: {
  onWidenProfile?: () => void;
  onShowAll?: () => void;
}) {
  const { t } = useI18n();
  return (
    <StateBlock
      title={t.states.emptyTitle}
      body={t.states.emptyBody}
      mark={<SearchIcon size={26} />}
      actions={
        <>
          {onWidenProfile && (
            <button type="button" className="cta" onClick={onWidenProfile}>
              {t.states.emptyActionWiden}
            </button>
          )}
          {onShowAll && (
            <button type="button" className="cta cta--ghost" onClick={onShowAll}>
              {t.states.emptyActionAll}
            </button>
          )}
        </>
      }
    />
  );
}

/**
 * A text search that matched nothing.
 *
 * The API does an exact case-insensitive substring match with no Hebrew
 * normalization, so the overwhelmingly likely cause of a miss is a spelling
 * difference — not an absent business. The copy says so and offers a way back,
 * without implying a smarter search than the one we have: no "did you mean", no
 * fuzzy suggestions, because there is no fuzzy matching behind them.
 */
export function EmptyQuery({ query, onClear }: { query: string; onClear: () => void }) {
  const { t } = useI18n();
  return (
    <StateBlock
      title={t.states.emptyQueryTitle(query)}
      body={t.states.emptyQueryBody}
      markClass="tint-sweet"
      mark={<SearchIcon size={26} />}
      actions={
        <button type="button" className="cta cta--ghost" onClick={onClear}>
          {t.states.emptyQueryAction}
        </button>
      }
    />
  );
}

/**
 * A city that returned nothing at all, before any filter was applied.
 *
 * Kept separate from `EmptyResults` on purpose. "Nothing matches your profile" is a
 * claim about kashrut evidence; an empty city is a hole in our corpus — or a
 * `city_slug` that does not exist in the database. Saying the former when the truth
 * is the latter blames the product's core promise for a data problem, which is the
 * worst way for this to fail in front of an audience.
 */
export function EmptyCity({ city, onPickAnother }: { city: string; onPickAnother?: () => void }) {
  const { t } = useI18n();
  return (
    <StateBlock
      title={t.states.emptyCityTitle(city)}
      body={t.states.emptyCityBody}
      mark={<PinIcon size={26} />}
      actions={
        onPickAnother ? (
          <button type="button" className="cta cta--ghost" onClick={onPickAnother}>
            {t.states.emptyCityAction}
          </button>
        ) : null
      }
    />
  );
}

/**
 * Shown above a result list that came back with no MATCH in it — which, with this
 * corpus, is the common case. It is a caveat on real content, not an error: the
 * list below it is still worth reading, and the copy says why. Counting how many of
 * the API's verdicts are MATCH is display logic; no verdict is derived here.
 */
export function NoVerifiedMatchesBanner() {
  const { t } = useI18n();
  return (
    <div className="banner glass banner--amber" role="status">
      <span style={{ color: "var(--amber)", flex: "none", paddingTop: 1 }} aria-hidden="true">
        <AlertIcon size={16} />
      </span>
      <div>
        <div className="banner__title">{t.states.noVerifiedTitle}</div>
        <div className="banner__body">{t.states.noVerifiedBody}</div>
      </div>
    </div>
  );
}

/** A strip, not a screen: offline is a caveat on real content, not a dead end. */
export function OfflineBanner() {
  const { t } = useI18n();
  return (
    <div className="banner glass banner--amber" role="status">
      <span style={{ color: "var(--amber)", flex: "none", paddingTop: 1 }} aria-hidden="true">
        <CloudOffIcon size={16} />
      </span>
      <div>
        <div className="banner__title">{t.states.offlineTitle}</div>
        <div className="banner__body">{t.states.offlineBody}</div>
      </div>
    </div>
  );
}

export function NotFoundState({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  return (
    <StateBlock
      title={t.states.notFound}
      body={t.states.emptyBody}
      mark={<AlertIcon size={26} />}
      actions={
        <button type="button" className="cta" onClick={onBack}>
          {t.states.back}
        </button>
      }
    />
  );
}
