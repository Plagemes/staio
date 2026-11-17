import { describe, expect, it } from "vitest";
import {
  expiryTagText,
  formatCalendarDate,
  formatDayLabel,
  formatPrice,
  formatTime,
  parsePriceCents,
  relativeDay,
} from "./format";

describe("date e orari", () => {
  it("l'orario è quello di Roma", () => {
    expect(formatTime("2026-11-16T07:10:00.000Z")).toBe("08:10");
    expect(formatTime("2026-07-16T07:10:00.000Z")).toBe("09:10");
    expect(formatTime("2026-11-16T23:05:00.000Z")).toBe("00:05");
  });

  it("il giorno è quello di Roma, anche a cavallo della mezzanotte", () => {
    expect(formatDayLabel("2026-11-16T12:00:00.000Z")).toMatch(/^Lun 16 nov$/);
    expect(formatDayLabel("2026-11-16T23:30:00.000Z")).toMatch(/^Mar 17 nov$/);
  });

  it("formatta una data di calendario", () => {
    expect(formatCalendarDate("2026-11-18")).toBe("18 nov 2026");
  });

  it("giorni relativi", () => {
    expect(relativeDay("2026-11-16", "2026-11-16")).toBe("oggi");
    expect(relativeDay("2026-11-15", "2026-11-16")).toBe("ieri");
    expect(relativeDay("2026-11-17", "2026-11-16")).toBe("domani");
    expect(relativeDay("2026-11-13", "2026-11-16")).toBe("3 giorni fa");
  });
});

describe("prezzi", () => {
  it("legge euro con virgola o punto", () => {
    expect(parsePriceCents("3,50")).toEqual({ ok: true, cents: 350 });
    expect(parsePriceCents("3.5")).toEqual({ ok: true, cents: 350 });
    expect(parsePriceCents("€ 4")).toEqual({ ok: true, cents: 400 });
    expect(parsePriceCents("0")).toEqual({ ok: true, cents: 0 });
  });

  it("rifiuta il resto", () => {
    for (const bad of ["", "abc", "-3", "3,555", "1,2,3"]) {
      expect(parsePriceCents(bad).ok).toBe(false);
    }
  });

  it("formatta i centesimi", () => {
    expect(formatPrice(350)).toBe("3,50 €");
  });
});

describe("segno di scadenza", () => {
  const u = (level: Parameters<typeof expiryTagText>[0]["level"], daysLeft: number) => ({ level, daysLeft });
  it("parole per i giorni", () => {
    expect(expiryTagText(u("today", 0))).toBe("oggi");
    expect(expiryTagText(u("tomorrow", 1))).toBe("domani");
    expect(expiryTagText(u("soon", 3))).toBe("3 giorni");
    expect(expiryTagText(u("ok", 12))).toBe("12 giorni");
    expect(expiryTagText(u("ok", 70))).toBe("2 mesi");
    expect(expiryTagText(u("ok", 730))).toBe("2 anni");
    expect(expiryTagText(u("expired", -1))).toBe("scaduto ieri");
    expect(expiryTagText(u("expired", -4))).toBe("scaduto da 4 giorni");
    expect(expiryTagText(u("past_quality", -2))).toBe("data passata da 2 giorni");
  });
});
