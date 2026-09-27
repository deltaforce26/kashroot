/**
 * The `<head>` a route declares, asserted on the document itself.
 *
 * What matters is idempotence: a tag is created once and updated in place. Two
 * `<meta name="description">` elements is how a page ends up described by
 * whichever one a crawler read first, and the static defaults in index.html mean
 * the hook is always overwriting, never starting from an empty head.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { JSON_LD_ATTR } from "../seo/head";
import { useDocumentHead, type DocumentHeadOptions } from "../seo/useDocumentHead";

function Page(options: DocumentHeadOptions) {
  useDocumentHead(options);
  return null;
}

function renderHead(options: DocumentHeadOptions) {
  return render(
    <I18nProvider>
      <Page {...options} />
    </I18nProvider>,
  );
}

const meta = (selector: string) =>
  document.head.querySelector<HTMLMetaElement>(selector)?.getAttribute("content") ?? null;
const count = (selector: string) => document.head.querySelectorAll(selector).length;

/** The static defaults index.html ships, so the hook is tested against them. */
function seedStaticHead() {
  document.head.innerHTML = `
    <meta name="description" content="static default" />
    <meta property="og:title" content="static default" />
    <meta property="og:image" content="/icons/icon-512.png" />
    <title>Kashroot</title>
  `;
}

describe("useDocumentHead", () => {
  beforeEach(seedStaticHead);
  afterEach(() => {
    cleanup();
    document.head.innerHTML = "";
  });

  it("sets the title, description, canonical and Open Graph tags", () => {
    renderHead({ title: "נוגטין", description: "תיאור", canonicalPath: "/r/r-nougatine" });

    expect(document.title).toBe("נוגטין · Kashroot");
    expect(meta('meta[name="description"]')).toBe("תיאור");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${window.location.origin}/r/r-nougatine`,
    );
    expect(meta('meta[property="og:title"]')).toBe("נוגטין · Kashroot");
    expect(meta('meta[property="og:description"]')).toBe("תיאור");
    expect(meta('meta[property="og:url"]')).toBe(`${window.location.origin}/r/r-nougatine`);
    expect(meta('meta[property="og:type"]')).toBe("website");
    expect(meta('meta[property="og:locale"]')).toBe("he_IL");
    expect(meta('meta[property="og:site_name"]')).toBe("Kashroot");
    expect(meta('meta[property="og:image"]')).toBe(`${window.location.origin}/icons/icon-512.png`);
    expect(meta('meta[name="twitter:card"]')).toBe("summary");
  });

  it("uses the brand title alone when no page title is given", () => {
    renderHead({ description: "x" });
    expect(document.title).toBe(STRINGS.he.seo.brandTitle);
    expect(meta('meta[property="og:title"]')).toBe(STRINGS.he.seo.brandTitle);
  });

  it("updates the static defaults in place — never a second tag", () => {
    const { rerender } = renderHead({ title: "א", description: "one", canonicalPath: "/a" });
    rerender(
      <I18nProvider>
        <Page title="ב" description="two" canonicalPath="/b" />
      </I18nProvider>,
    );

    expect(count('meta[name="description"]')).toBe(1);
    expect(count('meta[property="og:title"]')).toBe(1);
    expect(count('meta[property="og:image"]')).toBe(1);
    expect(count('link[rel="canonical"]')).toBe(1);
    expect(count("title")).toBe(1);
    expect(meta('meta[name="description"]')).toBe("two");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${window.location.origin}/b`,
    );
    expect(document.title).toBe("ב · Kashroot");
  });

  it("adds one JSON-LD script, replaces it on change, removes it on unmount", () => {
    const { rerender, unmount } = renderHead({
      description: "x",
      jsonLd: { "@type": "WebSite", name: "Kashroot" },
    });
    const selector = `script[type="application/ld+json"][${JSON_LD_ATTR}]`;
    expect(count(selector)).toBe(1);
    expect(document.head.querySelector(selector)?.textContent).toContain('"@type":"WebSite"');

    rerender(
      <I18nProvider>
        <Page description="x" jsonLd={{ "@type": "Restaurant", name: "נוגטין" }} />
      </I18nProvider>,
    );
    expect(count(selector)).toBe(1);
    expect(document.head.querySelector(selector)?.textContent).toContain('"@type":"Restaurant"');

    unmount();
    expect(count(selector)).toBe(0);
  });

  it("escapes a closing tag inside the JSON-LD so the script cannot be broken out of", () => {
    renderHead({ description: "x", jsonLd: { name: "</script><script>alert(1)" } });
    const text = document.head.querySelector(`script[${JSON_LD_ATTR}]`)?.textContent ?? "";
    expect(text).not.toContain("</script>");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)" });
  });

  it("declares noindex only when asked, and withdraws it when the next page does not", () => {
    const { rerender } = renderHead({ title: "x", description: "x" });
    expect(count('meta[name="robots"]')).toBe(0);

    rerender(
      <I18nProvider>
        <Page title="x" description="x" noindex />
      </I18nProvider>,
    );
    expect(meta('meta[name="robots"]')).toBe("noindex,nofollow");

    rerender(
      <I18nProvider>
        <Page title="x" description="x" />
      </I18nProvider>,
    );
    expect(count('meta[name="robots"]')).toBe(0);
  });

  it("drops the canonical and og:url when a page declares none", () => {
    const { rerender } = renderHead({ title: "x", description: "x", canonicalPath: "/a" });
    rerender(
      <I18nProvider>
        <Page title="x" description="x" />
      </I18nProvider>,
    );
    expect(count('link[rel="canonical"]')).toBe(0);
    expect(count('meta[property="og:url"]')).toBe(0);
  });

  it("switches the card type and locale with the image and the language", () => {
    localStorage.setItem("kashroot.lang", "en");
    renderHead({ title: "x", description: "x", ogImage: "/share/x.png" });
    expect(meta('meta[property="og:locale"]')).toBe("en_US");
    expect(meta('meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(meta('meta[property="og:image"]')).toBe(`${window.location.origin}/share/x.png`);
  });
});
