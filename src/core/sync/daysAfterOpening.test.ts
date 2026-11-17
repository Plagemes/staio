import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent } from "../ledger";
import { buildPackage, importPackage, readPackage } from "./filePackage";
import { MemoryLocal } from "./memoryLocal";
import { buy, canon } from "./test-helpers";

describe("durata dopo l'apertura nella sincronizzazione", () => {
  it("un acquisto con il campo passa da un telefono all'altro intatto, accanto a uno senza", async () => {
    const a = new MemoryLocal("a");
    const b = new MemoryLocal("b");
    const withDays = { ...buy("a", 1, "yogurt"), daysAfterOpening: 5 } as ReturnType<typeof buy>;
    a.author([withDays, buy("a", 2)]);
    const pkg = readPackage((await buildPackage({ deviceId: "a", events: a.events })).bytes);
    if (!pkg.ok) throw new Error("pacchetto non leggibile");
    const result = await importPackage(pkg, b);
    expect(result.received.added).toBe(2);
    expect(canon(b.events)).toBe(canon(a.events));
    const lots = derivePantry(b.events as unknown as LedgerEvent[]).lots;
    expect(lots.find((l) => l.productRef === "yogurt")?.daysAfterOpening).toBe(5);
    expect(lots.find((l) => l.productRef === "farina")).not.toHaveProperty("daysAfterOpening");
  });
});
