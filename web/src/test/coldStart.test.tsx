/**
 * The hosted API runs on a plan that suspends the instance when idle, so the first
 * request after a quiet spell can take the better part of a minute. A skeleton with no
 * explanation is indistinguishable from a broken app, and the people opening the link
 * will be first-time visitors on phones.
 *
 * These pin both halves of that: the explanation appears when the wait is genuinely
 * long, and never appears on a warm request.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { LoadingList } from "../components/states";
import { STRINGS } from "../i18n/strings";

function renderLoading() {
  return render(
    <I18nProvider>
      <LoadingList />
    </I18nProvider>,
  );
}

describe("cold-start explanation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing extra while the request is still plausibly fast", () => {
    renderLoading();

    vi.advanceTimersByTime(2000);

    expect(screen.queryByText(STRINGS.he.states.wakingUp)).not.toBeInTheDocument();
  });

  it("explains the wait once it is long enough to look broken", async () => {
    renderLoading();

    vi.advanceTimersByTime(7000);

    expect(await screen.findByText(STRINGS.he.states.wakingUp)).toBeInTheDocument();
  });

  it("still shows the skeleton, so the explanation supplements rather than replaces it", async () => {
    const { container } = renderLoading();

    vi.advanceTimersByTime(7000);

    await screen.findByText(STRINGS.he.states.wakingUp);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });
});
