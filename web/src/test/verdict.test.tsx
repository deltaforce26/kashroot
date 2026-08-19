/**
 * The verdict-rendering guarantees, asserted rather than trusted:
 *   - every verdict reads as a word, never a number;
 *   - the Layer 2 fit score is present, numeric, and labelled as preferences only;
 *   - the evidence panel prints the API's reasons and nothing it invented.
 */

import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { CertificateEvidenceOut, KashrutVerdictOut, Verdict } from "../api/types";
import { EvidencePanel } from "../components/EvidencePanel";
import { FitScoreBar } from "../components/FitScoreBar";
import { VerdictPill } from "../components/VerdictPill";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";

function renderHe(node: ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

const DECIDING: CertificateEvidenceOut = {
  certificate_id: "c1",
  certifier: {
    id: "cert-rubin",
    name_he: "בד״ץ מהדרין (רובין)",
    name_en: "Badatz Mehadrin (Rubin)",
    type: "badatz",
  },
  level: "mehadrin",
  attributes: { chalav_yisrael: true, pas_yisrael: true },
  state: "active",
  valid_from: "2025-10-01",
  valid_until: "2026-09-30",
  provenance: {
    source: "moderator_verified",
    verified_by_label: "מנהל תוכן",
    verified_at: "2026-08-11T00:00:00Z",
    corroboration_count: 1,
  },
  outcome: "match",
  reasons: [],
  confidence: "high",
  freshness: {
    verified_at: "2026-08-11T00:00:00Z",
    evidence_age_days: 6,
    valid_until: "2026-09-30",
    days_until_expiry: 44,
    is_stale: false,
    expires_soon: false,
  },
};

const MATCH: KashrutVerdictOut = {
  verdict: "match",
  reasons: [
    { code: "certifier_in_whitelist", attribute: null },
    { code: "attribute_present", attribute: "chalav_yisrael" },
    { code: "attribute_present", attribute: "pas_yisrael" },
    { code: "certificate_valid", attribute: null },
    { code: "evidence_fresh", attribute: null },
  ],
  confidence: "high",
  freshness: DECIDING.freshness,
  deciding_certificate_id: "c1",
};

describe("VerdictPill", () => {
  it.each<[Verdict, string]>([
    ["match", STRINGS.he.verdict.match],
    ["unknown", STRINGS.he.verdict.unknown],
    ["no_match", STRINGS.he.verdict.noMatch],
  ])("renders %s as a word", (verdict, expected) => {
    renderHe(<VerdictPill verdict={verdict} />);
    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  });

  it("never renders a digit — kashrut is not a number", () => {
    for (const verdict of ["match", "unknown", "no_match"] as Verdict[]) {
      const { container, unmount } = renderHe(<VerdictPill verdict={verdict} long />);
      expect(container.textContent ?? "").not.toMatch(/\d/);
      unmount();
    }
  });

  it("gives NO_MATCH its own class rather than reusing the UNKNOWN treatment", () => {
    const { container } = renderHe(<VerdictPill verdict="no_match" />);
    expect(container.querySelector(".verdict--no_match")).not.toBeNull();
    expect(container.querySelector(".verdict--unknown")).toBeNull();
  });
});

describe("FitScoreBar", () => {
  it("shows the number under a label that says it is preferences only", () => {
    renderHe(<FitScoreBar fit={{ score: 82, components: [] }} />);
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText(STRINGS.he.fit.label)).toBeInTheDocument();
    expect(screen.getByText(STRINGS.he.fit.aria(82))).toBeInTheDocument();
  });

  it("clamps out-of-range scores instead of drawing past the bar", () => {
    renderHe(<FitScoreBar fit={{ score: 140, components: [] }} />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("is not styled as a verdict pill", () => {
    const { container } = renderHe(<FitScoreBar fit={{ score: 50, components: [] }} />);
    expect(container.querySelector(".verdict")).toBeNull();
  });
});

describe("EvidencePanel", () => {
  it("renders one line per API reason, grouping repeated attribute reasons", () => {
    renderHe(<EvidencePanel match={MATCH} deciding={DECIDING} />);
    const panel = screen.getByLabelText(STRINGS.he.verdict.whyMatch);
    const rows = within(panel).getAllByRole("listitem");
    // certifier / attributes (grouped) / valid / fresh
    expect(rows).toHaveLength(4);
    expect(rows[1]?.textContent).toContain(STRINGS.he.attributes.chalav_yisrael);
    expect(rows[1]?.textContent).toContain(STRINGS.he.attributes.pas_yisrael);
  });

  it("names the certifier from the deciding certificate and says it is on your list", () => {
    renderHe(<EvidencePanel match={MATCH} deciding={DECIDING} />);
    expect(screen.getByText(/בד״ץ מהדרין \(רובין\)/)).toBeInTheDocument();
    expect(screen.getByText(/ברשימה שלך/)).toBeInTheDocument();
  });

  it("shows the expiry and the verification age from the API's freshness block", () => {
    renderHe(<EvidencePanel match={MATCH} deciding={DECIDING} />);
    expect(screen.getByText(/30\/09\/26/)).toBeInTheDocument();
    expect(screen.getByText(STRINGS.he.restaurant.verifiedAgo(6))).toBeInTheDocument();
  });

  it("reads UNKNOWN as honest, not broken, and never as a quiet match", () => {
    const unknown: KashrutVerdictOut = {
      verdict: "unknown",
      reasons: [{ code: "attribute_unknown", attribute: "pas_yisrael" }],
      confidence: "low",
      freshness: null,
      deciding_certificate_id: "c1",
    };
    renderHe(<EvidencePanel match={unknown} deciding={DECIDING} />);
    expect(screen.getByLabelText(STRINGS.he.verdict.whyUnknown)).toBeInTheDocument();
    // The closing paragraph is chosen by the reason that caused the doubt, not a
    // generic shrug: this one is missing-attribute, so it says exactly that.
    expect(
      screen.getByText(STRINGS.he.verdict.followUp.attribute_unknown),
    ).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.he.verdict.whyMatch)).toBeNull();
  });

  it("inverts the panel for NO_MATCH — the gap the source design left open", () => {
    const noMatch: KashrutVerdictOut = {
      verdict: "no_match",
      reasons: [{ code: "certifier_not_in_whitelist", attribute: null }],
      confidence: "medium",
      freshness: null,
      deciding_certificate_id: "c1",
    };
    renderHe(<EvidencePanel match={noMatch} deciding={DECIDING} />);
    expect(screen.getByLabelText(STRINGS.he.verdict.whyNoMatch)).toBeInTheDocument();
    expect(screen.getByText(/לא ברשימה שלך/)).toBeInTheDocument();
    expect(
      screen.getByText(STRINGS.he.verdict.followUp.certifier_not_in_whitelist),
    ).toBeInTheDocument();
  });

  it("renders an attribute published as false as a definitive negative, not as doubt", () => {
    const noMatch: KashrutVerdictOut = {
      verdict: "no_match",
      reasons: [{ code: "attribute_false", attribute: "glatt" }],
      confidence: "medium",
      freshness: null,
      deciding_certificate_id: "c1",
    };
    const { container } = renderHe(<EvidencePanel match={noMatch} deciding={DECIDING} />);
    expect(container.querySelector(".evidence__glyph--negative")).not.toBeNull();
    expect(container.querySelector(".evidence__glyph--doubt")).toBeNull();
  });

  it("prints nothing at all when the API sent no reasons", () => {
    const bare: KashrutVerdictOut = {
      verdict: "unknown",
      reasons: [],
      confidence: "low",
      freshness: null,
      deciding_certificate_id: null,
    };
    renderHe(<EvidencePanel match={bare} deciding={null} />);
    const panel = screen.getByLabelText(STRINGS.he.verdict.whyUnknown);
    expect(within(panel).queryAllByRole("listitem")).toHaveLength(0);
  });
});
