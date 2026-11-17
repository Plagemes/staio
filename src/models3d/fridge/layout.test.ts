import { describe, expect, it } from "vitest";
import { buildModel, modelBounds } from "../generate";
import { validateRecipe } from "../recipe";
import { FURNITURE_KINDS, furnitureForLocation, furnitureSpec, type FurnitureKind } from "./furniture";
import { FILL_MAX, FILL_MIN, GAP, MARGIN, MAX_FOOTPRINT, MAX_SPREAD, MIN_SCALE, itemScale, layoutItems, slotOf, type LayoutItem, type Placement } from "./layout";

const fridge = furnitureSpec("fridge");

function item(i: number, over: Partial<LayoutItem> = {}): LayoutItem {
  return { id: `i${String(i).padStart(3, "0")}`, name: `Alimento ${i}`, size: [0.14, 0.25, 0.12], priority: i, ...over };
}

const many = (n: number, over: (i: number) => Partial<LayoutItem> = () => ({})) => Array.from({ length: n }, (_, i) => item(i, over(i)));

/** Ingombro in pianta di un alimento collocato, ricostruito dalle dimensioni e dalla rotazione. */
function box(p: Placement, it: LayoutItem) {
  const w = it.size[0] * p.scale;
  const d = it.size[2] * p.scale;
  const c = Math.abs(Math.cos(p.rotationY));
  const s = Math.abs(Math.sin(p.rotationY));
  const bw = w * c + d * s;
  const bd = w * s + d * c;
  return { x0: p.position[0] - bw / 2, x1: p.position[0] + bw / 2, z0: p.position[2] - bd / 2, z1: p.position[2] + bd / 2 };
}

function checkSound(kind: FurnitureKind, items: LayoutItem[]) {
  const spec = furnitureSpec(kind);
  const result = layoutItems(spec, items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const boxes = result.placements.map((p) => ({ p, it: byId.get(p.id)!, b: box(p, byId.get(p.id)!) }));
  for (const { p, it, b } of boxes) {
    const slot = slotOf(spec, p.slot)!;
    expect(slot, p.slot).toBeDefined();
    // dentro i limiti del piano
    expect(b.x0).toBeGreaterThanOrEqual(slot.x0 - 1e-9);
    expect(b.x1).toBeLessThanOrEqual(slot.x1 + 1e-9);
    expect(b.z0).toBeGreaterThanOrEqual(slot.z0 - 1e-9);
    expect(b.z1).toBeLessThanOrEqual(slot.z1 + 1e-9);
    // sotto il ripiano
    expect(p.position[1]).toBe(slot.y);
    expect(it.size[1] * p.scale).toBeLessThanOrEqual(slot.headroom + 1e-9);
    expect(p.scale).toBeGreaterThanOrEqual(MIN_SCALE - 1e-9);
    expect(p.scale).toBeLessThanOrEqual(1);
  }
  // nessuna sovrapposizione fra alimenti dello stesso piano
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].p.slot !== boxes[j].p.slot) continue;
      const a = boxes[i].b;
      const c = boxes[j].b;
      const apart = a.x1 <= c.x0 + 1e-9 || c.x1 <= a.x0 + 1e-9 || a.z1 <= c.z0 + 1e-9 || c.z1 <= a.z0 + 1e-9;
      expect(apart, `${boxes[i].p.id} / ${boxes[j].p.id}`).toBe(true);
    }
  }
  return result;
}

