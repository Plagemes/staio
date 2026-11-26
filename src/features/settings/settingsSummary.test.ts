import { describe, expect, it } from "vitest";
import {
  aiValue,
  appearanceValue,
  backupValue,
  confirmationsSummary,
  dietValue,
  eventsText,
  habitsValue,
  memoriesValue,
  noticesValue,
  profileValue,
  structureSummary,
  syncValue,
  targetsSummary,
  videoValue,
  whenAgo,
} from "./settingsSummary";

const NOW = "2026-11-16T10:00:00.000Z";
const v = (...texts: string[]) => texts.map((text) => ({ text }));

describe("profilo", () => {
  it("con il profilo", () => {
    expect(profileValue({ sex: "female", age: 42 })).toBe("Donna, 42 anni");
    expect(profileValue({ sex: "male", age: 1 })).toBe("Uomo, 1 anno");
  });
  it("senza profilo", () => expect(profileValue(null)).toBe("Non compilato"));
});

describe("alimentazione", () => {
  it("allergeni ed esclusi", () => {
    expect(dietValue({ allergens: v("latte", "uova"), excludedFoods: v("funghi", "olive"), complete: true })).toBe("Allergeni: latte, uova · 2 alimenti esclusi");
  });
  it("singolari e plurali", () => {
    expect(dietValue({ allergens: v("latte"), excludedFoods: v("funghi"), complete: true })).toBe("Allergeni: latte · 1 alimento escluso");
    expect(dietValue({ allergens: [], excludedFoods: v("funghi", "olive", "capperi"), complete: true })).toBe("3 alimenti esclusi");
  });
  it("molti allergeni: i primi tre e il resto contato", () => {
    expect(dietValue({ allergens: v("latte", "uova", "soia", "arachidi", "sesamo"), excludedFoods: [], complete: true })).toBe("Allergeni: latte, uova, soia e altri 2");
  });
  it("niente dichiarato", () => {
    expect(dietValue({ allergens: [], excludedFoods: [], complete: true })).toBe("Niente dichiarato");
  });
  it("controllo incompleto: «Da controllare», mai «Niente dichiarato»", () => {
    expect(dietValue({ allergens: [], excludedFoods: [], complete: false })).toBe("Da controllare");
    expect(dietValue({ allergens: v("latte"), excludedFoods: [], complete: false })).toBe("Da controllare");
  });
  it("non ancora letto: nessun valore", () => expect(dietValue(undefined)).toBeUndefined());
  it("nessun testo dice «compatibile» o «sicuro»", () => {
    const all = [dietValue({ allergens: [], excludedFoods: [], complete: true }), dietValue({ allergens: [], excludedFoods: [], complete: false })].join(" ");
    expect(all).not.toMatch(/compatibil|sicur/i);
  });
});

describe("aspetto", () => {
  it("tema e modalità", () => {
    expect(appearanceValue({ theme: "vivo", mode: "dark" })).toBe("Vivo · scuro");
    expect(appearanceValue({ theme: "registro", mode: "light" })).toBe("Registro · chiaro");
    expect(appearanceValue({ theme: "grano", mode: "device" })).toBe("Grano · automatico");
  });
});

describe("funzioni", () => {
  it("intelligenza artificiale", () => {
    expect(aiValue(null)).toBe("Chiave attiva");
    expect(aiValue("missing_model")).toBe("Da completare");
    expect(aiValue("invalid_base_url")).toBe("Da completare");
    expect(aiValue("missing_key")).toBe("Spenta");
  });
  it("video e avvisi", () => {
    expect(videoValue(true)).toBe("Servizio impostato");
    expect(videoValue(false)).toBe("Spento");
    expect(noticesValue(true)).toBe("Accesi");
    expect(noticesValue(false)).toBe("Spenti");
  });
  it("pasti abituali", () => {
    expect(habitsValue(0)).toBe("Nessuno");
    expect(habitsValue(1)).toBe("1 pasto");
    expect(habitsValue(3)).toBe("3 pasti");
  });
});

