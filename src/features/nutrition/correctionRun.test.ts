import { describe, expect, it, vi } from "vitest";
import type { AnyEvent } from "@/core/events";
import { meal } from "@/core/diary/test-helpers";
import { FAKE_FOODS } from "@/core/nutrition/test-helpers";
import type { FoodOption } from "./candidates";
import { runCorrection, type CorrectionDeps } from "./correctionRun";

const shown = meal("m1", "2026-11-18T13:00:00.000Z", {
  mealId: "pranzo-1",
  kind: "lunch",
  items: [{ name: "pasta", quantity: { value: 80, unit: "g" }, certainty: "measured" }],
}) as unknown as AnyEvent;
const food = FAKE_FOODS[0];
const option = { id: food.id, name: food.name, group: "", food } as FoodOption;
const refs = { mealRefs: [{ eventId: "m1", itemIndex: 0 }], pantry: false };

function deps(log: readonly AnyEvent[]) {
  const append = vi.fn(async () => ({ rejected: [] as unknown[] }));
  const notify = vi.fn();
  const readLog = vi.fn(async () => log);
  const d: CorrectionDeps = {
    readLog,
    append,
    deviceId: async () => "device-1",
    saveOverrides: async () => undefined,
    notify,
    now: () => "2026-11-18T14:00:00.000Z",
    busy: { current: false },
  };
  return { d, append, notify, readLog };
}

describe("cambiare l'alimento di una voce già registrata", () => {
  it("scrive una correzione sola, con «Annulla», partendo dal registro dell'archivio", async () => {
    const { d, append, notify, readLog } = deps([shown]);
    expect(await runCorrection(d, {}, refs, "pasta", option)).toBeNull();
    expect(readLog).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ undo: expect.any(Array) }));
    expect(d.busy.current).toBe(false);
  });

  it("se nell'archivio il pasto non c'è più (tolto su un altro telefono) non scrive niente e lo dice", async () => {
    const { d, append } = deps([]);
    expect(await runCorrection(d, {}, refs, "pasta", option)).toBe("Non trovo più il pasto da correggere.");
    expect(append).not.toHaveBeenCalled();
  });

  it("un doppio tocco scrive una volta sola", async () => {
    const { d, append } = deps([shown]);
    const [first, second] = await Promise.all([runCorrection(d, {}, refs, "pasta", option), runCorrection(d, {}, refs, "pasta", option)]);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(append).toHaveBeenCalledTimes(1);
    // finita la scrittura, un tocco nuovo scrive di nuovo
    expect(d.busy.current).toBe(false);
  });
});
