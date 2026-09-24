/**
 * A modal bottom sheet for phones — the one frame every "pick an action" or "fill
 * this in" panel on a detail screen rises in.
 *
 * Portalled to <body>: the cards it opens from are glass, and a backdrop filter makes
 * an ancestor the containing block for fixed children, which would clip the sheet to
 * the card. At body level it is fixed to the viewport and capped at the shell's width,
 * so on a desktop it still rises inside the phone column.
 *
 * While open it behaves as a dialog should on a phone:
 *   - the page behind stops scrolling and a dimmed scrim covers it (tap to close);
 *   - Escape closes it, and so does the system back gesture — opening pushes one
 *     history entry the back button pops, instead of leaving the page;
 *   - focus moves into the sheet, Tab stays inside it, and returns on close;
 *   - `prefers-reduced-motion` drops the slide (in CSS).
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Marks the history entry a sheet pushed, so a pop can tell it is leaving it. */
const HISTORY_KEY = "kashrootSheet";

/*
 * Back-gesture bookkeeping, shared by every sheet. An open sheet owns one history
 * entry; the back button pops it and closes the top sheet. A sheet closed from inside
 * pops its own entry — deferred a tick, so a StrictMode remount (unmount, mount, same
 * tick) takes the entry back instead — and the pop that follows is ours, not the
 * user's, so it must not close a sheet opened in the meantime.
 */
const openSheets: Array<{ current: () => void }> = [];
let pendingBack: ReturnType<typeof setTimeout> | null = null;
let backInFlight = false;
let listening = false;

function pushEntry() {
  const state: unknown = window.history.state;
  const base = typeof state === "object" && state !== null ? state : {};
  window.history.pushState({ ...base, [HISTORY_KEY]: true }, "");
}

function onPopState() {
  if (backInFlight) {
    // Our own pop landed. A sheet opened while it was in flight gets its entry now.
    backInFlight = false;
    if (openSheets.length > 0 && !sheetEntryIsCurrent()) pushEntry();
    return;
  }
  if (!sheetEntryIsCurrent()) openSheets[openSheets.length - 1]?.current();
}

function claimEntry(close: { current: () => void }) {
  if (!listening) {
    window.addEventListener("popstate", onPopState);
    listening = true;
  }
  openSheets.push(close);
  if (pendingBack !== null) {
    clearTimeout(pendingBack);
    pendingBack = null;
  } else if (!backInFlight && !sheetEntryIsCurrent()) {
    pushEntry();
  }
}

function releaseEntry(close: { current: () => void }) {
  openSheets.splice(openSheets.indexOf(close), 1);
  if (openSheets.length > 0 || backInFlight || !sheetEntryIsCurrent()) return;
  pendingBack = setTimeout(() => {
    pendingBack = null;
    if (openSheets.length > 0 || !sheetEntryIsCurrent()) return;
    backInFlight = true;
    window.history.back();
    // Should the pop never arrive, the next real back gesture must still count.
    setTimeout(() => {
      backInFlight = false;
    }, 1000);
  }, 0);
}

// Nested sheets share one lock: the body is released when the last one closes.
let lockCount = 0;
let savedOverflow = "";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function sheetEntryIsCurrent(): boolean {
  const state: unknown = window.history.state;
  return typeof state === "object" && state !== null && HISTORY_KEY in state;
}

export function BottomSheet({
  label,
  closeLabel,
  onClose,
  className,
  children,
}: {
  /** The dialog's accessible name. */
  label: string;
  /** Names the scrim, the one control every sheet shares. */
  closeLabel: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  // Read through a ref so a parent passing a fresh closure each render does not
  // tear down the listeners (and re-push history) on every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Scroll lock.
  useEffect(() => {
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = savedOverflow;
    };
  }, []);

  // Focus in, focus back.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus({ preventScroll: true });
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  // Escape, and Tab kept inside.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The back gesture closes the sheet instead of leaving the page.
  useEffect(() => {
    claimEntry(closeRef);
    return () => releaseEntry(closeRef);
  }, []);

  return createPortal(
    <>
      <button
        type="button"
        className="bsheet__scrim"
        aria-label={closeLabel}
        tabIndex={-1}
        onClick={() => closeRef.current()}
      />
      <section
        ref={panel}
        className={`bsheet${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div className="bsheet__handle" aria-hidden="true" />
        {children}
      </section>
    </>,
    document.body,
  );
}