describe("itemScale", () => {
  it("l'altezza occupa dal 52 al 72 per cento dello spazio libero del piano", () => {
    const headroom = 0.46;
    const egg = itemScale(4.5, [0.7, 1, 0.5], 1, headroom);
    const bottle = itemScale(30, [0.3, 1, 0.3], 1, headroom);
    const big = itemScale(60, [0.5, 1, 0.5], 1, headroom);
    for (const r of [egg, bottle, big]) {
      expect(r.size[1] / headroom).toBeGreaterThanOrEqual(FILL_MIN - 1e-9);
      expect(r.size[1] / headroom).toBeLessThanOrEqual(FILL_MAX + 1e-9);
    }
    expect(bottle.size[1]).toBeGreaterThan(egg.size[1]);
    expect(bottle.size[1] / headroom).toBeCloseTo(FILL_MAX, 5);
  });

  it("una confezione larga e bassa non supera il mezzo metro in pianta", () => {
    const tray = itemScale(3, [4.7, 1, 3.3], 1);
    expect(Math.max(tray.size[0], tray.size[2])).toBeLessThanOrEqual(MAX_FOOTPRINT + 1e-9);
    expect(tray.size[1]).toBeLessThan(0.12);
  });

  it("il livello rimasto rimpicciolisce, mai oltre il 78 per cento", () => {
    const full = itemScale(20, [0.5, 1, 0.5], 1);
    const empty = itemScale(20, [0.5, 1, 0.5], 0);
    const half = itemScale(20, [0.5, 1, 0.5], 0.5);
    expect(empty.k / full.k).toBeCloseTo(0.78, 5);
    expect(half.k).toBeGreaterThan(empty.k);
    expect(half.k).toBeLessThan(full.k);
    expect(itemScale(20, [0.5, 1, 0.5], 7).k).toBeCloseTo(full.k, 9);
  });
});

