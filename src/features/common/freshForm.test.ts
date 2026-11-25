import { describe, expect, it } from "vitest";
import { formEpochKey } from "./freshForm";

describe("formEpochKey", () => {
  it("è stabile con gli stessi tre ingredienti", () => {
    expect(formEpochKey("a1", "momento=snack", 0)).toBe(formEpochKey("a1", "momento=snack", 0));
  });

  it("cambia se cambia l'arrivo sulla pagina", () => {
    expect(formEpochKey("a1", "", 0)).not.toBe(formEpochKey("a2", "", 0));
  });

  it("cambia se cambiano i parametri dell'indirizzo", () => {
    expect(formEpochKey("a1", "momento=snack", 0)).not.toBe(formEpochKey("a1", "momento=dinner", 0));
    expect(formEpochKey("a1", "", 0)).not.toBe(formEpochKey("a1", "lotto=x", 0));
  });

  it("cambia dopo un salvataggio", () => {
    expect(formEpochKey("a1", "", 0)).not.toBe(formEpochKey("a1", "", 1));
  });

  it("gli ingredienti non si confondono tra loro", () => {
    expect(formEpochKey("a", "b|c", 0)).not.toBe(formEpochKey("a|b", "c", 0));
  });
});
