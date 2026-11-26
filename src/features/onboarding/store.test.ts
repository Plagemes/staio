import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOnboarding } from "./logic";
import { hideFirstSteps, markOnboardingDone, readOnboarding, requestOnboardingRedo } from "./store";

afterEach(() => vi.unstubAllGlobals());

function stubStorage(initial: string | null = null): { read: () => string | null } {
  let stored: string | null = null;
  vi.stubGlobal("window", {
    localStorage: { getItem: () => stored, setItem: (_k: string, v: string) => (stored = v) },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  // la memoria di sessione è dello stato del modulo: una scrittura che non è «fatto» la azzera
  requestOnboardingRedo();
  stored = initial;
  return { read: () => stored };
}

describe("memoria dell'introduzione", () => {
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
    markOnboardingDone("2026-11-26");
    expect(readOnboarding()).toEqual({ phase: "done", since: "2026-11-26" });
    expect(parseOnboarding(null).phase).toBe("new");
  });

  it("rifare l'introduzione toglie il «fatto» di sessione", () => {
    stubStorage();
    markOnboardingDone("2026-11-26");
    requestOnboardingRedo();
    expect(readOnboarding()).toEqual({ phase: "redo" });
  });

  it("alla fine scrive il giorno; senza giorno (chi aveva già dati) non lo scrive", () => {
    stubStorage();
    markOnboardingDone("2026-11-26");
    expect(readOnboarding()).toEqual({ phase: "done", since: "2026-11-26" });
    stubStorage();
    markOnboardingDone();
    expect(readOnboarding()).toEqual({ phase: "done" });
  });

  it("«Lascia così» si ricorda; una memoria senza giorno non ne riceve uno", () => {
    stubStorage();
    markOnboardingDone("2026-11-26");
    hideFirstSteps();
    expect(readOnboarding()).toEqual({ phase: "done", since: "2026-11-26", stepsHidden: true });
    markOnboardingDone();
    expect(readOnboarding()).toEqual({ phase: "done", since: "2026-11-26", stepsHidden: true });
  });

  it("rifarla riparte da capo: alla fine il giorno si rinnova e «Lascia così» non vale più", () => {
    stubStorage();
    markOnboardingDone("2026-11-20");
    hideFirstSteps();
    requestOnboardingRedo();
    markOnboardingDone("2026-11-26");
    expect(readOnboarding()).toEqual({ phase: "done", since: "2026-11-26" });
  });

  it("legge una memoria vecchia con `start`", () => {
    stubStorage('{"phase":"done","start":"pantry"}');
    expect(readOnboarding()).toEqual({ phase: "done" });
  });
});
