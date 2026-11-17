import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOnboarding } from "./logic";
import { markOnboardingDone, readOnboarding, requestOnboardingRedo } from "./store";

afterEach(() => vi.unstubAllGlobals());

describe("memoria del percorso", () => {
  it("se la copia locale non si scrive, «fatto» vale lo stesso per la sessione (mai un ciclo)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    markOnboardingDone("meal");
    expect(readOnboarding()).toEqual({ phase: "done", start: "meal" });
    expect(parseOnboarding(null).phase).toBe("new");
  });

  it("rifare l'introduzione toglie il «fatto» di sessione", () => {
    let stored: string | null = null;
    vi.stubGlobal("window", {
      localStorage: { getItem: () => stored, setItem: (_k: string, v: string) => (stored = v) },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    markOnboardingDone();
    requestOnboardingRedo();
    expect(readOnboarding().phase).toBe("redo");
  });
});
