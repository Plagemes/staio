import { describe, expect, it } from "vitest";
import { describeDevice, platformOf, type DeviceInfo } from "./device";

const base: DeviceInfo = {
  platform: "android",
  installed: true,
  notifications: true,
  serviceWorker: true,
  periodicSync: true,
  permission: "default",
};

describe("describeDevice", () => {
  it("Android con app installata e sincronizzazione periodica", () => {
    const s = describeDevice(base);
    expect(s.headline).toBe(
      "Senza un server gli avvisi arrivano quando apri l'app. Su Android con l'app installata anche circa una volta al giorno.",
    );
    expect(s.background).toBe(true);
    expect(s.canAsk).toBe(true);
  });

  it("Android senza app installata non promette il sottofondo", () => {
    const s = describeDevice({ ...base, installed: false, periodicSync: false });
    expect(s.background).toBe(false);
    expect(s.headline).toContain("quando apri l'app");
    expect(s.headline).toContain("Installando");
  });

  it("Android installato ma senza sincronizzazione periodica", () => {
    const s = describeDevice({ ...base, periodicSync: false });
    expect(s.background).toBe(false);
  });

  it("iPhone da Safari: non si può attivare", () => {
    const s = describeDevice({ ...base, platform: "ios", installed: false, notifications: false, periodicSync: false });
    expect(s.canAsk).toBe(false);
    expect(describeDevice({ ...base, platform: "ios", installed: false, periodicSync: false }).headline).toContain("schermata Home");
  });

  it("iPhone con app installata: solo ad app aperta", () => {
    const s = describeDevice({ ...base, platform: "ios", periodicSync: false });
    expect(s.headline).toContain("non arrivano ad app chiusa");
    expect(s.background).toBe(false);
    expect(s.canAsk).toBe(true);
  });

  it("permesso negato: spiega e non si può chiedere di nuovo", () => {
    const s = describeDevice({ ...base, permission: "denied" });
    expect(s.canAsk).toBe(false);
    expect(s.details[0]).toContain("bloccato");
    expect(s.details[0]).toContain("non te lo chiedo più");
  });

  it("API assente", () => {
    const s = describeDevice({ ...base, notifications: false });
    expect(s.headline).toBe("Questo dispositivo non può mostrare avvisi.");
    expect(s.canAsk).toBe(false);
  });

  it("computer", () => {
    expect(describeDevice({ ...base, platform: "desktop", installed: false, periodicSync: false, serviceWorker: false }).headline).toBe(
      "Gli avvisi arrivano quando l'app è aperta.",
    );
  });
});

describe("platformOf", () => {
  it("riconosce i sistemi", () => {
    expect(platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("desktop");
    expect(platformOf("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
  });
});
