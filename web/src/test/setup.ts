import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  // The server-prerender tests run in the node environment: no DOM to reset.
  if (typeof document === "undefined") return;
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
