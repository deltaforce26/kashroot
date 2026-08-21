import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { resetSessionOrigin } from "../location/useOrigin";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetSessionOrigin();
  document.documentElement.removeAttribute("data-theme");
});
