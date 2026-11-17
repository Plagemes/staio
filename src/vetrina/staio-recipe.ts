import type { Recipe } from "@/models3d/recipe";

/**
 * Lo staio: antico recipiente per misurare il grano. Un recipiente di legno a doghe, un poco più largo in alto,
 * con tre cerchi di ferro sottili, e sopra il bordo un vero mucchio di chicchi.
 * È un composto: il recipiente è un solido di rotazione (i cerchi sono gradini del profilo, il bordo un anello piano)
 * e il colmo è un mucchio a cupola di chicchi allungati, ciascuno col suo tratteggio.
 */
const wall = (y: number) => Number((0.9 + 0.1 * (y / 2)).toFixed(3));
const HOOP = 0.06;

/** Cerchio di ferro: due punti sulla parete, due sul rilievo. */
const hoop = (y0: number, y1: number): [number, number][] => [
  [wall(y0), y0],
  [wall(y0) + HOOP, y0 + 0.012],
  [wall(y1) + HOOP, y1 - 0.012],
  [wall(y1), y1],
];

export const STAIO_RECIPE: Recipe = {
  id: "staio",
  name: "Staio",
  category: "dispensa",
  archetype: "composite",
  heightCm: 31,
  variation: 0.25,
  hatch: { density: 1.1 },
  params: {
    parts: [
      {
        recipe: {
          archetype: "lathe",
          params: {
            smooth: false,
            segments: 64,
            profile: [
              [0, 0],
              [0.88, 0],
              [0.9, 0.04],
              ...hoop(0.18, 0.26),
              ...hoop(1.0, 1.08),
              ...hoop(1.68, 1.76),
              // parete fino al labbro
              [wall(1.93), 1.93],
              // labbro: sporge appena e chiude con un anello piano, così il bordo resta netto
              [1.07, 1.95],
              [1.07, 2.05],
              [0.84, 2.05],
            ],
          },
        },
      },
      {
        // il colmo: poco più largo dell'apertura, così i chicchi scavalcano il bordo
        recipe: {
          archetype: "cluster",
          params: { layout: "mound", count: 260, elementRadius: 0.03, elongation: 1.4, spread: 0.95 },
        },
        position: [0, 0.97, 0],
      },
    ],
  },
};