describe("layoutItems", () => {
  it("dispone tutto quando c'è posto, senza sovrapposizioni e nei limiti", () => {
    const result = checkSound("fridge", many(14));
    expect(result.placements).toHaveLength(14);
    expect(result.hidden).toEqual([]);
  });

  it("funziona per tutti e tre i mobili, anche con tanti alimenti", () => {
    for (const kind of FURNITURE_KINDS) {
      const result = checkSound(kind, many(60, (i) => ({ size: [0.1 + (i % 5) * 0.03, 0.12 + (i % 7) * 0.05, 0.1 + (i % 3) * 0.04] })));
      expect(result.placements.length + result.hidden.length).toBe(60);
      expect(result.placements.length).toBeGreaterThan(5);
    }
  });

  it("è stabile: stesso risultato qualunque sia l'ordine dei dati", () => {
    const items = many(25, (i) => ({ size: [0.1 + (i % 4) * 0.04, 0.14 + (i % 6) * 0.05, 0.1 + (i % 3) * 0.03] }));
    const a = layoutItems(fridge, items);
    expect(layoutItems(fridge, items)).toEqual(a);
    expect(layoutItems(fridge, [...items].reverse())).toEqual(a);
    expect(layoutItems(fridge, [...items.slice(10), ...items.slice(0, 10)])).toEqual(a);
  });

  it("cambia solo ciò che deve quando si aggiunge un alimento meno urgente che sta ancora dentro", () => {
    const items = many(6);
    const before = layoutItems(fridge, items);
    const after = layoutItems(fridge, [...items, item(6)]);
    expect(after.hidden).toEqual([]);
    expect(after.placements).toHaveLength(before.placements.length + 1);
  });

  it("con troppi alimenti mostra i più urgenti e dice quali restano fuori", () => {
    const items = many(200);
    const result = checkSound("fridge", items);
    expect(result.hidden.length).toBeGreaterThan(0);
    expect(result.placements.length + result.hidden.length).toBe(200);
    const shown = new Set(result.placements.map((p) => p.id));
    // i primi in ordine d'urgenza ci sono tutti; fuori restano soltanto gli ultimi
    for (let i = 0; i < 8; i++) expect(shown.has(items[i].id)).toBe(true);
    expect(result.hidden.every((id) => !shown.has(id))).toBe(true);
    expect(result.hidden[0] > items[7].id).toBe(true);
    // l'elenco dei fuori scena è dal più urgente
    expect([...result.hidden].sort()).toEqual(result.hidden);
  });

  it("l'alimento più urgente si vede sempre, se sta in un mobile vuoto", () => {
    const big = item(0, { size: [0.4, 0.5, 0.4], priority: -1 });
    const result = layoutItems(fridge, [...many(120, () => ({ priority: 5 })), big]);
    expect(result.placements.some((p) => p.id === big.id)).toBe(true);
  });

  it("un alimento troppo alto per ogni piano resta fuori senza bloccare gli altri", () => {
    const tall = item(0, { size: [0.2, 3, 0.2] });
    const result = layoutItems(fridge, [tall, ...many(3).map((i, k) => ({ ...i, id: `x${k}`, priority: k + 1 }))]);
    expect(result.hidden).toEqual([tall.id]);
    expect(result.placements).toHaveLength(3);
  });

  it("riduce un alimento alto quanto serve per entrare sotto il ripiano", () => {
    const result = layoutItems(fridge, [item(0, { size: [0.2, 0.6, 0.2] })]);
    const p = result.placements[0];
    expect(p.scale).toBeLessThan(1);
    expect(p.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });

  it("frutta e verdura vanno nel cassetto, il resto sui ripiani", () => {
    const items = [item(0, { prefer: "drawer" }), item(1), item(2, { prefer: "drawer" }), item(3)];
    const result = layoutItems(fridge, items);
    const slotOfId = (id: string) => slotOf(fridge, result.placements.find((p) => p.id === id)!.slot)!.kind;
    expect(slotOfId("i000")).toBe("drawer");
    expect(slotOfId("i002")).toBe("drawer");
    expect(slotOfId("i001")).toBe("shelf");
    expect(slotOfId("i003")).toBe("shelf");
  });

  it("nel freezer chi non chiede lo sportello usa i cassetti", () => {
    const result = layoutItems(furnitureSpec("freezer"), many(5));
    expect(result.placements.every((p) => p.slot.startsWith("drawer"))).toBe(true);
  });

  it("bottiglie e cartoni vanno nei balconcini dello sportello, rivolti verso l'interno", () => {
    const bottle = (i: number) => item(i, { size: [0.1, 0.3, 0.1], prefer: "door" });
    const result = layoutItems(fridge, [bottle(0), bottle(1), bottle(2), item(3)]);
    const doors = result.placements.filter((p) => slotOf(fridge, p.slot)!.kind === "door");
    expect(doors.map((p) => p.id).sort()).toEqual(["i000", "i001", "i002"]);
    for (const p of doors) {
      const slot = slotOf(fridge, p.slot)!;
      expect(slot.frame).toBeDefined();
      expect(Math.cos(p.rotationY)).toBeLessThan(-0.9);
      expect(p.position[1]).toBe(slot.y);
    }
    expect(slotOf(fridge, result.placements.find((p) => p.id === "i003")!.slot)!.kind).toBe("shelf");
  });

  it("se non entrano nei balconcini (troppo larghi), i preferiti dello sportello vanno sui ripiani", () => {
    const result = layoutItems(fridge, [item(0, { size: [0.5, 0.3, 0.4], prefer: "door" })]);
    expect(slotOf(fridge, result.placements[0].slot)!.kind).toBe("shelf");
  });

  it("pochi alimenti si distribuiscono su più ripiani invece di stare tutti sul primo", () => {
    const result = layoutItems(fridge, many(5, () => ({ size: [0.14, 0.28, 0.12] as const })));
    const used = new Set(result.placements.map((p) => p.slot));
    expect(used.size).toBeGreaterThanOrEqual(3);
    // e nessun ripiano ne porta più di due
    for (const slot of used) expect(result.placements.filter((p) => p.slot === slot).length).toBeLessThanOrEqual(2);
  });

  it("ogni alimento in un cassetto sporge per metà almeno sopra il bordo anteriore", () => {
    const items = many(40, (i) => ({ size: [0.1 + (i % 4) * 0.04, 0.04 + (i % 9) * 0.04, 0.1 + (i % 3) * 0.03] as const, prefer: "drawer" as const }));
    for (const kind of FURNITURE_KINDS) {
      const spec = furnitureSpec(kind);
      const result = layoutItems(spec, items);
      const byId = new Map(items.map((i) => [i.id, i]));
      let inDrawers = 0;
      for (const p of result.placements) {
        const slot = slotOf(spec, p.slot)!;
        if (slot.lipTop === undefined) continue;
        inDrawers++;
        const h = byId.get(p.id)!.size[1] * p.scale;
        const above = slot.y + h - slot.lipTop;
        expect(above, p.id).toBeGreaterThanOrEqual(h / 2 - 1e-9);
        expect(above, p.id).toBeGreaterThan(0);
      }
      expect(inDrawers > 0 || kind === "pantry").toBe(true);
    }
  });

  it("un alimento troppo basso per sporgere dal cassetto finisce su un ripiano", () => {
    const flat = item(0, { size: [0.3, 0.05, 0.2], prefer: "drawer" });
    const [p] = layoutItems(fridge, [flat]).placements;
    expect(slotOf(fridge, p.slot)!.kind).toBe("shelf");
  });

  it("il bordo anteriore del cassetto è basso: la verdura si vede", () => {
    for (const kind of ["fridge", "freezer"] as const) {
      for (const s of furnitureSpec(kind).slots.filter((s) => s.kind === "drawer")) {
        expect(s.lipTop, s.id).toBeDefined();
        expect(s.lipTop! - s.y).toBeLessThanOrEqual(0.06);
        expect(s.lipTop! - s.y).toBeGreaterThan(0);
      }
    }
  });

  it("la distribuzione resta sana anche quando il bilanciamento non basta", () => {
    for (const n of [10, 20, 30]) checkSound("fridge", many(n, (i) => ({ size: [0.12 + (i % 3) * 0.04, 0.2 + (i % 4) * 0.04, 0.12] })));
  });

  it("i più alti stanno in fondo al piano, i più bassi davanti", () => {
    // ogni alimento occupa una fila intera: l'ordine delle file si legge dalla profondità
    const heights = [0.4, 0.38, 0.36, 0.34, 0.3, 0.28, 0.26, 0.2];
    const items = heights.map((h, i) => item(i, { size: [1.5, h, 0.2] }));
    const result = layoutItems(furnitureSpec("pantry"), items);
    expect(result.hidden).toEqual([]);
    const h = new Map(items.map((i) => [i.id, i.size[1]]));
    const bySlot = new Map<string, Placement[]>();
    for (const p of result.placements) bySlot.set(p.slot, [...(bySlot.get(p.slot) ?? []), p]);
    let compared = 0;
    for (const group of bySlot.values()) {
      for (const a of group) {
        for (const b of group) {
          if (h.get(a.id)! > h.get(b.id)! + 1e-9) {
            expect(a.position[2]).toBeLessThan(b.position[2]);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("una fila è centrata sul piano e spaziata in modo uniforme", () => {
    const one = { ...fridge, slots: [slotOf(fridge, "shelf-2")!] };
    const items = many(3, () => ({ size: [0.2, 0.2, 0.15] as const }));
    const result = layoutItems(one, items);
    const byId = new Map(items.map((i) => [i.id, i]));
    const boxes = result.placements.map((p) => box(p, byId.get(p.id)!)).sort((x, y) => x.x0 - y.x0);
    expect(boxes).toHaveLength(3);
    const gap1 = boxes[1].x0 - boxes[0].x1;
    const gap2 = boxes[2].x0 - boxes[1].x1;
    expect(gap1).toBeGreaterThan(GAP);
    expect(gap1).toBeLessThanOrEqual(GAP + MAX_SPREAD + 1e-9);
    expect(gap2).toBeCloseTo(gap1, 6);
    // centrata: i vuoti ai lati sono uguali
    const slot = one.slots[0];
    expect(boxes[0].x0 - slot.x0).toBeCloseTo(slot.x1 - boxes[2].x1, 6);
  });

  it("la fila va verso il fronte del piano, dove si vede", () => {
    const one = { ...fridge, slots: [slotOf(fridge, "shelf-2")!] };
    const slot = one.slots[0];
    const it0 = item(0, { size: [0.2, 0.2, 0.15] });
    const [p] = layoutItems(one, [it0]).placements;
    const b = box(p, it0);
    expect(b.z1).toBeCloseTo(slot.z1 - MARGIN, 6);
  });

  it("la rotazione è piccola, deterministica, e nulla per le forme lunghe", () => {
    const a = layoutItems(fridge, [item(0, { size: [0.14, 0.2, 0.14] })]).placements[0];
    const b = layoutItems(fridge, [item(0, { size: [0.14, 0.2, 0.14] })]).placements[0];
    expect(a.rotationY).toBe(b.rotationY);
    expect(Math.abs(a.rotationY)).toBeLessThanOrEqual(0.16);
    expect(layoutItems(fridge, [item(1, { size: [0.4, 0.1, 0.1] })]).placements[0].rotationY).toBe(0);
  });

  it("senza alimenti non c'è nulla da disporre", () => {
    expect(layoutItems(fridge, [])).toEqual({ placements: [], hidden: [] });
  });
});

describe("mobili", () => {
  it("ogni mobile ha una ricetta valida e generabile, con gli sportelli aperti verso chi guarda", () => {
    for (const kind of FURNITURE_KINDS) {
      const spec = furnitureSpec(kind);
      const res = validateRecipe(spec.recipe);
      expect(res.ok, res.ok ? "" : res.errors.slice(0, 3).join("; ")).toBe(true);
      const model = buildModel(spec.recipe, "m", { normalize: false });
      const { min, max } = modelBounds(model);
      expect(min[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(max[1]).toBeLessThanOrEqual(spec.height + 1e-6);
      expect(max[1]).toBeGreaterThan(spec.height - 0.15);
      // lo sportello aperto sporge davanti al mobile
      expect(max[2]).toBeGreaterThan(spec.depth / 2 + 0.3);
      expect(min[0]).toBeLessThan(-spec.width / 2);
      expect(model.parts.length).toBeGreaterThan(8);
    }
  });

  it("i piani stanno dentro il mobile, con altezza libera positiva e id unici", () => {
    for (const kind of FURNITURE_KINDS) {
      const spec = furnitureSpec(kind);
      expect(new Set(spec.slots.map((s) => s.id)).size).toBe(spec.slots.length);
      for (const s of spec.slots) {
        expect(s.headroom).toBeGreaterThan(0.2);
        expect(s.x1).toBeGreaterThan(s.x0);
        expect(s.z1).toBeGreaterThan(s.z0);
        if (s.frame) {
          // balconcino dello sportello: coordinate locali, la cornice sta davanti al mobile
          expect(s.kind).toBe("door");
          expect(s.y).toBe(0);
          expect(s.frame.position[1]).toBeGreaterThan(0.3);
          expect(s.frame.position[1] + s.headroom).toBeLessThanOrEqual(spec.height);
          expect(s.frame.position[2]).toBeGreaterThan(spec.depth / 2);
          continue;
        }
        expect(s.x0).toBeGreaterThan(-spec.width / 2);
        expect(s.x1).toBeLessThan(spec.width / 2);
        expect(s.z0).toBeGreaterThanOrEqual(-spec.depth / 2);
        expect(s.z1).toBeLessThanOrEqual(spec.depth / 2 + 0.1);
        expect(s.y).toBeGreaterThan(0);
        expect(s.y + s.headroom).toBeLessThanOrEqual(spec.height);
      }
    }
  });

  it("frigo, freezer e credenza sono diversi", () => {
    expect(furnitureSpec("fridge").slots.some((s) => s.kind === "drawer")).toBe(true);
    expect(furnitureSpec("fridge").slots.some((s) => s.kind === "shelf")).toBe(true);
    expect(furnitureSpec("freezer").slots.filter((s) => s.kind !== "door").every((s) => s.kind === "drawer")).toBe(true);
    expect(furnitureSpec("fridge").slots.filter((s) => s.kind === "door")).toHaveLength(3);
    expect(furnitureSpec("freezer").slots.filter((s) => s.kind === "door")).toHaveLength(2);
    expect(furnitureSpec("pantry").slots.every((s) => s.kind === "shelf")).toBe(true);
    expect(furnitureSpec("pantry").width).toBeGreaterThan(furnitureSpec("fridge").width);
  });

  it("collega il luogo del libro mastro al mobile", () => {
    expect(furnitureForLocation("frigo")).toBe("fridge");
    expect(furnitureForLocation("freezer")).toBe("freezer");
    expect(furnitureForLocation("dispensa")).toBe("pantry");
  });

  it("le superfici piatte e grandi hanno tratteggio più rado dei piccoli oggetti", () => {
    const spec = furnitureSpec("fridge");
    const model = buildModel(spec.recipe, "m", { normalize: false });
    // linee per unità di scena: il mobile sta intorno a 11, un alimento (altezza 0.3) a 80
    const furnitureDensity = Math.max(...model.parts.map((p) => p.strokeScale[1])) / spec.height;
    expect(furnitureDensity).toBeLessThan(40);
    expect(model.parts.every((p) => p.cross === false)).toBe(true);
  });
});
