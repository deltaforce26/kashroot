/**
 * Launch — the Kaf Bowl drawing itself.
 *
 * Implements `design/Kashroot Launch Animation.dc.html`. One gesture, taken from how
 * the mark is built: the pip drops in, the bowl draws under it to catch it, the
 * wordmark settles. There is never a spinner in the centre — the mark *is* the
 * loading indicator.
 *
 *   5a  draw   0.00–1.35s   pip 0.00–0.55, bowl 0.20–1.20, wordmark 1.05–1.35
 *   5b  slow   from 1.60s   only if the app is not ready yet — pip breathes, bar sweeps
 *       exit   320ms        the mark fades and the pip lifts, revealing the app
 *
 * **5c is not implemented — dropped by decision, not by omission.** The doc's third
 * variant shrinks the mark into a Home header logo slot while a stack of skeleton
 * restaurant cards rises behind it. Neither exists: the built Home is a 2-up tinted
 * grid under a pin/place/bell header with no logo. Rather than animate a layout the
 * next frame contradicts, the launch screen simply ends.
 *
 * It ends on the doc's own terms even so. 5a is not only a draw-on — its keyframes
 * fade back out at 96–100% (`kpPip` lifts 12px and scales to .9, `kpBowl` and
 * `kpWord` fade). That tail is the exit here. Nothing about the app moves; the
 * overlay cross-fades and the app is simply there.
 *
 * What "ready" means here is the app shell, not the restaurant list: fonts loaded
 * (the wordmark is Assistant — showing it in a fallback face and swapping is worse
 * than waiting) plus one painted frame behind the overlay. The first API response is
 * deliberately *not* waited on. The hosted API suspends when idle and can take the
 * better part of a minute; holding a splash over that would be a worse lie than the
 * skeleton, which says so in words (`states.wakingUp`).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider";

/** Set on the first launch of a browsing session; a reload inside it skips the animation. */
const SESSION_KEY = "kashroot.launched";

const DRAW_MS = 1350;
const SLOW_AT_MS = 1600;
/** Once 5b is up it stays long enough to be read, rather than flashing and going. */
const SLOW_MIN_MS = 900;
/** The tail of 5a: the mark fades, the pip lifts, the app is revealed behind it. */
const EXIT_MS = 320;
/** A stalled font load must never hold the app hostage. */
const CAP_MS = 8000;
/** Reduced motion gets the finished mark, not the drawing of it, so it needs less time. */
const REDUCED_MS = 600;

type Phase = "draw" | "slow" | "exit";

/**
 * Decided once per document load, not per mount: StrictMode mounts twice in dev, and
 * a gate that reads *and writes* session storage would see its own mark on the
 * second pass and skip the animation it just armed.
 */
let decision: boolean | null = null;

function shouldPlay(): boolean {
  if (decision !== null) return decision;
  let seen = false;
  try {
    seen = sessionStorage.getItem(SESSION_KEY) === "1";
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Storage blocked (private mode, embedded webview). Play it — the cost of an
    // extra 1.35s is smaller than never showing the mark at all.
  }
  decision = !seen;
  return decision;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Fonts in, one frame painted. See the note on "ready" above. */
function whenReady(): Promise<void> {
  const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
  const painted = new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== "function") return resolve();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  return Promise.all([fonts, painted]).then(() => undefined);
}

export function LaunchScreen() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(shouldPlay);
  const [phase, setPhase] = useState<Phase>("draw");

  useEffect(() => {
    if (!visible) return;

    const reduced = prefersReducedMotion();
    const drawMs = reduced ? REDUCED_MS : DRAW_MS;
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const timers: number[] = [];
    let cancelled = false;

    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setPhase((current) => (current === "draw" ? "slow" : current));
    }, SLOW_AT_MS);

    const finish = () => {
      if (cancelled) return;
      window.clearTimeout(slowTimer);
      setPhase("exit");
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) setVisible(false);
        }, EXIT_MS),
      );
    };

    whenReady().then(() => {
      if (cancelled) return;
      // Never cut the draw-on short; and if 5b has already come up, let it be read
      // rather than yanking it away the instant the fonts land.
      const floor = elapsed() >= SLOW_AT_MS ? SLOW_AT_MS + SLOW_MIN_MS : drawMs;
      timers.push(window.setTimeout(finish, Math.max(0, floor - elapsed())));
    });

    timers.push(window.setTimeout(finish, CAP_MS));

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      timers.forEach(window.clearTimeout);
    };
  }, [visible]);

  /*
   * The app behind the overlay. It is held invisible and out of the accessibility
   * tree while the mark is up — an opaque overlay hides it from sight but not from a
   * screen reader — and released the moment the exit starts, so it is already in
   * place as the overlay fades over it. The attribute lives on <html> rather than a
   * wrapper element so that #root keeps its exact position in the flex column and no
   * layout is disturbed.
   */
  useEffect(() => {
    const root = document.documentElement;
    const app = document.getElementById("root");
    if (visible && phase !== "exit") {
      root.setAttribute("data-launch", "hold");
      app?.setAttribute("aria-hidden", "true");
    }
    return () => {
      root.removeAttribute("data-launch");
      app?.removeAttribute("aria-hidden");
    };
  }, [visible, phase]);

  if (!visible) return null;

  return createPortal(
    <div className="launch" data-phase={phase}>
      <svg
        className="launch__mark"
        viewBox="0 0 120 120"
        width="96"
        height="96"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {/* Brand gradient. It does not flip with the theme — the design keeps the
              same two stops on light and dark, so these are their own tokens rather
              than --green, which does flip. */}
          <linearGradient
            id="launchMark"
            x1="20"
            y1="20"
            x2="100"
            y2="100"
            gradientUnits="userSpaceOnUse"
          >
            <stop className="launch__stopFrom" />
            <stop className="launch__stopTo" offset="1" />
          </linearGradient>
        </defs>
        <path
          className="launch__bowl"
          d="M24 46v12c0 20 16 36 36 36s36-16 36-36V46"
          stroke="url(#launchMark)"
          strokeWidth="15"
          strokeLinecap="round"
        />
        <circle className="launch__pip" cx="60" cy="20" r="9" fill="url(#launchMark)" />
      </svg>

      {/* Only mounted in 5b: a live region that is present from the start would
          announce a wait that has not happened yet. */}
      {phase === "slow" && (
        <p className="launch__status" role="status" aria-live="polite">
          <span className="launch__statusText">{t.launch.loading}</span>
          <span className="launch__track" aria-hidden="true">
            <span className="launch__sweep" />
          </span>
        </p>
      )}

      {/* The lockup, not UI copy — the Hebrew mark stays the mark in the English UI,
          which is why it is not in the string table. */}
      <p className="launch__word">
        <span className="launch__wordHe">כשרות</span>
        <span className="launch__wordLatin">KASHROOT</span>
      </p>
    </div>,
    document.body,
  );
}
