import { describe, expect, it } from "vitest";
import { qualityHref } from "./links";

describe("qualityHref", () => {
  it("porta il codice nell'indirizzo", () => {
    expect(qualityHref("8076800195057")).toBe("/app/qualita/prodotto?codice=8076800195057");
  });
});
