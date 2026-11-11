import { describe, expect, it } from "vitest";
import { findProducts } from "./paypilot-data";

describe("findProducts", () => {
  it("recommends the keyboard for the flagship 'wireless keyboard under $75' request", () => {
    const results = findProducts(
      "I need a wireless keyboard under $75. Find the best option and help me purchase it.",
    );
    expect(results[0]?.id).toBe("aerokeys-k75");
  });

  it("respects the stated budget", () => {
    const results = findProducts("wireless keyboard under $50");
    expect(results.every((product) => product.priceMinor <= 5000)).toBe(true);
    expect(results.some((product) => product.id === "aerokeys-k75")).toBe(false);
  });

  it("still returns weaker partial matches after the best one", () => {
    const ids = findProducts("wireless keyboard").map((product) => product.id);
    expect(ids[0]).toBe("aerokeys-k75");
    expect(ids).toContain("northstar-mouse");
  });

  it("finds a product by name", () => {
    expect(findProducts("usb-c hub")[0]?.id).toBe("arc-usb-hub");
  });

  it("returns nothing for an unrelated request", () => {
    expect(findProducts("submarine")).toEqual([]);
  });
});