describe("quando", () => {
  it("oggi, ieri, N giorni fa, la data", () => {
    expect(whenAgo("2026-11-16T07:00:00.000Z", NOW)).toBe("oggi");
    expect(whenAgo("2026-11-15T20:00:00.000Z", NOW)).toBe("ieri");
    expect(whenAgo("2026-11-13T09:00:00.000Z", NOW)).toBe("3 giorni fa");
    expect(whenAgo("2026-11-02T09:00:00.000Z", NOW)).toBe("14 giorni fa");
    expect(whenAgo("2026-11-01T09:00:00.000Z", NOW)).toBe("il 1 nov");
    expect(whenAgo("2025-11-02T09:00:00.000Z", NOW)).toBe("il 2 nov 2025");
  });
  it("istante che non si legge o nel futuro", () => {
    expect(whenAgo("boh", NOW)).toBeUndefined();
    expect(whenAgo("2026-12-01T09:00:00.000Z", NOW)).toBe("oggi");
  });
  it("il giorno è quello di Roma, non quello UTC", () => {
    // 23:30 UTC del 15 sono già le 00:30 del 16 a Roma
    expect(whenAgo("2026-11-15T23:30:00.000Z", NOW)).toBe("oggi");
  });
});

describe("copia", () => {
  it("mai fatta, e con la data", () => {
    expect(backupValue(undefined, NOW)).toBe("Mai fatta");
    expect(backupValue("2026-11-13T09:00:00.000Z", NOW)).toBe("Ultima copia: 3 giorni fa");
    expect(backupValue("2026-11-16T09:00:00.000Z", NOW)).toBe("Ultima copia: oggi");
  });
  it("un valore che non si legge non dice niente di falso", () => {
    expect(backupValue("boh", NOW)).toBeUndefined();
    expect(backupValue(12, NOW)).toBeUndefined();
  });
});

describe("sincronizzazione", () => {
  it("mai fatta: spenta", () => expect(syncValue([undefined, undefined], NOW)).toBe("Spenta"));
  it("l'ultima andata a buon fine", () => {
    expect(syncValue([{ status: "ok", finishedAt: "2026-11-15T09:00:00.000Z" }, { status: "ok", finishedAt: "2026-11-10T09:00:00.000Z" }], NOW)).toBe("Ultima: ieri");
  });
  it("un giro fallito non conta come ultimo", () => {
    expect(syncValue([{ status: "failed", finishedAt: "2026-11-16T09:00:00.000Z" }, { status: "ok", finishedAt: "2026-11-13T09:00:00.000Z" }], NOW)).toBe("Ultima: 3 giorni fa");
  });
  it("solo giri non riusciti: nessun valore", () => {
    expect(syncValue([{ status: "failed", finishedAt: "2026-11-16T09:00:00.000Z" }], NOW)).toBeUndefined();
  });
});

describe("memorie e informazioni", () => {
  it("memorie", () => {
    expect(memoriesValue(0)).toBe("Niente");
    expect(memoriesValue(1)).toBe("1 cosa ricordata");
    expect(memoriesValue(9)).toBe("9 cose ricordate");
  });
  it("eventi", () => expect(eventsText(12)).toBe("Eventi registrati: 12."));
});

describe("Alimentazione: righe richiuse", () => {
  it("obiettivi", () => {
    expect(targetsSummary([])).toBe("Nessun obiettivo");
    expect(targetsSummary(["riposo"])).toBe("1 tipo: riposo");
    expect(targetsSummary(["allenamento", "riposo"])).toBe("2 tipi: allenamento, riposo");
  });
  it("pasti e orari", () => {
    expect(structureSummary(undefined)).toBe("Non impostati");
    expect(structureSummary({ meals: [], eatingWindow: undefined })).toBe("Non impostati");
    expect(
      structureSummary({ meals: [{ kind: "dinner" }, { kind: "breakfast" }, { kind: "lunch" }], eatingWindow: { from: "08:00", to: "20:00" } }),
    ).toBe("Colazione, pranzo, cena · dalle 8 alle 20");
    expect(structureSummary({ meals: [{ kind: "lunch" }] })).toBe("Pranzo");
    expect(structureSummary({ meals: [{ kind: "lunch" }], eatingWindow: { from: "08:30", to: "" } })).toBe("Pranzo · dalle 8:30");
    expect(structureSummary({ meals: [], eatingWindow: { from: "", to: "21:00" } })).toBe("fino alle 21");
  });
  it("conferme", () => {
    expect(confirmationsSummary(0)).toBe("Nessuno");
    expect(confirmationsSummary(1)).toBe("1 ingrediente");
    expect(confirmationsSummary(3)).toBe("3 ingredienti");
  });
});
