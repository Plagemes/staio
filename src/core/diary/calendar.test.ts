import { describe, expect, it } from "vitest";
import { addDays, dateRange, daysBetween, isValidTimeZone, localDate, localMoment } from "./calendar";

const ROME = "Europe/Rome";

describe("localDate a Roma", () => {
  it("d'inverno (UTC+1) la mezzanotte italiana cade alle 23:00 UTC", () => {
    expect(localDate("2026-01-15T22:59:59.000Z", ROME)).toBe("2026-01-15");
    expect(localDate("2026-01-15T23:00:00.000Z", ROME)).toBe("2026-01-16");
    expect(localDate("2026-01-15T23:30:00Z", ROME)).toBe("2026-01-16");
  });

  it("d'estate (UTC+2) la mezzanotte italiana cade alle 22:00 UTC", () => {
    expect(localDate("2026-07-15T21:59:59.000Z", ROME)).toBe("2026-07-15");
    expect(localDate("2026-07-15T22:00:00.000Z", ROME)).toBe("2026-07-16");
  });

  it("a cavallo del cambio d'ora legale (29 marzo 2026) e di quello solare (25 ottobre 2026)", () => {
    // 29 marzo: alle 01:00 UTC si passa da UTC+1 a UTC+2.
    expect(localDate("2026-03-28T22:59:59.000Z", ROME)).toBe("2026-03-28");
    expect(localDate("2026-03-28T23:00:00.000Z", ROME)).toBe("2026-03-29");
    expect(localDate("2026-03-29T21:59:59.000Z", ROME)).toBe("2026-03-29");
    expect(localDate("2026-03-29T22:00:00.000Z", ROME)).toBe("2026-03-30");
    // 25 ottobre: alle 01:00 UTC si passa da UTC+2 a UTC+1.
    expect(localDate("2026-10-24T21:59:59.000Z", ROME)).toBe("2026-10-24");
    expect(localDate("2026-10-24T22:00:00.000Z", ROME)).toBe("2026-10-25");
    expect(localDate("2026-10-25T22:59:59.000Z", ROME)).toBe("2026-10-25");
    expect(localDate("2026-10-25T23:00:00.000Z", ROME)).toBe("2026-10-26");
  });

  it("capodanno e anno bisestile", () => {
    expect(localDate("2026-12-31T23:00:00Z", ROME)).toBe("2027-01-01");
    expect(localDate("2027-02-28T23:00:00Z", ROME)).toBe("2027-03-01");
    expect(localDate("2028-02-28T23:00:00Z", ROME)).toBe("2028-02-29");
  });

  it("rispetta un altro fuso", () => {
    expect(localDate("2026-01-15T23:30:00Z", "UTC")).toBe("2026-01-15");
    expect(localDate("2026-01-15T03:30:00Z", "America/New_York")).toBe("2026-01-14");
  });

  it("rifiuta istanti e fusi non validi", () => {
    expect(localDate("2026-01-15", ROME)).toBeUndefined();
    expect(localDate("2026-01-15T10:00:00+01:00", ROME)).toBeUndefined();
    expect(localDate("2026-01-15T10:00:00Z", "Mondo/Nuovo")).toBeUndefined();
  });
});

describe("localMoment", () => {
  it("restituisce data e minuti dalla mezzanotte locale", () => {
    expect(localMoment("2026-07-15T22:30:00Z", ROME)).toEqual({ date: "2026-07-16", minutes: 30 });
    expect(localMoment("2026-01-15T10:05:00Z", ROME)).toEqual({ date: "2026-01-15", minutes: 11 * 60 + 5 });
    expect(localMoment("2026-01-15T23:00:00Z", ROME)).toEqual({ date: "2026-01-16", minutes: 0 });
  });
});

describe("isValidTimeZone", () => {
  it("riconosce i fusi IANA", () => {
    expect(isValidTimeZone("Europe/Rome")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Roma")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(3)).toBe(false);
  });
});

describe("date di calendario", () => {
  it("addDays e daysBetween", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-03-05", "2026-03-01")).toBe(-4);
  });

  it("dateRange", () => {
    expect(dateRange("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(dateRange("2026-03-01", "2026-03-01")).toEqual(["2026-03-01"]);
    expect(dateRange("2026-03-02", "2026-03-01")).toEqual([]);
    expect(dateRange("2026-02-30", "2026-03-01")).toEqual([]);
  });
});
