/**
 * The one thing standing between a thrown render and a white screen.
 *
 * React unmounts the whole tree when nothing catches an error, and a PWA that
 * blanks out is indistinguishable from a PWA that failed to load — the worst way
 * for this to fail in front of an audience. This catches it and puts `ErrorPage`
 * in its place.
 *
 * Two details worth keeping:
 *   - The boundary resets itself when the location changes. Without that, the first
 *     crash is permanent: `ErrorPage`'s links would change the URL while the
 *     boundary kept rendering the crash screen.
 *   - It sits *inside* the router and providers, so the fallback has i18n and can
 *     navigate. Errors thrown by the providers themselves are above it and still
 *     reach the browser — nothing can catch those from below.
 */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ErrorPage } from "../views/ErrorPage";

interface BoundaryProps {
  children: ReactNode;
  /** Changing this clears a caught error — see the reset note above. */
  resetKey: string;
}

interface BoundaryState {
  error: Error | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(caught: unknown): BoundaryState {
    return { error: caught instanceof Error ? caught : new Error(String(caught)) };
  }

  componentDidCatch(caught: unknown, info: ErrorInfo) {
    // The only place the crash detail is allowed to surface, matching `useApi`:
    // the user reads the sentence we wrote, an engineer reads this.
    console.error("[kashroot] render crashed:", caught, info.componentStack);
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return <ErrorPage error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <Boundary resetKey={`${location.pathname}${location.search}`}>{children}</Boundary>;
}
